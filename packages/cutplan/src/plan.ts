import type { Candidate, Cue, CutPlan, PlanOptions, Segment } from './types';

/**
 * Cutroom's clip planner.
 *
 * The naive version of this product chops a video every sixty seconds and
 * calls the pieces clips. That produces clips that start mid-sentence and end
 * mid-thought, which is exactly why most auto-clipping tools are useless.
 *
 * This picks moments instead: windows that start where someone starts
 * speaking, end where they finish, and contain something a viewer would stop
 * scrolling for.
 */

const DEFAULTS: Required<PlanOptions> = {
  minSeconds: 18,
  maxSeconds: 58,
  targetCount: 6,
  /** Keep clips apart so a reel set does not cover the same two minutes. */
  minGapSeconds: 25,
};

/**
 * Match any of these words or phrases as whole words, in any script.
 *
 * `\b` only knows ASCII letters, so it never fires inside Devanagari, Arabic
 * or Cyrillic text — and Devanagari vowel signs are combining marks, so the
 * boundary has to treat marks as part of the word too.
 */
function words(list: string[], flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{M}\\p{N}])`, flags);
}

/** Sentence-ending punctuation across scripts: Latin, Devanagari danda, CJK, Arabic. */
const STOPS = '.!?।॥。！？؟';
const ENDS_SENTENCE = new RegExp(`[${STOPS}]\\s*$`, 'u');
const SENTENCE_BREAK = new RegExp(`(?<=[${STOPS}])\\s*`, 'u');

/**
 * Openers that make a viewer stay. Not sentiment analysis — these are
 * structural: a question promises an answer, a number promises specificity,
 * a contradiction promises tension.
 *
 * Each kind lists its markers in English, Hindi, Spanish, Portuguese, French
 * and German. Languages not listed still get the punctuation and number
 * hooks, plus pace and ending scores, which do not depend on vocabulary.
 */
const HOOKS: Array<{ re: RegExp; weight: number; kind: string }> = [
  {
    re: new RegExp(`^${words([
      'what', 'why', 'how', 'when', 'who', 'where',
      'क्या', 'क्यों', 'कैसे', 'कब', 'कौन', 'कहाँ', 'कहां',
      'qué', 'por qué', 'cómo', 'cuándo', 'quién', 'dónde',
      'o que', 'por que', 'como', 'quando', 'quem', 'onde',
      'pourquoi', 'comment', 'quand', 'qui', 'où',
      'warum', 'wie', 'wann', 'wer', 'wo',
    ]).source}`, 'iu'),
    weight: 0.3,
    kind: 'question',
  },
  { re: /[?？؟]\s*$/u, weight: 0.22, kind: 'question' },
  {
    re: words([
      'most people', 'everyone', 'nobody', 'the truth is', 'the reason',
      'ज़्यादातर लोग', 'ज्यादातर लोग', 'सब लोग', 'कोई नहीं', 'सच यह है', 'सच ये है', 'असली वजह', 'वजह यह है',
      'la mayoría', 'todo el mundo', 'nadie', 'la verdad es', 'la razón',
      'a maioria', 'todo mundo', 'ninguém', 'a verdade é',
      'la plupart des gens', 'tout le monde', 'personne', 'la vérité', 'la raison',
      'die meisten', 'jeder', 'niemand', 'die wahrheit ist', 'der grund',
    ]),
    weight: 0.28,
    kind: 'claim',
  },
  {
    re: words([
      'but', 'however', 'actually', 'except', 'the problem',
      'लेकिन', 'मगर', 'परंतु', 'पर असल में', 'असल में', 'दरअसल', 'समस्या',
      'pero', 'sin embargo', 'en realidad', 'el problema',
      'mas', 'porém', 'na verdade', 'o problema',
      'mais', 'pourtant', 'en fait', 'le problème',
      'aber', 'jedoch', 'eigentlich', 'das problem',
    ]),
    weight: 0.18,
    kind: 'turn',
  },
  {
    re: /[\p{Nd}]+(?:[.,][\p{Nd}]+)?\s*(?:%|percent|times|x|crore|lakh|million|billion|प्रतिशत|फ़ीसदी|फीसदी|गुना|करोड़|लाख|किलो|दिन|साल|por ciento|veces|millones|pour cent|fois|prozent|mal)(?![\p{L}\p{M}])/iu,
    weight: 0.26,
    kind: 'number',
  },
  {
    re: words([
      'never', 'always', 'worst', 'best', 'biggest', 'first time',
      'कभी नहीं', 'हमेशा', 'सबसे', 'पहली बार',
      'nunca', 'siempre', 'el peor', 'el mejor', 'primera vez',
      'sempre', 'o pior', 'o melhor', 'primeira vez',
      'jamais', 'toujours', 'le pire', 'le meilleur', 'première fois',
      'nie', 'immer', 'schlimmste', 'beste', 'zum ersten mal',
    ]),
    weight: 0.16,
    kind: 'superlative',
  },
  {
    re: words([
      'i think', 'i learned', 'i realised', 'i realized', 'here is', "here's",
      'मुझे लगता है', 'मैंने सीखा', 'मैंने देखा',
      'creo que', 'aprendí', 'eu acho', 'aprendi', 'je pense', "j'ai appris", 'ich glaube', 'ich habe gelernt',
    ]),
    weight: 0.14,
    kind: 'personal',
  },
];

const FILLER = words([
  'um+', 'uh+', 'like', 'you know', 'sort of', 'kind of', 'i mean', 'basically', 'right\\?',
  'मतलब', 'यानी', 'हम्म+', 'अं+',
  'o sea', 'pues', 'tipo', 'né',
  'euh+', 'genre', 'du coup',
  'äh+', 'ähm+', 'halt',
], 'giu');

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;

/**
 * Words in a line, in any language.
 *
 * Splitting on spaces counts a whole Chinese or Japanese sentence as one
 * word, which wrecks the pace score. The segmenter knows where words break
 * in scripts that do not use spaces.
 */
export function wordCount(text: string): number {
  if (segmenter) {
    let n = 0;
    for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Words per second across the window.
 *
 * Both extremes are bad: a long pause is dead air, and a frantic stretch is
 * usually someone reading a list. The sweet spot sits around normal animated
 * speech, so this scores as a curve rather than "more is better".
 */
export function paceScore(words: number, seconds: number): number {
  if (seconds <= 0) return 0;
  const wps = words / seconds;
  const ideal = 2.6;
  return Math.max(0, 1 - Math.abs(wps - ideal) / ideal);
}

export function hookScore(text: string): { score: number; kinds: string[] } {
  const opener = text.trim().slice(0, 120);
  let score = 0;
  const kinds: string[] = [];

  for (const h of HOOKS) {
    if (h.re.test(opener)) {
      score += h.weight;
      if (!kinds.includes(h.kind)) kinds.push(h.kind);
    }
  }
  return { score: Math.min(1, score), kinds };
}

export function fillerPenalty(text: string): number {
  const words = wordCount(text);
  if (!words) return 0;
  const fillers = (text.match(FILLER) ?? []).length;
  return Math.min(0.4, (fillers / words) * 4);
}

/**
 * How the clip ends, scored separately from how it starts.
 *
 * Averaging filler across the whole window lets a long clip open on a great
 * line, trail off into "um, yeah, anyway", and still win — the dead air gets
 * diluted by the good part. Viewers do not average. They remember the ending,
 * and a clip that fades out reads as an editing mistake.
 *
 * So the last stretch is judged on its own terms.
 */
export function tailPenalty(text: string): number {
  const sentences = text.split(SENTENCE_BREAK).filter(Boolean);
  if (!sentences.length) return 0;

  const tail = sentences.slice(-2).join(' ');
  const tailWords = wordCount(tail);
  if (!tailWords) return 0.3;

  const fillers = (tail.match(FILLER) ?? []).length;
  let penalty = Math.min(0.35, (fillers / tailWords) * 5);

  // A closing line of four words or fewer is almost always a trail-off
  // ("It was fine.") rather than a landing.
  const last = sentences[sentences.length - 1];
  if (wordCount(last) <= 4) penalty += 0.2;

  return Math.min(0.5, penalty);
}

/**
 * Build candidate windows that begin and end on cue boundaries.
 *
 * Anchoring to cues is what keeps clips from starting mid-word. Every window
 * here is already a set of whole spoken lines; the scoring only has to decide
 * which of them is worth cutting.
 */
export function candidates(cues: Cue[], opts: Required<PlanOptions>): Candidate[] {
  const out: Candidate[] = [];

  for (let i = 0; i < cues.length; i++) {
    for (let j = i; j < cues.length; j++) {
      const start = cues[i].start;
      const end = cues[j].end;
      const seconds = end - start;

      if (seconds < opts.minSeconds) continue;
      if (seconds > opts.maxSeconds) break;

      const text = cues.slice(i, j + 1).map((c) => c.text).join(' ').trim();
      const words = wordCount(text);
      const { score: hook, kinds } = hookScore(text);
      const pace = paceScore(words, seconds);
      const filler = fillerPenalty(text);
      const tail = tailPenalty(text);

      // A clip that ends on a full stop feels finished. One that trails off
      // reads as a mistake, however good the content was.
      const closed = ENDS_SENTENCE.test(text) ? 0.12 : 0;

      const score = Math.max(0, hook * 0.46 + pace * 0.32 + closed - filler - tail);

      out.push({ start, end, seconds, text, words, score, hooks: kinds });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Greedy pick, highest score first, skipping anything too close to a keeper. */
export function selectSegments(all: Candidate[], opts: Required<PlanOptions>): Segment[] {
  const kept: Candidate[] = [];

  for (const c of all) {
    if (kept.length >= opts.targetCount) break;

    const clashes = kept.some(
      (k) => c.start < k.end + opts.minGapSeconds && k.start < c.end + opts.minGapSeconds,
    );
    if (clashes) continue;
    kept.push(c);
  }

  return kept
    .sort((a, b) => a.start - b.start)
    .map((c, i) => ({
      id: `clip-${i + 1}`,
      start: Number(c.start.toFixed(2)),
      end: Number(c.end.toFixed(2)),
      seconds: Number(c.seconds.toFixed(2)),
      text: c.text,
      score: Number(c.score.toFixed(3)),
      hooks: c.hooks,
      title: titleFor(c),
      reason: reasonFor(c),
    }));
}

/** First clause of the opening line, trimmed to something postable. */
export function titleFor(c: Candidate): string {
  const first = c.text.split(SENTENCE_BREAK)[0] ?? c.text;
  const clean = first.replace(FILLER, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  const space = cut.lastIndexOf(' ');
  // Scripts without spaces have no word boundary to back up to.
  return `${space > 20 ? cut.slice(0, space) : cut}…`;
}

/** Shown under every clip, because an unexplained pick is just a guess. */
export function reasonFor(c: Candidate): string {
  const bits: string[] = [];
  if (c.hooks.includes('question')) bits.push('opens on a question');
  if (c.hooks.includes('number')) bits.push('has a specific figure');
  if (c.hooks.includes('claim')) bits.push('makes a flat claim');
  if (c.hooks.includes('turn')) bits.push('turns on a contradiction');
  if (c.hooks.includes('superlative')) bits.push('states an extreme');
  if (c.hooks.includes('personal')) bits.push('first-person');

  const pace = c.words / c.seconds;
  if (pace > 3.1) bits.push('fast delivery');
  else if (pace < 1.8) bits.push('slow, leaves room');

  if (tailPenalty(c.text) < 0.1) bits.push('lands its ending');
  if (!bits.length) bits.push('steady pace, finishes its thought');
  return bits.slice(0, 3).join(', ');
}

export function plan(cues: Cue[], options: PlanOptions = {}): CutPlan {
  const opts = { ...DEFAULTS, ...options };
  const all = candidates(cues, opts);
  const segments = selectSegments(all, opts);

  const duration = cues.length ? cues[cues.length - 1].end : 0;

  return {
    duration,
    segments,
    considered: all.length,
    coverage: duration
      ? Number((segments.reduce((s, x) => s + x.seconds, 0) / duration).toFixed(3))
      : 0,
  };
}
