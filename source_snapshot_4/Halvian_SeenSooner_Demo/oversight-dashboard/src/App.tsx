import { useEffect, useMemo, useRef, useState } from 'react';
import fixtureMonthly from './data/monthly-oversight.json';
import bundledProjection from './data/neutral-what-if.json';
import { HorizontalBarChart, LineChart } from './components/Charts';

type Tab = 'monthly' | 'projection';
type MetricKey = 'doorToProviderMedianMin' | 'lwbsRatePct' | 'uninsuredWalkoutGapPp' | 'missedHighRiskPct' | 'nurseOverridePct';
type MonthlyData = typeof fixtureMonthly;

interface ProjectionArm {
  arm: string;
  meanWMin: number;
  medianWMin?: number;
  p90WMin?: number;
  lwbsRatePct: number;
  evidenceTag?: string;
}

interface ProjectionData {
  projectionType: string;
  totalVisits: number;
  historicallyRoomedVisits: number;
  historicalLwbsCount: number;
  wDefinition: string;
  wCohort: string;
  baseline: { meanWMin: number; medianWMin: number; p90WMin: number; lwbsRatePct: number };
  combined: { meanWMin: number; medianWMin: number; p90WMin: number; lwbsRatePct: number };
  reductions: { meanWMin: number; meanWPct: number; medianWMin: number; p90WMin: number; lwbsPp: number };
  assumptions: typeof bundledProjection.assumptions;
  status: { realInterventionEffect: string; clinicalSafety: string; capacityValidation: string };
  fourArms: ProjectionArm[];
}

interface OversightSummary {
  generatedAt: string;
  syntheticOnly: boolean;
  containsPatientIdentifiers: boolean;
  liveRuntime: {
    context: string;
    updatedAt: string;
    patientCount: number;
    statusCounts: Record<string, number>;
    eligibleProviderQueueCount: number;
    currentRemainingW2: { n: number; meanMin: number | null; medianMin: number | null };
    completedW2: { n: number; meanMin: number | null; medianMin: number | null; p90Min: number | null };
  };
  model: { context: string; loaded: boolean; artifact: string; sha256: string | null; loadError: string | null; changesNurseConfirmedEsi: boolean };
  evaluations: {
    w2: null | { context: string; model: string; n: number; maeMin: number; p90AbsoluteErrorMin: number; intervalCoverage: number; source: string };
    lwbs: null | { context: string; model: string; n: number; positiveN: number; rocAuc: number; prAuc: number; brierScore: number; source: string };
  };
  projectTarget: { baselineRatePct: number; targetRatePct: number; differencePp: number; evidenceTag: string };
  neutralProjection: null | Omit<ProjectionData, 'projectionType' | 'totalVisits' | 'historicallyRoomedVisits' | 'historicalLwbsCount' | 'wCohort' | 'assumptions'>;
  errors: string[];
}

type BackendState = { status: 'loading' | 'connected' | 'unavailable'; data: OversightSummary | null; message: string };

const cloneFixture = (): MonthlyData => JSON.parse(JSON.stringify(fixtureMonthly)) as MonthlyData;
const fmt = (value: number, digits = 1) => value.toFixed(digits);
const signed = (value: number, digits = 1) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const displayMetric = (value: number | null, digits = 1) => value === null ? '—' : value.toFixed(digits);

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

function ArrowDown() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4 4.5-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function InfoIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function AlertIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.4 18 17H2L10 2.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 7v4.5M10 14v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

interface KpiProps {
  label: string;
  value: string;
  unit?: string;
  change: string;
  note: string;
  tone: 'good' | 'watch' | 'neutral';
}

function KpiCard({ label, value, unit, change, note, tone }: KpiProps) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div className="kpi-head"><span>{label}</span><InfoIcon /></div>
      <div className="kpi-value">{value}<small>{unit}</small></div>
      <div className="kpi-foot"><span className={`delta ${tone}`}>{change}</span><span>{note}</span></div>
    </article>
  );
}

interface EditDialogProps {
  open: boolean;
  period: string;
  values: Record<MetricKey, number>;
  onClose: () => void;
  onSave: (values: Record<MetricKey, number>) => void;
}

const editLabels: Record<MetricKey, { label: string; unit: string; min: number; max: number }> = {
  doorToProviderMedianMin: { label: 'Door-to-provider median', unit: 'min', min: 0, max: 240 },
  lwbsRatePct: { label: 'LWBS rate', unit: '%', min: 0, max: 100 },
  uninsuredWalkoutGapPp: { label: 'Uninsured walk-out gap', unit: 'pp', min: -100, max: 100 },
  missedHighRiskPct: { label: 'Missed high-risk cases', unit: '%', min: 0, max: 100 },
  nurseOverridePct: { label: 'Nurse override rate', unit: '%', min: 0, max: 100 },
};

function EditDialog({ open, period, values, onClose, onSave }: EditDialogProps) {
  const [draft, setDraft] = useState(values);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setDraft(values); setTimeout(() => firstRef.current?.focus(), 0); } }, [open, values]);
  if (!open) return null;
  const keys = Object.keys(editLabels) as MetricKey[];
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div className="modal-head">
          <div><span className="eyebrow">SESSION-ONLY DEMO EDIT</span><h2 id="edit-title">Edit {period}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close editor">×</button>
        </div>
        <p className="modal-note">Changes update this browser session only. They are never sent to a backend and do not alter the source fixture.</p>
        <div className="edit-grid">
          {keys.map((key, i) => (
            <label key={key}>{editLabels[key].label}<span className="input-wrap"><input ref={i === 0 ? firstRef : undefined} type="number" step="0.01" min={editLabels[key].min} max={editLabels[key].max} value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))} /><b>{editLabels[key].unit}</b></span></label>
          ))}
        </div>
        <div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => onSave(draft)}>Apply local edit</button></div>
      </section>
    </div>
  );
}

function BackendContext({ backend }: { backend: BackendState }) {
  const data = backend.data;
  const live = data?.liveRuntime;
  return (
    <section className={`backend-card ${backend.status}`} aria-live="polite">
      <div className="backend-head">
        <div><span className="eyebrow">SHARED PYTHON API · AGGREGATE ONLY</span><h2>Local synthetic runtime context</h2></div>
        <span className={`connection-badge ${backend.status}`}><i />{backend.status === 'connected' ? 'API CONNECTED' : backend.status === 'loading' ? 'CONNECTING' : 'API UNAVAILABLE'}</span>
      </div>
      {live ? (
        <>
          <div className="backend-metrics">
            <span><small>SYNTHETIC RECORDS IN MEMORY</small><b>{live.patientCount}</b></span>
            <span><small>ELIGIBLE W2 QUEUE</small><b>{live.eligibleProviderQueueCount}</b></span>
            <span><small>MEAN REMAINING W2</small><b>{displayMetric(live.currentRemainingW2.meanMin)} min</b></span>
            <span><small>COMPLETED W2 MEDIAN</small><b>{displayMetric(live.completedW2.medianMin)} min</b></span>
            <span><small>ROOM-ENTRY W2 RECORDS</small><b>{live.completedW2.n}</b></span>
          </div>
          <p><b>Context:</b> live local synthetic runtime aggregate. No patient identifiers are returned. This is operational demo state, not a hospital performance result. Updated {new Date(live.updatedAt).toLocaleTimeString()}.</p>
        </>
      ) : <p>{backend.message} The monthly charts below remain bundled illustrative UI mock data.</p>}
    </section>
  );
}

function ModelEvidence({ backend }: { backend: BackendState }) {
  const data = backend.data;
  if (!data) return null;
  const w2 = data.evaluations.w2;
  const lwbs = data.evaluations.lwbs;
  return (
    <section className="model-grid" aria-label="Model and evidence context">
      <article><span className="eyebrow">DEPLOYED LOCAL W2 MODEL</span><h2>{data.model.loaded ? 'Model artifact loaded' : 'Model unavailable'}</h2><p><b>{data.model.artifact}</b> · nurse-confirmed ESI is never changed · synthetic local inference only.</p><span className={`status-badge ${data.model.loaded ? 'ok' : 'danger'}`}>{data.model.loaded ? 'LOADED' : 'CHECK REQUIRED'}</span></article>
      <article><span className="eyebrow">OFFLINE W2 EVALUATION</span><h2>{w2 ? `${w2.maeMin.toFixed(2)} min MAE` : 'Unavailable'}</h2><p>{w2 ? `Held-out synthetic n=${w2.n.toLocaleString()} · P90 absolute error ${w2.p90AbsoluteErrorMin.toFixed(2)} min · not a clinical validation.` : 'No evaluation record was returned.'}</p></article>
      <article><span className="eyebrow">OFFLINE LWBS ANALYSIS</span><h2>{lwbs ? `${lwbs.rocAuc.toFixed(3)} ROC-AUC` : 'Unavailable'}</h2><p>{lwbs ? `Held-out synthetic n=${lwbs.n.toLocaleString()} · PR-AUC ${lwbs.prAuc.toFixed(3)} · classifier is not deployed and does not establish intervention effect.` : 'No evaluation record was returned.'}</p></article>
      <article><span className="eyebrow">PROJECT TARGET · NOT AN OUTCOME</span><h2>{data.projectTarget.baselineRatePct.toFixed(1)}% → {data.projectTarget.targetRatePct.toFixed(1)}%</h2><p>LWBS planning target only ({data.projectTarget.differencePp.toFixed(1)} pp). It is distinct from the 3.20% hypothetical neutral projection.</p><span className="status-badge warn">TARGET NOT OBSERVED</span></article>
    </section>
  );
}

function MonthlyOversight({ data, selectedIndex, backend }: { data: MonthlyData; selectedIndex: number; backend: BackendState }) {
  const m = data.metrics;
  const t = data.targets;
  const period = data.periods[selectedIndex];
  const baseline = 0;
  const previous = Math.max(0, selectedIndex - 1);
  const dtpChange = m.doorToProviderMedianMin[selectedIndex] - m.doorToProviderMedianMin[baseline];
  const lwbsChange = m.lwbsRatePct[selectedIndex] - m.lwbsRatePct[baseline];
  const gapChange = m.uninsuredWalkoutGapPp[selectedIndex] - m.uninsuredWalkoutGapPp[baseline];
  const medicaidChange = m.medicaidWalkoutGapPp[selectedIndex] - m.medicaidWalkoutGapPp[previous];
  const override = m.nurseOverridePct[selectedIndex];
  const alerts = [
    medicaidChange > 0.05 ? `Illustrative Medicaid gap rose ${medicaidChange.toFixed(1)} pp from the prior period.` : null,
    m.missedHighRiskPct[selectedIndex] > t.missedHighRiskPct ? 'Illustrative missed high-risk rate is above the demo review threshold.' : null,
    override < t.nurseOverridePctMin || override > t.nurseOverridePctMax ? 'Illustrative override rate is outside the demo review range.' : null,
  ].filter(Boolean) as string[];

  const actions = [
    medicaidChange > 0.05 ? 'Review the illustrative Medicaid check-in path with the committee; no operational action is triggered.' : 'Continue monitoring payer gaps in the illustrative series.',
    m.uninsuredWalkoutGapPp[selectedIndex] > t.uninsuredWalkoutGapPp ? 'Discuss possible drivers of the illustrative uninsured gap before considering any intervention.' : 'Maintain payer-equity monitoring.',
    'Keep the dashboard in observational mode. Any pause or workflow decision remains with authorized clinical leadership.',
  ];
  const payer = data.payerLwbsRatePct;

  return (
    <>
      <BackendContext backend={backend} />
      <section className="evidence-strip" role="note">
        <span className="evidence-tag">ILLUSTRATIVE_UI_MOCK_DATA</span>
        <p>{data.disclaimer} Values on this tab may be edited locally for committee demonstrations.</p>
      </section>

      <section className="summary-card">
        <div className="summary-main">
          <div className="section-kicker"><span className="sparkle">✦</span> OVERSIGHT SUMMARY · {period.toUpperCase()}</div>
          <h1>Illustrative operating signals are moving gradually; equity review remains open.</h1>
          <p>Door-to-provider median is <b>{fmt(m.doorToProviderMedianMin[selectedIndex])} min</b> ({signed(dtpChange)} min vs baseline). LWBS is <b>{fmt(m.lwbsRatePct[selectedIndex], 2)}%</b> ({signed(lwbsChange, 2)} pp). The uninsured walk-out gap is <b>{fmt(m.uninsuredWalkoutGapPp[selectedIndex])} pp</b> ({signed(gapChange)} pp).</p>
          {alerts.length > 0 ? <div className="inline-alert"><AlertIcon /><span><b>Demo review flag:</b> {alerts.join(' ')}</span></div> : <div className="inline-ok">No demo threshold flags for this selected period.</div>}
        </div>
        <aside className="actions-panel">
          <div className="section-kicker">RULE-BASED NEXT ACTIONS</div>
          <ol>{actions.map((action, index) => <li key={action}><span>{index + 1}</span>{action}</li>)}</ol>
          <p>Deterministic suggestions only · no action is executed</p>
        </aside>
      </section>

      <section className="kpi-grid" aria-label="Oversight KPI cards">
        <KpiCard label="DOOR-TO-PROVIDER MEDIAN" value={fmt(m.doorToProviderMedianMin[selectedIndex])} unit="min" change={`${signed(dtpChange)} min`} note={`Target ≤ ${t.doorToProviderMedianMin} min`} tone={m.doorToProviderMedianMin[selectedIndex] <= t.doorToProviderMedianMin ? 'good' : 'watch'} />
        <KpiCard label="LWBS RATE" value={fmt(m.lwbsRatePct[selectedIndex], 2)} unit="%" change={`${signed(lwbsChange, 2)} pp`} note={`Target ≤ ${t.lwbsRatePct}%`} tone={m.lwbsRatePct[selectedIndex] <= t.lwbsRatePct ? 'good' : 'watch'} />
        <KpiCard label="UNINSURED WALK-OUT GAP" value={fmt(m.uninsuredWalkoutGapPp[selectedIndex])} unit="pp" change={`${signed(gapChange)} pp`} note={`vs Commercial · Target ≤ ${t.uninsuredWalkoutGapPp} pp`} tone={m.uninsuredWalkoutGapPp[selectedIndex] <= t.uninsuredWalkoutGapPp ? 'good' : 'watch'} />
        <KpiCard label="MISSED HIGH-RISK CASES" value={fmt(m.missedHighRiskPct[selectedIndex], 2)} unit="%" change={`${signed(m.missedHighRiskPct[selectedIndex] - m.missedHighRiskPct[baseline], 2)} pp`} note={`Demo threshold ≤ ${t.missedHighRiskPct}%`} tone={m.missedHighRiskPct[selectedIndex] <= t.missedHighRiskPct ? 'good' : 'watch'} />
        <KpiCard label="NURSE OVERRIDE RATE" value={fmt(override)} unit="%" change={`${signed(override - m.nurseOverridePct[baseline])} pp`} note={`Expected demo range ${t.nurseOverridePctMin}–${t.nurseOverridePctMax}%`} tone={override >= t.nurseOverridePctMin && override <= t.nurseOverridePctMax ? 'neutral' : 'watch'} />
      </section>

      <section className="charts-grid">
        <article className="chart-card"><div className="card-head"><div><span className="eyebrow">ACCESS</span><h2>Door-to-provider median</h2><p>Illustrative monthly trend · DTP definition only</p></div><span className="unit-chip">minutes</span></div><LineChart labels={data.periods} selectedIndex={selectedIndex} series={[{ name: 'DTP median', values: m.doorToProviderMedianMin, color: '#6d4fc2' }]} unit=" min" target={t.doorToProviderMedianMin} targetLabel="Demo target" min={40} max={60} /></article>
        <article className="chart-card"><div className="card-head"><div><span className="eyebrow">RETENTION</span><h2>Left without being seen</h2><p>Illustrative monthly LWBS rate</p></div><span className="unit-chip">percent</span></div><LineChart labels={data.periods} selectedIndex={selectedIndex} series={[{ name: 'LWBS rate', values: m.lwbsRatePct, color: '#6d4fc2' }]} unit="%" target={t.lwbsRatePct} targetLabel="Demo target" min={3.2} max={4.2} /></article>
        <article className="chart-card"><div className="card-head"><div><span className="eyebrow">EQUITY</span><h2>LWBS rate by payer</h2><p>Selected period compared with illustrative baseline</p></div><span className="unit-chip">percent</span></div><HorizontalBarChart unit="%" data={[
          { label: 'Commercial', current: payer.commercial[selectedIndex], baseline: payer.commercial[0] },
          { label: 'Medicare', current: payer.medicare[selectedIndex], baseline: payer.medicare[0] },
          { label: 'Medicaid', current: payer.medicaid[selectedIndex], baseline: payer.medicaid[0] },
          { label: 'Uninsured', current: payer.uninsured[selectedIndex], baseline: payer.uninsured[0] },
        ]} /></article>
        <article className="chart-card"><div className="card-head"><div><span className="eyebrow">EQUITY</span><h2>Walk-out gaps vs Commercial</h2><p>Illustrative percentage-point difference</p></div><span className="unit-chip">percentage points</span></div><LineChart labels={data.periods} selectedIndex={selectedIndex} series={[
          { name: 'Uninsured gap', values: m.uninsuredWalkoutGapPp, color: '#6d4fc2' },
          { name: 'Medicaid gap', values: m.medicaidWalkoutGapPp, color: '#e1556c', dashed: true },
        ]} unit=" pp" target={t.uninsuredWalkoutGapPp} targetLabel="Uninsured demo target" min={1.2} max={3.1} /></article>
      </section>

      <ModelEvidence backend={backend} />

      <section className="safety-card"><div className="safety-icon"><AlertIcon /></div><div><span className="eyebrow">SAFETY REMINDER</span><h2>Committee review does not replace clinical judgment.</h2><p>This dashboard does not change nurse-confirmed ESI, route patients, pause a live workflow, or validate ESI 1/2 safety. Investigate source data and obtain clinical authorization before any operational action.</p></div><span className="status-badge danger">CLINICAL SAFETY · NOT VERIFIED</span></section>
    </>
  );
}

function MetricComparison({ label, from, to, unit, reduction }: { label: string; from: string; to: string; unit: string; reduction: string }) {
  return <article className="comparison-card"><span>{label}</span><div><b>{from}</b><i>→</i><b className="after">{to}</b><small>{unit}</small></div><p>{reduction}</p></article>;
}

function WhatIfProjection({ projection, source }: { projection: ProjectionData; source: 'backend' | 'bundled' }) {
  const p = projection;
  return (
    <>
      <section className="projection-banner"><AlertIcon /><div><span>HYPOTHETICAL WHAT-IF PROJECTION</span><h1>Not observed hospital outcomes</h1><p>Conditional math applied to existing synthetic history. It is not causal evidence, a validated capacity simulation, or proof of achievable improvement. Values are {source === 'backend' ? 'read from the original analysis CSV by the shared Python API' : 'shown from the integrity-matched bundled fallback because the API is unavailable'}.</p></div><span className="projection-tag">{source === 'backend' ? 'BACKEND-DERIVED' : 'BUNDLED FALLBACK'}</span></section>

      <section className="projection-intro">
        <div><span className="section-kicker">NEUTRAL ILLUSTRATIVE ASSUMPTION SET</span><h2>Smart Routing + LWBS Prevention</h2><p>{p.totalVisits.toLocaleString()} synthetic annual visits · {p.historicallyRoomedVisits.toLocaleString()} historically roomed · {p.historicalLwbsCount.toLocaleString()} historical LWBS records</p></div>
        <div className="definition-box"><b>Waiting Time (W)</b><span>{p.wDefinition}</span><small>Separate from door-to-provider (DTP). {p.wCohort}.</small></div>
      </section>

      <section className="comparison-grid">
        <MetricComparison label="MEAN W" from={p.baseline.meanWMin.toFixed(2)} to={p.combined.meanWMin.toFixed(2)} unit="min" reduction={`${p.reductions.meanWMin.toFixed(2)} min lower · ${p.reductions.meanWPct.toFixed(2)}%`} />
        <MetricComparison label="MEDIAN W" from={p.baseline.medianWMin.toFixed(2)} to={p.combined.medianWMin.toFixed(2)} unit="min" reduction={`${p.reductions.medianWMin.toFixed(2)} min lower · hypothetical`} />
        <MetricComparison label="P90 W" from={p.baseline.p90WMin.toFixed(2)} to={p.combined.p90WMin.toFixed(2)} unit="min" reduction={`${p.reductions.p90WMin.toFixed(2)} min lower · hypothetical`} />
        <MetricComparison label="LWBS RATE" from={`${p.baseline.lwbsRatePct.toFixed(2)}%`} to={`${p.combined.lwbsRatePct.toFixed(2)}%`} unit="" reduction={`${p.reductions.lwbsPp.toFixed(2)} percentage points lower`} />
      </section>

      <section className="projection-grid">
        <article className="assumption-card"><div className="card-head"><div><span className="eyebrow">CONDITIONAL INPUTS</span><h2>Neutral scenario assumptions</h2></div><span className="status-badge warn">HYPOTHETICAL</span></div><ul>
          <li><b>10%</b><span>avoidable W fraction applied mathematically to historically roomed ESI 3–5 cases</span></li>
          <li><b>20%</b><span>outreach retention fraction applied to historical LWBS cases</span></li>
          <li><b>0%</b><span>direct routing LWBS prevention in the primary neutral scenario</span></li>
        </ul><p>No new room-entry timestamp was created. ESI 1/2 were excluded from routing reductions.</p></article>
        <article className="arm-card"><div className="card-head"><div><span className="eyebrow">FOUR-ARM VIEW</span><h2>Conditional comparison</h2></div></div><div className="table-wrap"><table><thead><tr><th>Arm</th><th>Mean W</th><th>LWBS</th></tr></thead><tbody>{p.fourArms.map((row) => <tr key={row.arm} className={row.arm === 'Combined' ? 'highlight' : ''}><td>{row.arm}</td><td>{row.meanWMin.toFixed(2)} min</td><td>{row.lwbsRatePct.toFixed(2)}%</td></tr>)}</tbody></table></div></article>
      </section>

      <section className="limits-card"><div><span className="eyebrow">EVIDENCE AND SAFETY LIMITS</span><h2>These projections do not establish real intervention effects.</h2></div><div className="limit-grid"><span><small>REAL INTERVENTION EFFECT</small><b>{p.status.realInterventionEffect.replaceAll('_', ' ')}</b></span><span><small>CLINICAL SAFETY</small><b>{p.status.clinicalSafety.replaceAll('_', ' ')}</b></span><span><small>CAPACITY VALIDATION</small><b>NOT VALIDATED</b></span></div><p>A prospective, clinically governed validation with room suitability, time-varying capacity, and patient-level ESI 1/2 safety outcomes would be required before any operational recommendation.</p></section>
    </>
  );
}

export default function App() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const [tab, setTab] = useState<Tab>(() => query.get('view') === 'projection' ? 'projection' : 'monthly');
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const requested = query.get('period');
    const match = fixtureMonthly.periods.findIndex((period) => period.toLowerCase().replace(' ', '-') === requested);
    return match >= 0 ? match : fixtureMonthly.periods.length - 1;
  });
  const [monthly, setMonthly] = useState<MonthlyData>(() => cloneFixture());
  const [editing, setEditing] = useState(false);
  const [editedPeriods, setEditedPeriods] = useState<Set<number>>(() => new Set());
  const [backend, setBackend] = useState<BackendState>({ status: 'loading', data: null, message: 'Connecting to the shared Python API.' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/oversight/summary`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as OversightSummary;
        if (!data.syntheticOnly || data.containsPatientIdentifiers) throw new Error('Unexpected oversight data boundary');
        if (active) setBackend({ status: 'connected', data, message: 'Shared Python API connected.' });
      } catch (error) {
        if (active) setBackend({ status: 'unavailable', data: null, message: `Shared Python API unavailable (${error instanceof Error ? error.message : 'unknown error'}).` });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const projectionData = useMemo<ProjectionData>(() => {
    const api = backend.data?.neutralProjection;
    if (!api) return bundledProjection as ProjectionData;
    return {
      ...(bundledProjection as ProjectionData),
      wDefinition: api.wDefinition,
      baseline: api.baseline,
      combined: api.combined,
      reductions: api.reductions,
      status: api.status,
      fourArms: api.fourArms,
    };
  }, [backend.data]);
  const values = useMemo(() => ({
    doorToProviderMedianMin: monthly.metrics.doorToProviderMedianMin[selectedIndex],
    lwbsRatePct: monthly.metrics.lwbsRatePct[selectedIndex],
    uninsuredWalkoutGapPp: monthly.metrics.uninsuredWalkoutGapPp[selectedIndex],
    missedHighRiskPct: monthly.metrics.missedHighRiskPct[selectedIndex],
    nurseOverridePct: monthly.metrics.nurseOverridePct[selectedIndex],
  }), [monthly, selectedIndex]);

  const saveEdit = (next: Record<MetricKey, number>) => {
    setMonthly((current) => {
      const updated = JSON.parse(JSON.stringify(current)) as MonthlyData;
      (Object.keys(next) as MetricKey[]).forEach((key) => { updated.metrics[key][selectedIndex] = next[key]; });
      return updated;
    });
    setEditedPeriods((set) => new Set(set).add(selectedIndex));
    setEditing(false);
  };

  const reset = () => { setMonthly(cloneFixture()); setSelectedIndex(fixtureMonthly.periods.length - 1); setTab('monthly'); setEditedPeriods(new Set()); };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main"><BrandMark /><span>Seen<span>Sooner</span></span></a>
        <div className="product-title"><b>AI Oversight Committee Dashboard</b><span>Local committee demo</span></div>
        <div className="top-actions">
          <span className="demo-badge"><i />Synthetic demo · Not live hospital data</span>
          {tab === 'monthly' && <label className="period-select"><span>Selected period</span><div><select value={selectedIndex} onChange={(e) => setSelectedIndex(Number(e.target.value))} aria-label="Selected period">{monthly.periods.map((period, i) => <option key={period} value={i}>{period}</option>)}</select><ArrowDown /></div></label>}
        </div>
      </header>

      <nav className="tabbar" aria-label="Dashboard views">
        <div className="tabs"><button className={tab === 'monthly' ? 'active' : ''} onClick={() => setTab('monthly')}>Monthly Oversight</button><button className={tab === 'projection' ? 'active' : ''} onClick={() => setTab('projection')}>What-if Projection <span>Hypothetical</span></button></div>
        <div className="toolbar">{tab === 'monthly' && <button className="button secondary" onClick={() => setEditing(true)}>Edit selected period{editedPeriods.has(selectedIndex) && <i className="edited-dot" />}</button>}<button className="button ghost" onClick={reset}>Reset demo</button></div>
      </nav>

      <main id="main" className="dashboard-main">
        {tab === 'monthly' ? <MonthlyOversight data={monthly} selectedIndex={selectedIndex} backend={backend} /> : <WhatIfProjection projection={projectionData} source={backend.data?.neutralProjection ? 'backend' : 'bundled'} />}
      </main>

      <footer><span>SeenSooner oversight demonstration</span><span>Aggregate-only local API · No patient identifiers · No deployment</span></footer>
      <EditDialog open={editing} period={monthly.periods[selectedIndex]} values={values} onClose={() => setEditing(false)} onSave={saveEdit} />
    </div>
  );
}
