import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getConfig, getFormats, getLanguages, poll, submit,
  type ApiConfig, type Format, type Job, type Language,
} from './api';
import { ClipCard, Hero, Stages, Yield } from './components/Cutroom';

const LANG_KEY = 'cutroom.language';
const PASS_KEY = 'cutroom.passcode';

function saved(key: string, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* remembered for this visit only */ }
}

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [formats, setFormats] = useState<Format[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [language, setLanguage] = useState(() => saved(LANG_KEY, 'en-US'));
  const [config, setConfig] = useState<ApiConfig>();
  const [passcode, setPasscode] = useState(() => saved(PASS_KEY));
  const [file, setFile] = useState<File | null>(null);
  const [clips, setClips] = useState(6);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string>();
  const [hot, setHot] = useState(false);
  const [sending, setSending] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const timer = useRef<number>();

  useEffect(() => {
    getFormats().then(setFormats).catch(() => setError('API not reachable — is it running?'));
    getLanguages().then(setLanguages).catch(() => undefined);
    getConfig().then(setConfig).catch(() => undefined);
    // A job in the URL survives a reload, mid-run or after.
    const id = new URLSearchParams(window.location.search).get('job');
    if (id) follow(id);
    return () => window.clearInterval(timer.current);
  }, []);

  // Show the chosen file straight away, before anything is uploaded.
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const take = useCallback((f?: File | null) => {
    if (!f) return;
    setFile(f);
    setJob(null);
    setError(undefined);
  }, []);

  function follow(jobId: string) {
    window.clearInterval(timer.current);
    const tick = async () => {
      try {
        const next = await poll(jobId);
        setJob(next);
        if (next.stage === 'ready' || next.stage === 'failed') {
          window.clearInterval(timer.current);
          if (next.stage === 'failed') setError(next.error ?? 'Something stopped partway.');
        }
      } catch (e: any) {
        window.clearInterval(timer.current);
        setError(e.message);
      }
    };
    tick();
    timer.current = window.setInterval(tick, 1500);
  }

  function reset() {
    window.history.replaceState(null, '', window.location.pathname);
    window.clearInterval(timer.current);
    setFile(null);
    setJob(null);
    setError(undefined);
    setSending(false);
    setStartedAt(undefined);
  }

  async function start() {
    if (!file || sending) return;
    setError(undefined);
    setSending(true);
    setStartedAt(Date.now());
    try {
      const { jobId } = await submit(file, clips, language, passcode || undefined);
      setSending(false);
      window.history.replaceState(null, '', `?job=${jobId}`);
      follow(jobId);
    } catch (e: any) {
      setSending(false);
      setError(e.message);
    }
  }

  function chooseLanguage(code: string) {
    setLanguage(code);
    remember(LANG_KEY, code);
  }

  const p = job?.payload;
  const spoken = languages.find((l) => l.code === (p?.asset?.language ?? language));
  const running = sending || (!!job && job.stage !== 'ready' && job.stage !== 'failed');
  const ready = job?.stage === 'ready';
  const segments = useMemo(
    () => [...(p?.plan?.segments ?? [])].sort((a, b) => b.score - a.score),
    [p?.plan?.segments],
  );

  return (
    <div className="shell">
      <header className="head">
        <h1 className="mark"><i />Cutroom</h1>
        <div className="head-right">
          {p?.plan && (
            <span className="note tc">
              {p.plan.considered.toLocaleString()} windows scored · {p.cueCount} lines heard
            </span>
          )}
          <span className="pill">Powered by Cloudinary AI</span>
        </div>
      </header>

      {!file && !job && <Hero />}

      <section className={`intake ${running ? 'is-running' : ''}`}>
        {!file && !job ? (
          <label
            className={`drop ${hot ? 'hot' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setHot(true); }}
            onDragLeave={() => setHot(false)}
            onDrop={(e) => { e.preventDefault(); setHot(false); take(e.dataTransfer.files?.[0]); }}
          >
            <input type="file" accept="video/*" hidden onChange={(e) => take(e.target.files?.[0])} />
            <span className="drop-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
            </span>
            <h2>Drop a long video here</h2>
            <p>Podcast, lecture, livestream, interview. Or <u>browse your files</u>.</p>
            <span className="drop-meta tc">MP4 · MOV · WEBM — up to {config?.maxUploadMb ?? 500} MB</span>
          </label>
        ) : (
          <div className="source">
            <div className="source-media">
              {(p?.preview || localUrl) && (
                <video className="player v-wide" src={p?.preview ?? localUrl} controls preload="metadata" playsInline />
              )}
            </div>
            <div className="source-info">
              <span className="eyebrow">Source</span>
              <div className="source-name" title={job?.name ?? file?.name}>{job?.name ?? file?.name}</div>
              <div className="source-meta tc">
                {file && <span>{megabytes(file.size)}</span>}
                {p?.duration ? <span>{Math.round(p.duration / 60)} min</span> : null}
                {job && spoken && <span>{spoken.native} · {spoken.label}</span>}
                {p?.reused && <span className="flash">⚡ Seen before — transcript reused</span>}
              </div>

              {running && (
                <Stages
                  stage={job?.stage ?? 'uploading'}
                  progress={job?.progress ?? 2}
                  startedAt={startedAt}
                  reused={!!p?.reused}
                  heard={p?.heard}
                />
              )}

              {!running && !ready && (
                <div className="controls">
                  <label className="field">
                    <span>Spoken in</span>
                    <select
                      className="select"
                      value={language}
                      onChange={(e) => chooseLanguage(e.target.value)}
                    >
                      {(languages.length ? languages : [{ code: 'en-US', label: 'English (US)', native: 'English' }]).map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.native === l.label ? l.label : `${l.native} — ${l.label}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field">
                    <span>Clips to find</span>
                    <div className="stepper">
                      <button onClick={() => setClips((c) => Math.max(1, c - 1))} aria-label="Fewer">−</button>
                      <span className="tc">{clips}</span>
                      <button onClick={() => setClips((c) => Math.min(12, c + 1))} aria-label="More">+</button>
                    </div>
                  </div>
                  {config?.passcodeRequired && (
                    <label className="field">
                      <span>Passcode</span>
                      <input
                        className="select passcode"
                        type="password"
                        value={passcode}
                        placeholder="Required to upload"
                        onChange={(e) => { setPasscode(e.target.value); remember(PASS_KEY, e.target.value); }}
                      />
                    </label>
                  )}
                  <button
                    className="btn go big"
                    onClick={start}
                    disabled={!file || (config?.passcodeRequired && !passcode)}
                  >
                    <span aria-hidden>✂</span> Find the moments
                  </button>
                </div>
              )}

              {(file || job) && !running && (
                <button className="btn ghost small" onClick={reset}>
                  {ready ? '↺ Cut another video' : 'Choose a different video'}
                </button>
              )}
            </div>
          </div>
        )}

        {error && <div className="alarm">{error}</div>}
      </section>

      {ready && (
        <>
          <Yield
            segments={segments}
            renders={p?.renders ?? []}
            duration={p?.plan?.duration ?? 0}
            formats={formats.length}
          />
          <div className="clips">
            {segments.map((s, i) => (
              <ClipCard
                key={s.id}
                rank={i + 1}
                segment={s}
                renders={p?.renders ?? []}
                frames={p?.strips?.[s.id] ?? []}
                formats={formats}
              />
            ))}
          </div>
        </>
      )}

      <footer className="foot">
        Cuts land on speech boundaries · every pick comes with its reason
      </footer>
    </div>
  );
}
