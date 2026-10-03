const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export interface Format {
  id: string; label: string; where: string; aspect: string;
  width: number; height: number; captions: boolean;
}

export interface Language { code: string; label: string; native: string }

export interface Segment {
  id: string; start: number; end: number; seconds: number;
  text: string; score: number; hooks: string[]; title: string; reason: string;
}

export interface Render {
  id: string; segmentId: string; format: string; label: string;
  aspect: string; width: number; height: number; url: string; poster: string;
}

export interface Job {
  id: string; name: string; stage: string; progress: number; error?: string;
  payload: {
    asset?: { language?: string };
    preview?: string;
    reused?: boolean;
    heard?: { done: number; total: number };
    duration?: number;
    cueCount?: number;
    plan?: { duration: number; segments: Segment[]; considered: number; coverage: number };
    renders?: Render[];
    strips?: Record<string, string[]>;
  };
}

export async function getFormats(): Promise<Format[]> {
  const r = await fetch(`${BASE}/api/formats`);
  if (!r.ok) throw new Error('Could not load formats');
  return r.json();
}

export async function getLanguages(): Promise<Language[]> {
  const r = await fetch(`${BASE}/api/languages`);
  if (!r.ok) throw new Error('Could not load languages');
  return r.json();
}

export async function submit(video: File, clips: number, language: string) {
  const form = new FormData();
  form.append('video', video);
  form.append('clips', String(clips));
  form.append('language', language);
  const r = await fetch(`${BASE}/api/videos`, { method: 'POST', body: form });
  if (!r.ok) throw new Error((await r.text()) || 'Upload failed');
  return (await r.json()) as { jobId: string };
}

export async function poll(id: string): Promise<Job> {
  const r = await fetch(`${BASE}/api/videos/${id}`);
  if (!r.ok) throw new Error('Could not reach the job');
  return r.json();
}
