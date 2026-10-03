/**
 * Where a clip ends up, and what that place does to it.
 *
 * Each entry is a real constraint, not a preset. Vertical platforms crop the
 * sides off a landscape frame, so the speaker has to be tracked rather than
 * centre-cropped. Feed video is watched on mute, so captions are not optional.
 */
export interface Format {
  id: string;
  label: string;
  where: string;
  aspect: string;
  width: number;
  height: number;
  maxSeconds?: number;
  /** Burn captions into the frame — the platform plays muted by default. */
  captions: boolean;
  /** Keep clear of the platform's own interface, as a fraction of height. */
  safeTop?: number;
  safeBottom?: number;
}

export const FORMATS: Format[] = [
  {
    id: 'vertical',
    label: 'Vertical',
    where: 'Reels, Shorts, TikTok',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    maxSeconds: 90,
    captions: true,
    safeTop: 0.1,
    safeBottom: 0.2,
  },
  {
    id: 'square',
    label: 'Square',
    where: 'Feed posts',
    aspect: '1:1',
    width: 1080,
    height: 1080,
    captions: true,
  },
  {
    id: 'portrait',
    label: 'Portrait',
    where: 'Feed, taller crop',
    aspect: '4:5',
    width: 1080,
    height: 1350,
    captions: true,
  },
  {
    id: 'wide',
    label: 'Wide',
    where: 'YouTube, X, LinkedIn',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    maxSeconds: 140,
    captions: false,
  },
];

export const formatById = (id: string) => FORMATS.find((f) => f.id === id);
