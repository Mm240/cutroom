import { useEffect, useState } from 'react';
import type { Format, Render, Segment } from '../api';

export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The landing pitch, shown until a video is chosen. */
export function Hero() {
  return (
    <section className="hero">
      <span className="eyebrow">Long video → short clips, automatically</span>
      <h2 className="hero-title">
        One long video in.<br />
        <em>A week of clips</em> out.
      </h2>
      <p className="hero-sub">
        Cutroom listens to the whole thing, finds the moments people actually share, and cuts
        each one for Reels, feed and YouTube — reframed on the speaker, captions burned in.
      </p>

      {/* The four shapes every clip comes back in, drawn to their real aspect ratios. */}
      <div className="shapes" aria-hidden>
        {[
          ['9:16', 'Reels · Shorts · TikTok', 9 / 16],
          ['1:1', 'Feed', 1],
          ['4:5', 'Portrait feed', 4 / 5],
          ['16:9', 'YouTube', 16 / 9],
        ].map(([label, where, ratio], i) => (
          <div className="shape" key={label as string} style={{ animationDelay: `${i * 90}ms` }}>
            <div className="shape-box" style={{ aspectRatio: String(ratio) }}>
              <span className="tc">{label}</span>
            </div>
            <small>{where}</small>
          </div>
        ))}
      </div>

      <ul className="perks">
        <li><b>Cuts on whole sentences</b> — never mid-word</li>
        <li><b>Follows the speaker</b> with subject tracking</li>
        <li><b>Captions burned in</b> for muted autoplay</li>
        <li><b>30+ languages</b> — Hindi, Tamil, Spanish, Japanese…</li>
      </ul>
    </section>
  );
}

const STAGES = [
  { key: 'uploading', label: 'Uploading', hint: 'Sending your video to Cloudinary.' },
  { key: 'transcribing', label: 'Listening', hint: 'Transcribing every word — usually just a few seconds.' },
  { key: 'planning', label: 'Choosing moments', hint: 'Scoring thousands of windows for hooks, pace and endings.' },
  { key: 'rendering', label: 'Cutting', hint: 'Reframing and captioning each clip for every format.' },
];

function useElapsed(since?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return since ? Math.max(0, (now - since) / 1000) : 0;
}

export function Stages({
  stage, progress, startedAt, reused, heard,
}: {
  stage: string; progress: number; startedAt?: number; reused: boolean;
  heard?: { done: number; total: number };
}) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  const done = stage === 'ready';
  const elapsed = useElapsed(startedAt);
  const current = STAGES[idx];

  return (
    <div className="running">
      <ol className="stages">
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            data-on={done || (idx > -1 && i < idx) ? 'done' : i === idx ? 'now' : 'todo'}
          >
            <span className="dot" aria-hidden>{done || i < idx ? '✓' : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="bar">
        <span style={{ width: `${Math.max(3, progress)}%` }} />
      </div>
      <div className="running-foot">
        <span>
          {stage === 'transcribing' && heard?.total
            ? `Listening to ${heard.total} parts in parallel — ${heard.done} of ${heard.total} heard.`
            : reused && stage === 'transcribing'
              ? 'Transcript already on file — skipping ahead.'
              : current?.hint}
        </span>
        <span className="tc">{timecode(elapsed)}</span>
      </div>
    </div>
  );
}

/**
 * One clip.
 *
 * The filmstrip across the middle is the point of this card. A poster frame
 * tells you almost nothing about a thirty-second clip; six frames spread
 * across it tell you whether the shot holds, whether the speaker is actually
 * in frame, and whether the auto-tracking worked. It is a quality check
 * disguised as decoration.
 */
export function ClipCard({
  rank,
  segment,
  renders,
  frames,
  formats,
}: {
  rank: number;
  segment: Segment;
  renders: Render[];
  frames: string[];
  formats: Format[];
}) {
  const mine = renders.filter((r) => r.segmentId === segment.id);
  const [active, setActive] = useState(mine[0]?.format ?? 'vertical');
  const [copied, setCopied] = useState(false);
  const current = mine.find((r) => r.format === active) ?? mine[0];
  const score = Math.round(Math.min(1, segment.score) * 100);

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the download link still works */ }
  }

  return (
    <article className={`clip ${rank === 1 ? 'top' : ''}`} style={{ animationDelay: `${Math.min(rank, 8) * 60}ms` }}>
      <div className="clip-top">
        <div className="rank tc" aria-label={`Rank ${rank}`}>
          {rank === 1 ? <span className="crown">Top pick</span> : null}
          #{rank}
        </div>
        <div className="clip-head">
          <h3 className="clip-title">{segment.title}</h3>
          <div className="chips">
            <span className="chip why">{segment.reason}</span>
            {segment.hooks.map((h) => (
              <span className="chip" key={h}>{h}</span>
            ))}
          </div>
        </div>
        <div className="stamp">
          <div className="score" style={{ ['--s' as any]: `${score}%` }} title="Clip score">
            <span className="tc">{score}</span>
          </div>
          <div className="dur tc">{segment.seconds.toFixed(0)}s</div>
          <div className="at tc">{timecode(segment.start)}–{timecode(segment.end)}</div>
        </div>
      </div>

      {frames?.length > 0 && (
        <div className="strip">
          {frames.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}

      <div className="clip-body">
        {current && (
          <div className="player-wrap">
            <video
              key={current.id}
              className={`player v-${current.format}`}
              src={current.url}
              poster={current.poster}
              controls
              preload="none"
              playsInline
            />
          </div>
        )}

        <div className="clip-side">
          <blockquote className="quote">“{segment.text}”</blockquote>

          <div className="formats">
            {mine.map((r) => {
              const f = formats.find((x) => x.id === r.format);
              return (
                <button
                  key={r.id}
                  className="fmt"
                  aria-pressed={active === r.format}
                  onClick={() => setActive(r.format)}
                >
                  <b className="tc">{r.aspect}</b> {r.label}
                  {f && <small>{f.where}</small>}
                </button>
              );
            })}
          </div>

          {current && (
            <div className="actions">
              <a className="btn go" href={current.url} download target="_blank" rel="noreferrer">
                ↓ Download {current.aspect}
              </a>
              <button className="btn ghost" onClick={copy}>{copied ? '✓ Copied' : 'Copy link'}</button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function Yield({
  segments,
  renders,
  duration,
  formats,
}: {
  segments: Segment[];
  renders: Render[];
  duration: number;
  formats: number;
}) {
  if (!segments.length) return null;
  const clipSeconds = segments.reduce((t, s) => t + s.seconds, 0);

  return (
    <section className="yield">
      <div className="yield-lead">
        <span className="eyebrow">Your cut is ready</span>
        <h2>
          <span className="big">{renders.length}</span> ready-to-post videos
        </h2>
      </div>
      <div className="tiles">
        <div className="tile"><b className="tc">{segments.length}</b><span>moments found</span></div>
        <div className="tile"><b className="tc">{timecode(duration)}</b><span>of footage watched</span></div>
        <div className="tile"><b className="tc">{timecode(clipSeconds)}</b><span>worth keeping</span></div>
        {formats > 0 && <div className="tile"><b className="tc">{formats}</b><span>formats each</span></div>}
      </div>
    </section>
  );
}
