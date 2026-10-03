import { Injectable, Logger } from '@nestjs/common';
import { openAsBlob } from 'node:fs';
import { entriesFromWhisper, whisperLanguage, type TranscriptEntry } from '@cutroom/cutplan';

/** Groq's free tier refuses audio files over 25 MB; stay a little under. */
const MAX_BYTES = 24 * 1024 * 1024;

/**
 * Fast transcription through Groq's hosted Whisper.
 *
 * Cloudinary's speech-to-text queues each request for about forty seconds
 * however short the audio. Whisper on Groq measured 1.1s for a 5:14 source
 * as compressed audio, 2.1s as the original MP4 — the listening stage stops
 * being a stage. Optional: with GROQ_API_KEY unset, Cloudinary does it all.
 */
@Injectable()
export class GroqService {
  private readonly log = new Logger(GroqService.name);
  private readonly key = (process.env.GROQ_API_KEY ?? '').trim();

  get enabled() {
    return !!this.key;
  }

  /** Whether a file is small enough to send to Groq as-is. */
  accepts(bytes: number) {
    return this.enabled && bytes <= MAX_BYTES;
  }

  /** Transcribe a file on disk — used on the upload itself, in parallel with Cloudinary. */
  async transcribeFile(path: string, filename: string, language: string): Promise<TranscriptEntry[]> {
    return this.transcribe(await openAsBlob(path), filename, language);
  }

  async transcribe(audio: Blob, filename: string, language: string): Promise<TranscriptEntry[]> {
    if (!this.enabled) throw new Error('GROQ_API_KEY is not set');
    if (audio.size > MAX_BYTES) throw new Error(`Audio is ${Math.round(audio.size / 1e6)} MB; Groq takes up to 24 MB`);

    const started = Date.now();
    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('language', whisperLanguage(language));

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`);
    }

    const entries = entriesFromWhisper(await res.json());
    this.log.log(`Groq transcribed ${filename} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return entries;
  }
}
