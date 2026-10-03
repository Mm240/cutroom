import type { Cue } from './types';

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?।॥。！？؟]["'”’)]*$/u;
const CLAUSE_END = /[,;:，、،]["'”’)]*$/u;

/**
 * Turn one transcript utterance into sentence-sized cues.
 *
 * Speech-to-text decides its own utterance length, and it varies by language:
 * English comes back in short phrases, Hindi in sixty-second blocks. Clips can
 * only start and end on cue boundaries, so a sixty-second cue can never fit a
 * clip at all. Splitting on the punctuation carried by each word — with word
 * timings giving exact boundaries — makes every language cuttable.
 *
 * A run-on with no full stop is broken at a comma past `softMax` seconds, and
 * at any word past `hardMax`, so no cue grows too long to use.
 */
export function cuesFromWords(
  words: TimedWord[],
  { joiner = ' ', softMax = 12, hardMax = 20 }: { joiner?: string; softMax?: number; hardMax?: number } = {},
): Cue[] {
  const out: Cue[] = [];
  let run: TimedWord[] = [];

  const flush = () => {
    if (!run.length) return;
    const text = run.map((w) => w.word).join(joiner).trim();
    const start = run[0].start;
    const end = run[run.length - 1].end;
    if (text && end > start) out.push({ start, end, text });
    run = [];
  };

  for (const w of words) {
    run.push(w);
    const length = w.end - run[0].start;
    if (
      SENTENCE_END.test(w.word) ||
      (length >= softMax && CLAUSE_END.test(w.word)) ||
      length >= hardMax
    ) flush();
  }
  flush();
  return out;
}
