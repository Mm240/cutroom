import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import {
  DEFAULT_LANGUAGE, FORMATS, cuesFromWords, languageFor, mergeChunkTranscripts, planChunks,
  type Chunk, type Cue, type Format, type Render, type Segment, type TimedWord, type TranscriptEntry,
} from '@cutroom/cutplan';

export interface VideoAsset {
  publicId: string;
  width: number;
  height: number;
  duration: number;
  bytes: number;
  format: string;
  secureUrl: string;
  /** The language speech-to-text was asked to transcribe, e.g. hi-IN. */
  language: string;
}

/**
 * Inside a layer reference, a public ID's folder separators must be colons.
 *
 * A raw slash terminates the transformation component, so `l_subtitles:a/b`
 * is parsed as the end of one component and the start of another — which is
 * why the error reads "resource not found" and names a path fragment rather
 * than saying the syntax is wrong. Hard to diagnose from the message alone.
 */
export function layerId(publicId: string): string {
  return publicId.replace(/\//g, ':');
}

@Injectable()
export class CloudinaryService {
  private readonly log = new Logger(CloudinaryService.name);
  private readonly cloudName = process.env.CLOUDINARY_CLOUD_NAME!;

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  /** Assets already on Cloudinary, by MD5 of the source file and language. */
  private readonly known = new Map<string, VideoAsset>();

  /**
   * Find a source we have already uploaded, so a repeat run skips the upload
   * — and, once its transcript exists, the speech-to-text wait as well.
   *
   * Cloudinary's etag is the MD5 of the original file, which makes it a
   * content match rather than a filename match. New uploads are also tagged
   * with the hash for a single-call lookup; the size-then-etag scan covers
   * sources uploaded before tagging existed.
   *
   * A transcript only counts if it is in the requested language. Cloudinary
   * drops the language from the asset once transcription completes, so it is
   * kept as a tag; untagged sources predate language support and are English.
   */
  async findExisting(md5: string, bytes: number, language: string): Promise<VideoAsset | null> {
    const key = `${md5}:${language}`;
    const cached = this.known.get(key);
    if (cached) return cached;

    try {
      const tagged = await cloudinary.api.resources_by_tag(`md5_${md5}`, {
        resource_type: 'video', max_results: 10,
      });
      const candidates: string[] = tagged.resources.map((r: any) => r.public_id);

      if (!candidates.length) {
        const all = await cloudinary.api.resources({
          type: 'upload', resource_type: 'video', prefix: 'cutroom/sources', max_results: 500,
        });
        candidates.push(...all.resources.filter((r: any) => r.bytes === bytes).map((r: any) => r.public_id));
      }

      for (const id of candidates) {
        const d = await cloudinary.api.resource(id, { resource_type: 'video', media_metadata: true });
        const tagged = (d.tags ?? []).find((t: string) => t.startsWith('lang_'))?.slice(5);
        if (d.etag !== md5) continue;
        if ((tagged ?? DEFAULT_LANGUAGE) !== language) continue;

        const asset = this.toAsset(d, language);
        this.known.set(key, asset);
        this.log.log(`Reusing ${id}`);
        return asset;
      }
    } catch (e: any) {
      // A failed lookup only costs us the shortcut; fall through to upload.
      this.log.warn(`Reuse lookup failed: ${e.error?.message ?? e.message}`);
    }
    return null;
  }

  async upload(path: string, filename: string, md5: string, language: string): Promise<VideoAsset> {
    // upload_large sends the file in chunks, which Cloudinary requires for
    // big videos, and streams it from disk.
    const res = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload_large(
        path,
        {
          folder: 'cutroom/sources',
          resource_type: 'video',
          use_filename: true,
          unique_filename: true,
          filename_override: filename,
          tags: [`md5_${md5}`, `lang_${language}`],
          // No speech-to-text here: transcribe() runs it on parallel chunks.
        },
        (err: any, result: any) => (err ? reject(err) : resolve(result)),
      );
    });

    const asset = this.toAsset(res, language);
    this.known.set(`${md5}:${language}`, asset);
    return asset;
  }

  private toAsset(res: any, language: string): VideoAsset {
    return {
      publicId: res.public_id,
      width: res.width,
      height: res.height,
      duration: res.duration,
      bytes: res.bytes,
      format: res.format,
      secureUrl: res.secure_url,
      language,
    };
  }

  /**
   * Transcribe a source, in parallel.
   *
   * One speech-to-text pass over a whole video runs at a roughly fixed rate
   * per second of audio — 163s for a 5:14 source. So the audio is cut into
   * overlapping chunks, every chunk is transcribed at once, and the results
   * are stitched back together: 58s for the same source in four chunks.
   *
   * The stitched transcript is saved where Cloudinary would have written its
   * own, `<publicId>.transcript`, in the same format. The caption layer reads
   * it unchanged, and the next run on this source finds it and returns
   * immediately.
   */
  async transcribe(
    asset: VideoAsset,
    onProgress?: (done: number, total: number) => void | Promise<void>,
  ): Promise<Cue[]> {
    const existing = await this.fetchEntries(asset.publicId).catch(() => null);
    if (existing) {
      this.log.log(`Transcript for ${asset.publicId} already on file`);
      return this.toCues(existing);
    }

    const chunks = planChunks(asset.duration);
    if (!chunks.length) throw new Error('Could not read the length of this video.');

    const started = Date.now();
    const chunkIds: string[] = [];
    let done = 0;
    await onProgress?.(0, chunks.length);
    this.log.log(`Transcribing ${asset.publicId} in ${chunks.length} parallel chunks`);

    try {
      const parts = await Promise.all(
        chunks.map(async (chunk) => {
          const id = await this.startChunk(asset, chunk);
          chunkIds.push(id);
          const entries = await this.waitForEntries(id, chunk.to - chunk.from);
          await onProgress?.(++done, chunks.length);
          return { chunk, entries };
        }),
      );

      const merged = mergeChunkTranscripts(parts);
      await this.saveTranscript(asset.publicId, merged);
      this.log.log(`Transcribed ${asset.publicId} in ${Math.round((Date.now() - started) / 1000)}s`);
      return this.toCues(merged);
    } finally {
      // The chunks were only ever scaffolding.
      this.removeChunks(chunkIds).catch(() => undefined);
    }
  }

  /** Upload one chunk's audio, cut by Cloudinary from the source, for speech-to-text. */
  private async startChunk(asset: VideoAsset, chunk: Chunk): Promise<string> {
    const audio =
      `https://res.cloudinary.com/${this.cloudName}/video/upload/` +
      `so_${chunk.from.toFixed(2)},eo_${chunk.to.toFixed(2)}/${asset.publicId}.mp3`;
    try {
      const res = await cloudinary.uploader.upload(audio, {
        resource_type: 'video',
        folder: 'cutroom/chunks',
        tags: ['cutroom_chunk'],
        raw_convert: `google_speech:${asset.language}`,
      });
      return res.public_id;
    } catch (e: any) {
      const message = e.error?.message ?? e.message ?? String(e);
      if (/limit|quota/i.test(message)) {
        throw new Error(
          'Cloudinary speech-to-text quota is used up for this billing period. ' +
          'Upgrade the plan or use another Cloudinary account to transcribe new videos — ' +
          'videos already transcribed still work.',
        );
      }
      throw new Error(`Could not start transcription: ${message}`);
    }
  }

  /**
   * Poll for one chunk's transcript. A chunk takes well under its own length
   * to transcribe, so the budget is generous: three times its length, and
   * never under three minutes.
   */
  private async waitForEntries(publicId: string, seconds: number): Promise<TranscriptEntry[]> {
    const budgetMs = Math.max(3 * 60_000, seconds * 3000);
    const started = Date.now();
    let lastLog = started;

    while (Date.now() - started < budgetMs) {
      const entries = await this.fetchEntries(publicId).catch(() => null);
      if (entries) return entries;
      if (Date.now() - lastLog >= 15_000) {
        lastLog = Date.now();
        this.log.log(`Waiting for ${publicId}: ${Math.round((lastLog - started) / 1000)}s`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Transcript did not arrive within ${Math.round(budgetMs / 1000)}s. Check the speech-to-text add-on.`);
  }

  private async fetchEntries(publicId: string): Promise<TranscriptEntry[]> {
    // The version segment is required: without it Cloudinary keeps answering
    // 404 "Resource pending" for a transcript that has already been written.
    // A fresh version per poll also sidesteps any cached 404.
    const version = Math.floor(Date.now() / 1000);
    const url = `https://res.cloudinary.com/${this.cloudName}/raw/upload/v${version}/${publicId}.transcript`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`transcript ${res.status}`);
    return (await res.json()) as TranscriptEntry[];
  }

  private async saveTranscript(publicId: string, entries: TranscriptEntry[]) {
    const body = Buffer.from(JSON.stringify(entries)).toString('base64');
    await cloudinary.uploader.upload(`data:application/json;base64,${body}`, {
      resource_type: 'raw',
      public_id: `${publicId}.transcript`,
      overwrite: true,
      invalidate: true,
    });
  }

  private async removeChunks(ids: string[]) {
    if (!ids.length) return;
    await cloudinary.api.delete_resources(ids, { resource_type: 'video', invalidate: true });
    await cloudinary.api.delete_resources(ids.map((id) => `${id}.transcript`), { resource_type: 'raw' });
  }

  /**
   * Cloudinary's transcript has one entry per utterance, each with word-level
   * timing. Utterance length is the recogniser's choice and runs to a full
   * minute in some languages, so each is split into sentence-sized cues —
   * those are the boundaries the planner is allowed to cut on.
   */
  private toCues(entries: TranscriptEntry[]): Cue[] {
    return entries.flatMap((entry) => {
      const words: TimedWord[] = (entry.words ?? []).map((w) => ({
        word: String(w.word ?? ''),
        start: Number(w.start_time ?? 0),
        end: Number(w.end_time ?? 0),
      }));
      // Japanese and Chinese transcripts carry no spaces between words.
      const joiner = /\s/.test(String(entry.transcript ?? '').trim()) ? ' ' : '';
      return cuesFromWords(words, { joiner });
    });
  }

  /**
   * Build one rendered clip.
   *
   * The chain order matters and is not obvious:
   *
   *   so_/eo_   cut the segment first, so everything downstream works on the
   *             clip rather than re-encoding the whole source
   *   c_fill    reframe to the target aspect
   *   g_auto    track the subject instead of centre-cropping — the difference
   *             between a talking head and a shot of someone's shoulder
   *   l_subtitles  burn captions, because feeds autoplay muted
   */
  renderFor(asset: VideoAsset, segment: Segment, format: Format): Render {
    const chain: string[] = [
      `so_${segment.start},eo_${segment.end}`,
      `c_fill,g_auto,w_${format.width},h_${format.height}`,
    ];

    const captionFont = languageFor(asset.language).font;
    if (format.captions && captionFont) {
      // Push captions above the platform's own bottom chrome.
      const y = Math.round(format.height * (format.safeBottom ?? 0.08)) + 40;
      // Arial has no glyphs for most non-Latin scripts; each language names
      // a font that does. Spaces in a font family are URL-encoded.
      const font = encodeURIComponent(captionFont);
      chain.push(
        `l_subtitles:${font}_${Math.round(format.height / 26)}_bold:${layerId(asset.publicId)}.transcript`,
        `co_white,b_rgb:00000099`,
        `fl_layer_apply,g_south,y_${y}`,
      );
    }

    chain.push('f_auto,q_auto,vc_auto');

    const url = `https://res.cloudinary.com/${this.cloudName}/video/upload/${chain.join('/')}/${asset.publicId}.mp4`;

    // A poster from one second into the clip — frame zero is often a cut.
    const poster =
      `https://res.cloudinary.com/${this.cloudName}/video/upload/` +
      `so_${(segment.start + 1).toFixed(2)},c_fill,g_auto,w_${format.width},h_${format.height},f_jpg,q_auto/` +
      `${asset.publicId}.jpg`;

    return {
      id: `${segment.id}-${format.id}`,
      segmentId: segment.id,
      format: format.id,
      label: format.label,
      aspect: format.aspect,
      width: format.width,
      height: format.height,
      url,
      poster,
    };
  }

  renderAll(asset: VideoAsset, segments: Segment[]): Render[] {
    const out: Render[] = [];
    for (const seg of segments) {
      for (const fmt of FORMATS) {
        if (fmt.maxSeconds && seg.seconds > fmt.maxSeconds) continue;
        out.push(this.renderFor(asset, seg, fmt));
      }
    }
    return out;
  }

  /** Strip of frames across a segment — the filmstrip the console draws. */
  filmstrip(asset: VideoAsset, segment: Segment, frames = 6): string[] {
    const step = (segment.end - segment.start) / frames;
    return Array.from({ length: frames }, (_, i) => {
      const t = (segment.start + step * i + step / 2).toFixed(2);
      return (
        `https://res.cloudinary.com/${this.cloudName}/video/upload/` +
        `so_${t},c_fill,g_auto,w_300,h_168,f_jpg,q_auto/${asset.publicId}.jpg`
      );
    });
  }

  /**
   * Ask Cloudinary to encode each render now, in the background.
   *
   * Subject-tracked vertical reframes measured at roughly 40 seconds on first
   * request against a real account. Without warming, a viewer hits a dead
   * player for most of a minute; with it, the encode happens while they are
   * still reading the clip titles. Failures are ignored on purpose — this is
   * an optimisation, and the URLs work regardless.
   */
  async warm(renders: Render[]): Promise<void> {
    await Promise.allSettled(
      renders.map((r) =>
        fetch(r.url, { method: 'GET', headers: { Range: 'bytes=0-1' } }).catch(() => null),
      ),
    );
  }

  /** Low-bitrate preview of the whole source, for the scrubber. */
  previewUrl(asset: VideoAsset): string {
    return (
      `https://res.cloudinary.com/${this.cloudName}/video/upload/` +
      `c_limit,w_960,q_auto:eco,f_auto,vc_auto/${asset.publicId}.mp4`
    );
  }
}
