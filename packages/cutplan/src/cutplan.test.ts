import { describe, expect, it } from 'vitest';
import { fillerPenalty, hookScore, paceScore, plan, tailPenalty, titleFor, wordCount } from './plan';
import { FORMATS } from './formats';
import { cuesFromWords } from './cues';
import { mergeChunkTranscripts, planChunks } from './chunks';
import type { Cue } from './types';

/** Build a cue track from lines, each given a duration from its word count. */
function track(lines: string[], secondsPerLine = 4): Cue[] {
  return lines.map((text, i) => ({
    start: i * secondsPerLine,
    end: (i + 1) * secondsPerLine,
    text,
  }));
}

const PODCAST = track([
  'So yeah, um, we were basically just getting started back then.',
  'And you know it was sort of a slow period for us, I mean really slow.',
  'Why did nobody tell us the first year would be like that?',
  'Because the truth is most people quit at exactly that point.',
  'We lost 40 percent of our customers in a single quarter.',
  'But the ones who stayed ended up being worth more than everyone we lost.',
  'That changed how I think about churn entirely.',
  'Anyway, so, we kept going and things got a bit better after that.',
  'Um, yeah, and then we hired a few more people I guess.',
  'It was fine. Things were fine.',
]);

describe('helpers', () => {
  it('counts words', () => {
    expect(wordCount('one two  three')).toBe(3);
  });

  it('scores pace as a curve, not more-is-better', () => {
    const ideal = paceScore(26, 10);     // 2.6 w/s
    const frantic = paceScore(60, 10);   // 6.0 w/s
    const dead = paceScore(4, 10);       // 0.4 w/s
    expect(ideal).toBeGreaterThan(frantic);
    expect(ideal).toBeGreaterThan(dead);
    expect(ideal).toBeCloseTo(1, 1);
  });

  it('rewards structural hooks in the opening line', () => {
    expect(hookScore('Why did nobody tell us?').score).toBeGreaterThan(
      hookScore('And then we kept going.').score,
    );
  });

  it('recognises a specific figure as a hook', () => {
    const r = hookScore('We lost 40 percent of our customers.');
    expect(r.kinds).toContain('number');
  });

  it('penalises a clip that trails off at the end', () => {
    const lands = tailPenalty('We lost forty percent that quarter. It changed how we price everything.');
    const trails = tailPenalty('We lost forty percent that quarter. Um, yeah. It was fine.');
    expect(trails).toBeGreaterThan(lands);
  });

  it('treats a very short closing line as a trail-off', () => {
    expect(tailPenalty('A real point was made here. It was fine.')).toBeGreaterThan(0.15);
  });

  it('penalises filler', () => {
    const filler = fillerPenalty('um you know like basically I mean sort of');
    const clean = fillerPenalty('We lost forty percent of our customers that quarter.');
    expect(filler).toBeGreaterThan(clean);
  });
});

describe('plan', () => {
  const result = plan(PODCAST, { targetCount: 2, minSeconds: 8, maxSeconds: 24, minGapSeconds: 4 });

  it('returns segments inside the duration bounds', () => {
    expect(result.segments.length).toBeGreaterThan(0);
    for (const s of result.segments) {
      expect(s.seconds).toBeGreaterThanOrEqual(8);
      expect(s.seconds).toBeLessThanOrEqual(24);
    }
  });

  it('starts and ends every clip on a cue boundary', () => {
    const starts = new Set(PODCAST.map((c) => c.start));
    const ends = new Set(PODCAST.map((c) => c.end));
    for (const s of result.segments) {
      expect(starts.has(s.start)).toBe(true);
      expect(ends.has(s.end)).toBe(true);
    }
  });

  it('prefers the interesting stretch over the filler stretch', () => {
    const picked = result.segments.map((s) => s.text).join(' ');
    expect(picked).toMatch(/40 percent|most people quit|nobody tell us/i);
    expect(picked).not.toMatch(/Things were fine/);
  });

  it('does not return overlapping clips', () => {
    const sorted = [...result.segments].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
    }
  });

  it('respects the requested count', () => {
    expect(result.segments.length).toBeLessThanOrEqual(2);
  });

  it('explains every pick', () => {
    for (const s of result.segments) {
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it('reports how many windows it scored', () => {
    expect(result.considered).toBeGreaterThan(result.segments.length);
  });

  it('handles an empty transcript without throwing', () => {
    const empty = plan([]);
    expect(empty.segments).toEqual([]);
    expect(empty.duration).toBe(0);
    expect(empty.coverage).toBe(0);
  });

  it('returns nothing when no window reaches the minimum length', () => {
    const tiny = plan(track(['Hello there.'], 2), { minSeconds: 30 });
    expect(tiny.segments).toEqual([]);
  });
});

describe('titles', () => {
  it('uses the first sentence and strips filler', () => {
    const t = titleFor({
      start: 0, end: 10, seconds: 10, words: 12, score: 1, hooks: [],
      text: 'So basically you know we lost forty percent. Then other things happened.',
    });
    expect(t).not.toMatch(/basically|you know/);
    expect(t).toMatch(/forty percent/);
  });

  it('truncates on a word boundary', () => {
    const long = 'a'.repeat(5) + ' word'.repeat(40);
    const t = titleFor({
      start: 0, end: 10, seconds: 10, words: 40, score: 1, hooks: [], text: long,
    });
    expect(t.length).toBeLessThanOrEqual(71);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('formats', () => {
  it('burns captions on every format that autoplays muted', () => {
    const vertical = FORMATS.find((f) => f.id === 'vertical')!;
    expect(vertical.captions).toBe(true);
    expect(vertical.safeBottom).toBeGreaterThan(0);
  });

  it('keeps aspect ratios consistent with their pixel dimensions', () => {
    for (const f of FORMATS) {
      const [w, h] = f.aspect.split(':').map(Number);
      expect(f.width / f.height).toBeCloseTo(w / h, 2);
    }
  });
});

describe('other languages', () => {
  it('finds hooks in Devanagari, where \\b never matches', () => {
    expect(hookScore('क्या आप जानते हैं वजन कैसे कम होता है?').kinds).toContain('question');
    expect(hookScore('लेकिन असली बात कुछ और है।').kinds).toContain('turn');
    expect(hookScore('30 दिन में 15 किलो वजन कम होगा।').kinds).toContain('number');
  });

  it('finds hooks in Spanish', () => {
    expect(hookScore('¿Por qué nadie habla de esto?').kinds).toEqual(
      expect.arrayContaining(['question', 'claim']),
    );
  });

  it('does not read the English word "was" as a German question', () => {
    expect(hookScore('Was it worth it in the end.').kinds).not.toContain('question');
  });

  it('counts words in scripts without spaces', () => {
    expect(wordCount('私は毎朝ベッドを整えます')).toBeGreaterThan(3);
  });

  it('treats the danda as a sentence end', () => {
    const trails = tailPenalty('यह एक बहुत ज़रूरी बात है जो सबको पता होनी चाहिए। ठीक है।');
    expect(trails).toBeGreaterThan(0.15);
  });

  it('truncates titles in scripts without spaces', () => {
    const t = titleFor({
      start: 0, end: 10, seconds: 10, words: 40, score: 1, hooks: [], text: '毎'.repeat(120),
    });
    expect(t.length).toBeLessThanOrEqual(71);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('cues from words', () => {
  const w = (word: string, start: number) => ({ word, start, end: start + 0.4 });

  it('splits a long utterance at sentence ends, including the danda', () => {
    const cues = cuesFromWords([
      w('देखना', 0), w('है।', 0.5), w('मैं', 1), w('हूं।', 1.5), w('Then', 2), w('this.', 2.5),
    ]);
    expect(cues.map((c) => c.text)).toEqual(['देखना है।', 'मैं हूं।', 'Then this.']);
    expect(cues[1].start).toBe(1);
    expect(cues[1].end).toBeCloseTo(1.9);
  });

  it('never lets a run-on grow past the hard limit', () => {
    const words = Array.from({ length: 100 }, (_, i) => w('word', i * 0.5));
    for (const c of cuesFromWords(words)) expect(c.end - c.start).toBeLessThanOrEqual(20.5);
  });

  it('joins without spaces for scripts that do not use them', () => {
    expect(cuesFromWords([w('私は', 0), w('寝る。', 0.5)], { joiner: '' })[0].text).toBe('私は寝る。');
  });
});

describe('parallel transcription chunks', () => {
  it('covers the whole source exactly once, with overlap at the edges', () => {
    const chunks = planChunks(314.8);
    expect(chunks).toHaveLength(6);
    expect(chunks[0].ownFrom).toBe(0);
    expect(chunks[chunks.length - 1].ownTo).toBe(314.8);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].ownFrom).toBeCloseTo(chunks[i - 1].ownTo);
      expect(chunks[i].from).toBeLessThan(chunks[i].ownFrom);
    }
  });

  it('caps the number of chunks on long sources', () => {
    expect(planChunks(2 * 60 * 60)).toHaveLength(16);
    expect(planChunks(20)).toHaveLength(1);
    expect(planChunks(0)).toEqual([]);
  });

  it('shifts words onto the source clock and keeps each overlapping word once', () => {
    const [a, b] = planChunks(20, { target: 10, overlap: 2 });
    // "edge" starts at 9.5s on the source: heard by both chunks, owned by the first.
    const merged = mergeChunkTranscripts([
      { chunk: b, entries: [{ transcript: 'edge later', confidence: 0.9, words: [
        { word: 'edge', start_time: 1.5, end_time: 1.9 }, { word: 'later', start_time: 4, end_time: 4.5 },
      ] }] },
      { chunk: a, entries: [{ transcript: 'hello edge', confidence: 0.8, words: [
        { word: 'hello', start_time: 1, end_time: 1.4 }, { word: 'edge', start_time: 9.5, end_time: 9.9 },
      ] }] },
    ]);
    expect(merged.map((e) => e.transcript)).toEqual(['hello edge', 'later']);
    expect(merged[1].words[0].start_time).toBe(12);
  });
});
