import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type PublicQueue } from './api';
import { useLive } from './api/useLive';
import { BrandCross } from './ui/icons';

// Public screen: shows WAITING NUMBERS ONLY. The /api/public/queue payload contains no
// names, symptoms, ages, languages or locations, so nothing private can leak here.

const ROWS_PER_PAGE = Math.max(2, Number(import.meta.env.VITE_ROWS_PER_PAGE || 4));
const PAGE_MS = 10_000;
const DEPARTMENT = import.meta.env.VITE_DEPARTMENT_NAME || 'Provider waiting room';
const STAGE_W = 1280;
const STAGE_H = 720;

function timeLabel(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Scales the 1280×720 Figma stage to fill any TV resolution while keeping proportions. */
function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

/** Keeps the TV awake and hides the cursor when idle. */
function useKiosk() {
  useEffect(() => {
    type WL = { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
    const wl = (navigator as unknown as { wakeLock?: WL }).wakeLock;
    let lock: { release: () => Promise<void> } | null = null;
    const req = () => wl?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    void req();
    const onVis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', onVis);
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => { document.body.classList.remove('hide-cursor'); clearTimeout(t); t = setTimeout(() => document.body.classList.add('hide-cursor'), 3000); };
    window.addEventListener('mousemove', onMove);
    onMove();
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('mousemove', onMove); void lock?.release(); clearTimeout(t); };
  }, []);
}

function useNewNumbers(numbers: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = numbers.join(',');
  useEffect(() => {
    const cur = new Set(numbers);
    if (seen.current) {
      const added = numbers.filter((n) => !seen.current!.has(n));
      if (added.length) {
        setFresh(new Set(added));
        const id = setTimeout(() => setFresh(new Set()), 6000);
        seen.current = cur;
        return () => clearTimeout(id);
      }
    }
    seen.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

function StatusPill({ connection, updatedAt, error }: { connection: string; updatedAt: string | null; error: boolean }) {
  if (connection === 'live' && !error) {
    return (
      <div className="live-pill ok" role="status" data-testid="live-status">
        <span className="dot" /> Updated {timeLabel(updatedAt)}
      </div>
    );
  }
  if (connection === 'offline' || (error && !updatedAt)) {
    return (
      <div className="live-pill bad" role="status" data-testid="live-status">
        <span className="dot" /> Offline{updatedAt ? ` · last update ${timeLabel(updatedAt)}` : ''}
      </div>
    );
  }
  return (
    <div className="live-pill warn" role="status" data-testid="live-status">
      <span className="dot" /> {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      {updatedAt ? ` · ${timeLabel(updatedAt)}` : ''}
    </div>
  );
}

export default function App() {
  const scale = useStageScale();
  useKiosk();
  const fetcher = useCallback(() => api.getPublicQueue(), []);
  const live = useLive<PublicQueue>(fetcher, 'public');
  const q = live.data;

  const provider = q?.providerQueue ?? [];
  const pages = Math.max(1, Math.ceil(provider.length / ROWS_PER_PAGE));
  const [page, setPage] = useState(0);
  useEffect(() => { if (page >= pages) setPage(0); }, [page, pages]);
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS);
    return () => clearInterval(id);
  }, [pages]);
  const rows = provider.slice(page * ROWS_PER_PAGE, page * ROWS_PER_PAGE + ROWS_PER_PAGE);
  const fresh = useNewNumbers(provider.map((r) => r.waitingNumber));
  const freshCalled = useNewNumbers((q?.nowSeeing ?? []).map((r) => r.waitingNumber));
  const awaiting = [...(q?.inAssessment ?? []), ...(q?.awaitingNurse ?? [])].map((r) => r.waitingNumber);

  return (
    <div className="viewport">
      <div className="stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <header className="d-header">
          <div className="d-brand">
            <BrandCross size={24} />
            <span className="d-wordmark">SeenSooner</span>
          </div>
          <div className="d-context">
            <span className="d-dept">{DEPARTMENT.toUpperCase()}</span>
            <StatusPill connection={live.connection} updatedAt={q?.updatedAt ?? null} error={!!live.error} />
          </div>
        </header>

        <section className="d-title-row">
          <div>
            <h1>Provider wait estimates</h1>
            <p>Find your number below. Times are estimates and may change.</p>
          </div>
          <div className="estimate-notice">
            <p className="en-1">ESTIMATED TIMES</p>
            <p className="en-2">Not guaranteed wait times</p>
          </div>
        </section>

        <section className="d-body">
          <div className="queue-card" aria-live="polite">
            <div className="queue-head">
              <h2>Waiting to see a provider</h2>
              <span className="queue-head-right">{pages > 1 ? `Page ${page + 1} of ${pages}` : 'Estimated wait'}</span>
            </div>
            <div className="col-labels"><span>NUMBER</span><span>ESTIMATED WAIT</span></div>
            <div className="rows" data-testid="provider-rows">
              {!q && live.loading && Array.from({ length: ROWS_PER_PAGE }, (_, i) => <div key={i} className="row skeleton" />)}
              {!q && !live.loading && live.error && (
                <div className="empty error">Unable to load the queue. Retrying automatically…</div>
              )}
              {q && provider.length === 0 && <div className="empty">No one is waiting to see a provider right now.</div>}
              {rows.map((r) => (
                <div key={r.waitingNumber} className={`row ${fresh.has(r.waitingNumber) ? 'fresh' : ''}`} data-number={r.waitingNumber}>
                  <div className="row-id">
                    <p className="row-num">{r.waitingNumber}</p>
                    <p className="row-sub">Waiting for provider</p>
                  </div>
                  <div className="row-wait">
                    <p className="row-min">{r.remainingW2Low != null && r.remainingW2High != null ? `${Math.round(r.remainingW2Low)}–${Math.round(r.remainingW2High)} min` : `~${r.estimatedWaitMinutes} min`}</p>
                    <p className="row-est">remaining W2 estimate</p>
                  </div>
                </div>
              ))}
            </div>
            {awaiting.length > 0 && (
              <p className="awaiting" data-testid="awaiting-nurse">
                <span>Checked in · waiting for nurse assessment:</span> {awaiting.slice(0, 14).join('  ·  ')}
                {awaiting.length > 14 ? `  +${awaiting.length - 14} more` : ''}
              </p>
            )}
          </div>
          <aside className="now-card" aria-live="assertive">
            <h2>Now seeing</h2>
            <div className="now-list" data-testid="now-seeing">
              {(q?.nowSeeing ?? []).slice(0, 4).map((r) => (
                <div key={r.waitingNumber} className={`now-item ${freshCalled.has(r.waitingNumber) ? 'fresh' : ''}`}>
                  <p className="now-num">{r.waitingNumber}</p>
                  <p className="now-sub">Called · proceed with staff</p>
                </div>
              ))}
              {q && q.nowSeeing.length === 0 && <p className="now-empty">—</p>}
            </div>
          </aside>
        </section>

        <footer className="safety">
          <p className="s-1">If your symptoms worsen, tell staff now.</p>
          <p className="s-2">Do not wait for your number to ask for help.</p>
        </footer>
      </div>
    </div>
  );
}
