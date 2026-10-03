import type { TranscriptEntry } from './chunks';

/** The parts of a Whisper `verbose_json` response with word timestamps that we use. */
export interface WhisperResponse {
  language?: string;
  segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number }>;
  words?: Array<{ word: string; start: number; end: number }>;
}

/**
 * Convert a Whisper transcription into Cloudinary's transcript format, so the
 * planner and the caption layer read it exactly as they read Cloudinary's.
 *
 * Each Whisper segment becomes one utterance, holding the words that start
 * inside it. Whisper invents text over silence ("Thank you.") — a segment it
 * is itself sure holds no speech is dropped.
 */
export function entriesFromWhisper(res: WhisperResponse, offset = 0): TranscriptEntry[] {
  const words = (res.words ?? []).filter((w) => String(w.word ?? '').trim());
  const out: TranscriptEntry[] = [];
  let i = 0;

  for (const seg of res.segments ?? []) {
    const own: TranscriptEntry['words'] = [];
    // Words arrive in time order; take those starting before this segment ends.
    while (i < words.length && words[i].start < seg.end) {
      const w = words[i++];
      own.push({
        word: w.word.trim(),
        start_time: round(w.start + offset),
        end_time: round(w.end + offset),
      });
    }
    const silent = (seg.no_speech_prob ?? 0) > 0.6 && (seg.avg_logprob ?? 0) < -1;
    if (!own.length || silent) continue;
    out.push({
      transcript: String(seg.text ?? '').trim(),
      confidence: Math.min(1, Math.exp(seg.avg_logprob ?? 0)),
      words: own,
    });
  }
  return out;
}

/** Whisper takes ISO-639-1 codes; our language list uses BCP-47 tags. */
export function whisperLanguage(code: string): string {
  const base = code.split('-')[0].toLowerCase();
  return base === 'cmn' ? 'zh' : base;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
