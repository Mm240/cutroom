/** One line of transcript with its timing, as a caption track provides it. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface PlanOptions {
  minSeconds?: number;
  maxSeconds?: number;
  targetCount?: number;
  minGapSeconds?: number;
}

export interface Candidate {
  start: number;
  end: number;
  seconds: number;
  text: string;
  words: number;
  score: number;
  hooks: string[];
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  seconds: number;
  text: string;
  score: number;
  hooks: string[];
  title: string;
  /** Why this moment was chosen, in plain words. */
  reason: string;
}

export interface CutPlan {
  duration: number;
  segments: Segment[];
  /** How many windows were scored to find these. */
  considered: number;
  /** Fraction of the source that ended up in clips. */
  coverage: number;
}

/** One deliverable: a clip rendered for one place it will be posted. */
export interface Render {
  id: string;
  segmentId: string;
  format: string;
  label: string;
  aspect: string;
  width: number;
  height: number;
  url: string;
  poster: string;
}
