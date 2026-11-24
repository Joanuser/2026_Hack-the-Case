import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isMockMode, ApiRequestError, type ChangeEvent, type StaffPatient, type StaffPatientList } from './api';
import { useLive } from './api/useLive';
import { BrandCross, ChevronRight, Plus, Close } from './ui/icons';
import { DataTable, type Column } from './components/Table';
import { FilterPopover } from './components/FilterPopover';
import { FollowUpPanel, PatientPanel, type RunAction } from './components/Panels';
import { AddPatientModal } from './components/AddPatientModal';
import {
  ACCESS_LABEL, DEFAULT_FILTERS, DEFAULT_SORT, FOLLOW_UP_LABEL, PRIORITY, SOURCE_LABEL, STATUS_LABEL, WAIT_RANGE_LABEL,
  age, ago, applyFilters, inView, languageName, lastStaffContact, sortList, waitMinutes,
  type Filters, type Sort, type SortKey, type View,
} from './lib/model';

const LONG_WAIT = 60;

/** Every patient's preferred language, plus any accessibility needs, as badges under the name. */
function NeedBadges({ p }: { p: StaffPatient }) {
  const needs = p.accessibilityNeeds ?? [];
  return (
    <span className="need-badges">
      {p.language && <span className="need-badge lang" title="Preferred language">{languageName(p.language)}</span>}
      {needs.map((a) => <span key={a} className="need-badge">{ACCESS_LABEL[a] || a}</span>)}
    </span>
  );
}
const BACKEND_LABEL = import.meta.env.VITE_BACKEND_LABEL || 'SeenSooner API';

interface Toast { id: number; kind: 'info' | 'ok' | 'alert' | 'error'; text: string; patientId?: string | null }

const NAV: { view: View; label: string }[] = [
  { view: 'assessment', label: 'Assessment queue' },
  { view: 'followup', label: 'Waiting-room' },
  { view: 'in_assessment', label: 'In assessment' },
  { view: 'completed', label: 'Completed today' },
];

const VIEW_COPY: Record<View, { title: string; sub: string; listTitle: string; purpose: [string, string] }> = {
  assessment: {
    title: 'Assessment queue',
    sub: 'All check-ins waiting for nurse assessment — mobile, iPad, front desk and staff-assisted. Symptom changes rise to the top.',
    listTitle: 'Patients waiting for nurse assessment',
    purpose: ['HOW THIS LIST WORKS', 'AI summaries only organize what patients said. Triage priority is always set by a nurse.'],
  },
  followup: {
    title: 'Waiting-room follow-up',
    sub: 'Patients without live mobile updates need an in-person follow-up after the selected wait window.',
    listTitle: 'Patients needing an in-person update',
    purpose: ['WHY THIS LIST EXISTS', 'Includes iPad, front desk, and staff-assisted check-ins when patients cannot receive live mobile updates.'],
  },
  in_assessment: {
    title: 'In assessment',
    sub: 'Patients currently with a triage nurse. Set a priority to complete the assessment and add them to the provider queue.',
    listTitle: 'Patients in nurse assessment',
    purpose: ['NEXT STEP', 'Completing an assessment moves the patient to the provider queue and updates the waiting-room display.'],
  },
  completed: {
    title: 'Completed today',
    sub: 'Nurse assessments completed today, with each patient’s current stage.',
    listTitle: 'Assessed patients',
    purpose: ['DISPLAY UPDATES', 'Calling a patient to the care team shows their number under “Now seeing” on the waiting-room display.'],
  },
};

function readLocal<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}

function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

function ConnectionChip({ connection, lastSyncedAt, error, now }: { connection: string; lastSyncedAt: number | null; error: ApiRequestError | null; now: number }) {
  const secs = lastSyncedAt ? Math.max(0, Math.round((now - lastSyncedAt) / 1000)) : null;
  const synced = secs === null ? '' : secs < 60 ? `synced ${secs} sec ago` : `synced ${Math.floor(secs / 60)} min ago`;
  if (connection === 'offline' || (error && error.isNetwork)) {
    return <div className="conn bad" role="status" data-testid="conn"><span className="dot" /><b>Offline</b><span>· {synced || 'not synced'}</span></div>;
  }
  if (connection !== 'live') {
    return <div className="conn warn" role="status" data-testid="conn"><span className="dot" /><b>{connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</b>{synced && <span>· {synced}</span>}</div>;
  }
  return (
    <div className={`conn ${isMockMode ? 'mock' : 'ok'}`} role="status" data-testid="conn">
      <span className="dot" />
      <b>{isMockMode ? 'Mock data' : `${BACKEND_LABEL} connected`}</b>
      <span>· {synced}</span>
    </div>
  );
}

export default function App() {
  const now = useNow();
  const [view, setView] = useState<View>(() => (localStorage.getItem('ss.view') as View) || 'followup');
  const [filters, setFilters] = useState<Record<View, Filters>>(() => readLocal('ss.filters', DEFAULT_FILTERS));
  const [sorts, setSorts] = useState<Record<View, Sort>>(() => readLocal('ss.sorts', DEFAULT_SORT));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => { localStorage.setItem('ss.view', view); }, [view]);
  useEffect(() => { localStorage.setItem('ss.filters', JSON.stringify(filters)); }, [filters]);
  useEffect(() => { localStorage.setItem('ss.sorts', JSON.stringify(sorts)); }, [sorts]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === 'alert' ? 12000 : 5000);
  }, []);

  const onEvent = useCallback((e: ChangeEvent) => {
    if (e.type === 'checkin.created') toast({ kind: 'info', text: `New check-in ${e.waitingNumber ?? ''}`, patientId: e.patientId });
    else if (e.type === 'patient.symptoms_changed') toast({ kind: 'alert', text: `${e.waitingNumber ?? 'A patient'} reported a symptom change`, patientId: e.patientId });
    else if (e.type === 'patient.location_exit') toast({ kind: 'info', text: `${e.waitingNumber ?? 'A patient'} answered the location check`, patientId: e.patientId });
  }, [toast]);

  const fetcher = useCallback(() => api.listPatients(), []);
  const live = useLive<StaffPatientList>(fetcher, 'staff', { onEvent });
  const all = useMemo(() => live.data?.patients ?? [], [live.data]);

  const run: RunAction = useCallback(async (label, fn) => {
    try { await fn(); toast({ kind: 'ok', text: label }); await live.refresh(); return true; }
    catch (e) {
      const msg = e instanceof ApiRequestError ? (e.isNetwork ? 'Can’t reach the server — change not saved. Try again.' : e.message) : 'Something went wrong';
      toast({ kind: 'error', text: msg });
      return false;
    }
  }, [toast, live]);

  const counts = useMemo(() => {
    const c = { assessment: 0, followup: 0, in_assessment: 0, completed: 0 } as Record<View, number>;
    for (const p of all) {
      if (inView(p, 'assessment')) c.assessment++;
      if (inView(p, 'followup') && p.followUpStatus && p.followUpStatus !== 'checked') c.followup++;
      if (inView(p, 'in_assessment')) c.in_assessment++;
      if (inView(p, 'completed')) c.completed++;
    }
    return c;
  }, [all]);

  const base = useMemo(() => all.filter((p) => inView(p, view)), [all, view]);
  const f = filters[view];
  const sort = sorts[view];
  const rows = useMemo(() => sortList(applyFilters(base, f, view, now), sort, view, now), [base, f, view, now, sort]);
  const selected = selectedId ? all.find((p) => p.id === selectedId) ?? null : null;

  const setSort = (k: SortKey) => setSorts((s) => ({ ...s, [view]: s[view].key === k ? { key: k, dir: s[view].dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'wait' ? 'desc' : 'asc' } }));
  const setF = (nf: Filters) => setFilters((x) => ({ ...x, [view]: nf }));
  const switchView = (v: View) => { setView(v); setSelectedId(null); };

  const openPatient = (id: string | null | undefined) => {
    if (!id) return;
    const p = all.find((x) => x.id === id);
    if (p) {
      const v = (['assessment', 'in_assessment', 'followup', 'completed'] as View[]).find((vv) => inView(p, vv));
      if (v && !inView(p, view)) setView(v);
    }
    setSelectedId(id);
  };

  // ---------- metrics ----------
  const metrics: [string, number | string, string][] = (() => {
    if (view === 'followup') {
      const fu = base.filter((p) => p.followUpStatus && p.followUpStatus !== 'checked');
      return [
        ['NEED IN-PERSON UPDATE', fu.length, 'patients'],
        [`W2 ${LONG_WAIT}+ MIN`, fu.filter((p) => p.careDue).length, 'care reminders'],
        ['NO STAFF CONTACT', fu.filter((p) => !lastStaffContact(p)).length, 'since arrival'],
      ];
    }
    if (view === 'assessment') {
      const longest = base.reduce((m, p) => Math.max(m, waitMinutes(p, now)), 0);
      return [
        ['WAITING FOR NURSE', base.length, 'patients'],
        ['SYMPTOM CHANGES', base.filter((p) => p.symptomsChanged).length, 'to review'],
        ['LONGEST WAIT', base.length ? `${longest}` : '—', base.length ? 'min' : ''],
      ];
    }
    if (view === 'in_assessment') {
      return [
        ['IN ASSESSMENT', base.length, 'patients'],
        ['PRIORITY SET', base.filter((p) => p.nursePriority).length, 'ready to complete'],
        ['SYMPTOM CHANGES', base.filter((p) => p.symptomsChanged).length, 'to review'],
      ];
    }
    return [
      ['WAITING FOR PROVIDER', base.filter((p) => p.status === 'waiting_provider').length, 'patients'],
      ['WITH CARE TEAM', base.filter((p) => p.status === 'with_care_team').length, 'patients'],
      ['INACTIVE / CLOSED', base.filter((p) => ['inactive', 'left', 'completed'].includes(p.status)).length, 'patients'],
    ];
  })();

  // ---------- columns ----------
  const numberCol: Column<StaffPatient> = { key: 'num', label: 'NUMBER', sortKey: 'number', width: '64px', render: (p) => <span className="q-num">{p.waitingNumber}</span> };
  const waitCol: Column<StaffPatient> = { key: 'wait', label: 'W2 WAIT', sortKey: 'wait', width: '78px', render: (p) => <span className="bold">{p.triageCompletedAt ? `${waitMinutes(p, now)} min` : 'Not started'}</span> };
  const compact = !!selected;

  const followCols: Column<StaffPatient>[] = [
    numberCol,
    { key: 'patient', label: 'PATIENT', sortKey: 'patient', width: compact ? 'minmax(140px,1.4fr)' : 'minmax(180px,2.2fr)', render: (p) => (<div className="stack"><span className="name">{p.legalName}</span><span className="meta">{SOURCE_LABEL[p.source]}</span><NeedBadges p={p} /></div>) },
    waitCol,
    { key: 'loc', label: 'LOCATION', sortKey: 'location', width: compact ? 'minmax(90px,1fr)' : 'minmax(110px,1.3fr)', render: (p) => (p.location ? <div className="stack"><span className="name sm">{p.location.zone}</span><span className="meta">{p.location.seat}</span></div> : <span className="meta">Not recorded</span>) },
    { key: 'contact', label: 'LAST CONTACT', sortKey: 'contact', width: compact ? 'minmax(110px,1.1fr)' : 'minmax(140px,1.5fr)', render: (p) => { const c = lastStaffContact(p); return c ? <div className="stack"><span className="contact">{c.label}</span><span className="meta">{ago(c.at, now)}</span></div> : <div className="stack"><span className="contact">No staff update</span><span className="meta">Since arrival</span></div>; } },
    { key: 'status', label: 'STATUS', sortKey: 'status', width: compact ? '116px' : '150px', render: (p) => <span className={`fu-chip ${p.followUpStatus}`}>{p.followUpStatus ? FOLLOW_UP_LABEL[p.followUpStatus] : '—'}</span> },
    { key: 'action', label: 'ACTION', width: compact ? '116px' : '163px', render: (p) => (<button type="button" className="checkin-btn" onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); }}>Check in <ChevronRight size={16} /></button>) },
  ];

  const priorityChip = (p: StaffPatient) => (p.nursePriority ? <span className={`prio p${p.nursePriority}`} title={PRIORITY[p.nursePriority - 1].label}>ESI {p.nursePriority}</span> : <span className="prio none">Not set</span>);
  const concern = (p: StaffPatient) => (<div className="stack"><span className="concern">{p.summary?.text || p.symptoms.mainConcern}</span><span className="meta">{p.symptomsChanged ? <b className="red">Symptoms changed</b> : p.source === 'mobile' ? (p.summary?.editedByPatient ? 'Patient-corrected AI draft' : 'Patient reported · AI draft') : 'Staff entered'}{p.symptoms.painLevel != null ? ` · pain ${p.symptoms.painLevel}/10` : ''}</span></div>);

  const queueCols: Column<StaffPatient>[] = [
    { key: 'rank', label: '#', sortKey: 'rank', width: '34px', render: (p) => <span className="rank">{rows.indexOf(p) + 1}</span> },
    numberCol,
    { key: 'patient', label: 'PATIENT', sortKey: 'patient', width: 'minmax(150px,1.3fr)', render: (p) => { const a = age(p.dateOfBirth, now); return (<div className="stack"><span className="name">{p.legalName}</span><span className="meta">{a !== null ? `Age ${a} · ` : ''}{SOURCE_LABEL[p.source].replace(' check-in', '')}</span><NeedBadges p={p} /></div>); } },
    { key: 'concern', label: 'REPORTED CONCERN', sortKey: 'concern', width: 'minmax(180px,2fr)', render: concern },
    waitCol,
    view === 'completed'
      ? { key: 'status', label: 'STAGE', sortKey: 'status', width: '170px', render: (p) => <span className={`stage-chip ${p.status}`}>{STATUS_LABEL[p.status]}{p.status === 'waiting_provider' && p.remainingW2Low != null && p.remainingW2High != null ? ` · ${Math.round(p.remainingW2Low)}–${Math.round(p.remainingW2High)}m left` : ''}</span> }
      : { key: 'prio', label: 'PRIORITY', sortKey: 'priority', width: '96px', render: priorityChip },
    ...(view === 'completed' ? [{ key: 'prio', label: 'PRIORITY', sortKey: 'priority' as SortKey, width: '86px', render: priorityChip }] : []),
    { key: 'go', label: '', width: '24px', render: () => <ChevronRight size={16} className="muted-icon" /> },
  ];

  const copy = VIEW_COPY[view];
  const sortNote = sort.key === 'wait' ? (sort.dir === 'desc' ? 'Ordered by longest wait' : 'Ordered by shortest wait') : sort.key === 'rank' ? 'Ordered by queue position' : `Sorted by ${sort.key} (${sort.dir === 'asc' ? 'A→Z / low→high' : 'Z→A / high→low'})`;
  const chips: { label: string; clear?: () => void }[] = [];
  if (view === 'followup') chips.push({ label: 'No mobile updates' });
  if (f.wait !== 'all') chips.push({ label: `${WAIT_RANGE_LABEL[f.wait]} wait`, clear: () => setF({ ...f, wait: 'all' }) });
  if (f.method !== 'all') chips.push({ label: SOURCE_LABEL[f.method], clear: () => setF({ ...f, method: 'all' }) });
  if (view === 'followup' && f.followUp !== 'needs') chips.push({ label: f.followUp === 'all' ? 'Including checked' : 'Checked recently', clear: () => setF({ ...f, followUp: 'needs' }) });
  if (view === 'completed' && f.status !== 'all') chips.push({ label: STATUS_LABEL[f.status], clear: () => setF({ ...f, status: 'all' }) });
  if (view === 'assessment' && f.changedOnly) chips.push({ label: 'Symptom changes only', clear: () => setF({ ...f, changedOnly: false }) });

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><BrandCross size={28} /><span className="wordmark">Seen<span>Sooner</span></span></div>
        <div className="spacer" />
        <button type="button" className="add-btn" onClick={() => setAdding(true)} data-testid="add-patient"><Plus size={16} /> Add in-person check-in</button>
        <ConnectionChip connection={live.connection} lastSyncedAt={live.lastSyncedAt} error={live.error} now={Date.now()} />
        <div className="profile">
          <span className="avatar">RN</span>
          <div className="stack"><span className="name sm">{import.meta.env.VITE_STAFF_NAME || 'Triage nurse'}</span><span className="meta">Emergency department</span></div>
        </div>
      </header>

      <div className="content">
        <nav className="sidebar" aria-label="Workspace">
          <p className="side-title">WORKSPACE</p>
          {NAV.map((n) => (
            <button key={n.view} type="button" className={`nav ${view === n.view ? 'active' : ''}`} onClick={() => switchView(n.view)} aria-current={view === n.view ? 'page' : undefined} data-testid={`nav-${n.view}`}>
              {view === n.view ? <span className="bar" /> : <span className="navdot" />}
              <span className="nav-label">{n.label}</span>
              <span className="nav-count">{live.data ? counts[n.view] : '…'}</span>
            </button>
          ))}
          <div className="grow" />
          <div className="purpose"><p className="p-t">{copy.purpose[0]}</p><p className="p-b">{copy.purpose[1]}</p></div>
        </nav>

        <main className="main">
          <div className="title-row">
            <h1>{copy.title}</h1>
            <p>{copy.sub}</p>
          </div>

          {live.error && live.data && (
            <div className="banner warn" role="status">Showing data from {live.lastSyncedAt ? new Date(live.lastSyncedAt).toLocaleTimeString() : 'earlier'} — {live.error.isNetwork ? 'connection lost, retrying automatically.' : live.error.message}
              <button type="button" className="link" onClick={() => live.refresh()}>Retry now</button></div>
          )}

          <div className="metrics">
            {metrics.map(([l, v, s]) => (
              <div key={l} className="metric"><p className="m-label">{l}</p><div className="m-row"><p className="m-value">{live.data ? v : '–'}</p><p className="m-sup">{s}</p></div></div>
            ))}
          </div>

          <div className={`body ${selected ? 'with-panel' : ''}`}>
            <section className="list" aria-labelledby="list-title">
              <div className="list-head">
                <div className="stack">
                  <h2 id="list-title">{copy.listTitle}</h2>
                  <p className="meta">{sortNote}{view === 'followup' ? ' within this follow-up group.' : '.'}</p>
                </div>
                <div className="list-controls">
                  <FilterPopover view={view} filters={f} onChange={setF} onReset={() => setF(DEFAULT_FILTERS[view])} />
                  <span className="shown" data-testid="shown-count">{rows.length} shown</span>
                </div>
              </div>
              {chips.length > 0 && (
                <div className="chips">
                  <span className="chips-title">FILTERED GROUP</span>
                  {chips.map((c) => (
                    <span key={c.label} className="chip">{c.label}{c.clear && <button type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`}><Close size={12} /></button>}</span>
                  ))}
                </div>
              )}
              {!live.data && live.loading && <div className="loading-rows">{Array.from({ length: 5 }, (_, i) => <div key={i} className="sk" />)}</div>}
              {!live.data && !live.loading && live.error && (
                <div className="state-error" role="alert">
                  <p><b>Couldn’t load patients.</b> {live.error.isNetwork ? `Can’t reach ${api.baseUrl}.` : live.error.message}</p>
                  <button type="button" className="btn-sm primary" onClick={() => live.refresh()}>Try again</button>
                </div>
              )}
              {live.data && (
                <DataTable
                  testId={`table-${view}`}
                  columns={view === 'followup' ? followCols : queueCols}
                  rows={rows}
                  sort={sort}
                  onSort={setSort}
                  selectedId={selectedId}
                  onSelect={(p) => setSelectedId(p.id === selectedId ? null : p.id)}
                  marker={(p) => (p.symptomsChanged ? 'urgent' : p.careDue ? 'overdue' : null)}
                  rowClass={(p) => (p.symptomsChanged ? 'changed' : '')}
                  empty={base.length === 0 ? (view === 'followup' ? 'No patients need an in-person update right now.' : 'No patients in this area right now.') : 'No patients match these filters.'}
                />
              )}
            </section>
            {selected && (view === 'followup'
              ? <FollowUpPanel p={selected} now={now} run={run} onClose={() => setSelectedId(null)} />
              : <PatientPanel p={selected} now={now} run={run} onClose={() => setSelectedId(null)} />)}
          </div>
        </main>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'alert' || t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            {t.patientId && <button type="button" className="link" onClick={() => openPatient(t.patientId)}>View</button>}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}><Close size={14} /></button>
          </div>
        ))}
      </div>

      {adding && (
        <AddPatientModal
          onClose={() => setAdding(false)}
          onCreated={(p) => { setAdding(false); toast({ kind: 'ok', text: `${p.waitingNumber} added — ${SOURCE_LABEL[p.source]}` }); void live.refresh().then(() => { setView('assessment'); setSelectedId(p.id); }); }}
        />
      )}
    </div>
  );
}
