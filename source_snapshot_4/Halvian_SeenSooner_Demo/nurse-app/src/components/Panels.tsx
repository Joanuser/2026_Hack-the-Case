import { useEffect, useState } from 'react';
import { api, type StaffPatient } from '../api';
import { Close, Sparkle, Warning } from '../ui/icons';
import { ACCESS_LABEL, PRIORITY, SOURCE_LABEL, STATUS_LABEL, age, ago, languageName, waitMinutes } from '../lib/model';

export type RunAction = (label: string, fn: () => Promise<unknown>) => Promise<boolean>;

const SHORT_SOURCE: Record<StaffPatient['source'], string> = { mobile: 'Mobile check-in', ipad: 'iPad check-in', front_desk: 'Front desk', staff_assisted: 'Staff-assisted', walk_in: 'Walk-in' };

const CHECKLIST = [
  'Confirm the patient is still present.',
  'Explain their current stage in the queue.',
  'Ask whether symptoms have changed.',
  'Help with required information if needed.',
];

const ROOM_OPTIONS = [
  ['REGULAR_ED', 'Regular ED'],
  ['FAST_TRACK', 'Fast Track'],
  ['RESUSCITATION_TRAUMA', 'Resuscitation & Trauma'],
  ['BEHAVIORAL_HEALTH', 'Behavioral Health'],
] as const;

function PanelShell({ title, badge, onClose, children, testId }: { title: string; badge?: React.ReactNode; onClose: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <aside className="panel" aria-label={title} data-testid={testId}>
      <div className="panel-head">
        <p className="panel-eyebrow">{title}</p>
        {badge}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close patient details"><Close size={16} /></button>
      </div>
      {children}
    </aside>
  );
}

function Identity({ p, now }: { p: StaffPatient; now: number }) {
  const a = age(p.dateOfBirth, now);
  return (
    <div className="identity">
      <div className="identity-top">
        <p className="identity-num">{p.waitingNumber}</p>
        <span className="tag">{SHORT_SOURCE[p.source]}</span>
      </div>
      <p className="identity-name">{p.legalName}</p>
      <p className="identity-meta">
        {[p.location ? `${p.location.zone} · ${p.location.seat}` : null, languageName(p.language), a !== null ? `Age ${a}` : null].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

function SymptomChangeForm({ onSubmit, onCancel, busy }: { onSubmit: (note: string) => void; onCancel: () => void; busy: boolean }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState(false);
  return (
    <form className="change-form" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) { setErr(true); return; } onSubmit(note.trim()); }} noValidate>
      <label htmlFor="change-note">What changed?</label>
      <textarea id="change-note" rows={3} value={note} onChange={(e) => { setNote(e.target.value); setErr(false); }} aria-invalid={err} placeholder="e.g. Pain now 8/10, new shortness of breath" />
      {err && <p className="err" role="alert">Describe what changed.</p>}
      <div className="row">
        <button type="submit" className="btn-sm danger" disabled={busy}>Record change</button>
        <button type="button" className="btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Figma: "Selected follow-up patient" panel. */
export function FollowUpPanel({ p, now, run, onClose }: { p: StaffPatient; now: number; run: RunAction; onClose: () => void }) {
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChecks(CHECKLIST.map(() => false)); setChanging(false); }, [p.id]);
  const w = waitMinutes(p, now);
  const act = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); const ok = await run(label, fn); setBusy(false); return ok; };
  return (
    <PanelShell title="NEXT IN-PERSON CHECK-IN" badge={<span className="badge-warn">{w} MIN</span>} onClose={onClose} testId="followup-panel">
      <Identity p={p} now={now} />
      {p.symptomsChanged && (
        <div className="alert-red"><Warning size={16} /> Symptom change reported — review in the assessment queue.</div>
      )}
      <p className="panel-eyebrow">QUICK CHECK-IN</p>
      <ol className="checklist">
        {CHECKLIST.map((c, i) => (
          <li key={c}>
            <label>
              <input type="checkbox" checked={checks[i]} onChange={() => setChecks(checks.map((v, j) => (j === i ? !v : v)))} />
              <span className="num">{i + 1}</span>
              <span>{c}</span>
            </label>
          </li>
        ))}
      </ol>
      <div className="grow" />
      {changing ? (
        <SymptomChangeForm busy={busy} onCancel={() => setChanging(false)} onSubmit={async (note) => { if (await act(`Recorded symptom change for ${p.waitingNumber}`, () => api.recordContact(p.id, { kind: 'symptoms_changed', note }))) setChanging(false); }} />
      ) : (
        <>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            data-testid="checkin-complete"
            onClick={() => act(`${p.waitingNumber} checked in`, () => api.recordContact(p.id, { kind: 'check_in', checklist: CHECKLIST.filter((_, i) => checks[i]) }))}
          >
            Check in complete
          </button>
          <button type="button" className="btn-danger-outline" disabled={busy} onClick={() => setChanging(true)}>Symptoms changed</button>
          <button type="button" className="link center" disabled={busy} onClick={() => act(`${p.waitingNumber} marked not present`, () => api.recordContact(p.id, { kind: 'check_in', note: 'Patient not present', notPresent: true }))}>
            Patient not present
          </button>
        </>
      )}
    </PanelShell>
  );
}

/** Patient detail for the assessment queue, in-assessment and completed areas. */
export function PatientPanel({ p, now, run, onClose }: { p: StaffPatient; now: number; run: RunAction; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [priority, setPriority] = useState<string>(p.nursePriority ? String(p.nursePriority) : '');
  const [roomType, setRoomType] = useState(p.requiredRoomType ?? '');
  const [zone, setZone] = useState(p.location?.zone ?? '');
  const [seat, setSeat] = useState(p.location?.seat ?? '');
  const [prioErr, setPrioErr] = useState(false);
  const [roomErr, setRoomErr] = useState(false);
  useEffect(() => { setPriority(p.nursePriority ? String(p.nursePriority) : ''); setRoomType(p.requiredRoomType ?? ''); setZone(p.location?.zone ?? ''); setSeat(p.location?.seat ?? ''); setPrioErr(false); setRoomErr(false); }, [p.id, p.nursePriority, p.requiredRoomType, p.location?.zone, p.location?.seat]);
  const act = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); const ok = await run(label, fn); setBusy(false); return ok; };
  const w = waitMinutes(p, now);
  const s = p.symptoms;

  const savePriority = (v: string) => {
    setPriority(v);
    setPrioErr(false);
    void act(`Priority saved for ${p.waitingNumber}`, () => api.updatePatient(p.id, { nursePriority: v ? Number(v) : null }));
  };
  const completeAssessment = () => {
    if (!priority) { setPrioErr(true); document.getElementById('prio')?.focus(); return; }
    if (!roomType) { setRoomErr(true); document.getElementById('room-type')?.focus(); return; }
    void act(`${p.waitingNumber} assessment complete`, () => api.updatePatient(p.id, { status: 'waiting_provider', nursePriority: Number(priority), requiredRoomType: roomType as NonNullable<StaffPatient['requiredRoomType']> }));
  };

  return (
    <PanelShell title={STATUS_LABEL[p.status].toUpperCase()} badge={<span className="badge-neutral">{w} MIN</span>} onClose={onClose} testId="patient-panel">
      <div className="panel-scroll">
        <Identity p={p} now={now} />
        {p.symptomsChanged && (
          <div className="alert-red" role="status">
            <Warning size={16} />
            <span>Symptoms changed {p.symptomUpdates.length ? ago(p.symptomUpdates[p.symptomUpdates.length - 1].at, now) : ''}</span>
            <button type="button" className="link" disabled={busy} onClick={() => act('Symptom change acknowledged', () => api.updatePatient(p.id, { acknowledgeSymptomChange: true }))}>Acknowledge</button>
          </div>
        )}
        {p.careDue && (
          <div className="alert-red" role="alert"><Warning size={16} /> Actual W2 is 60+ minutes — nurse care check is due now.</div>
        )}
        {p.reassessmentRequired && (
          <div className="alert-red" role="status"><Warning size={16} /> Returned after recall. Nurse reassessment and confirmation are required before re-entry.</div>
        )}

        <section className="sec">
          <p className="panel-eyebrow">PATIENT-REPORTED SYMPTOMS</p>
          <dl className="kv">
            <dt>Main concern</dt><dd>{s.mainConcern}</dd>
            <dt>Started</dt><dd>{s.onset || '—'}</dd>
            {s.otherSymptoms && (<><dt>Other</dt><dd>{s.otherSymptoms}</dd></>)}
            <dt>Pain</dt><dd>{s.painLevel != null ? `${s.painLevel}/10` : 'Not recorded'}</dd>
          </dl>
          {p.summary && (
            <div className="ai-box">
              <p className="ai-head"><Sparkle size={14} /> AI-organized summary <span className="chip">{p.summary.editedByPatient ? 'Draft · corrected by patient' : 'Draft · reviewed by patient'}</span></p>
              <p className="ai-text">{p.summary.text}</p>
              <p className="ai-note">Organizes the patient’s words only. Not a triage assessment.</p>
            </div>
          )}
          {p.symptomUpdates.length > 0 && (
            <div className="updates">
              <p className="panel-eyebrow">SYMPTOM UPDATES</p>
              {[...p.symptomUpdates].reverse().map((u, i) => (
                <div key={i} className="update">
                  <p className="u-meta">{u.by === 'patient' ? 'Patient (phone)' : 'Staff'} · {ago(u.at, now)}</p>
                  {u.note && <p className="u-note">“{u.note}”</p>}
                  {u.by === 'patient' && u.previous && u.previous.painLevel !== u.symptoms.painLevel && <p className="u-note">Pain {u.previous.painLevel ?? '—'} → {u.symptoms.painLevel ?? '—'}/10</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="sec">
          <p className="panel-eyebrow">NURSE TRIAGE</p>
          <label className="lbl" htmlFor="prio">Priority (nurse decision)</label>
          <select id="prio" className={`inp ${prioErr ? 'invalid' : ''}`} value={priority} onChange={(e) => savePriority(e.target.value)} disabled={busy || ['completed', 'left'].includes(p.status)} data-testid="priority-select">
            <option value="">Not set</option>
            {PRIORITY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {prioErr && <p className="err" role="alert">Set a priority before completing the assessment.</p>}
          <label className="lbl" htmlFor="room-type">Required room (nurse decision)</label>
          <select id="room-type" className={`inp ${roomErr ? 'invalid' : ''}`} value={roomType} onChange={(e) => { setRoomType(e.target.value); setRoomErr(false); }} disabled={busy || ['completed', 'left', 'inactive'].includes(p.status)} data-testid="room-type-select">
            <option value="">Not set</option>
            {ROOM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {roomErr && <p className="err" role="alert">Confirm the clinically required room before completing assessment.</p>}
          {p.triageCompletedAt && (
            <div className="ai-box">
              <p className="ai-head">Remaining W2 estimate</p>
              <p className="ai-text">{p.remainingW2Low != null && p.remainingW2High != null ? `${Math.round(p.remainingW2Low)}–${Math.round(p.remainingW2High)} min remaining` : p.roomEnteredAt ? 'W2 ended at Room Entered' : 'Unavailable'}</p>
              <p className="ai-note">Actual W2: {Math.round(p.w2ElapsedMinutes)} min from Triage Completed. Source: {p.predictionSource === 'historical_completed_w2_fallback' ? 'historical fallback' : p.predictionSource || 'none'}.</p>
            </div>
          )}
          <div className="loc-row">
            <label className="lbl">Zone<input className="inp" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Zone A" /></label>
            <label className="lbl">Seat<input className="inp" value={seat} onChange={(e) => setSeat(e.target.value)} placeholder="Seat 04" /></label>
            <button type="button" className="btn-sm" disabled={busy || (zone === (p.location?.zone ?? '') && seat === (p.location?.seat ?? ''))} onClick={() => act('Location saved', () => api.updatePatient(p.id, { location: zone || seat ? { zone, seat } : null }))}>Save</button>
          </div>
        </section>

        <section className="sec">
          <p className="panel-eyebrow">DETAILS</p>
          <dl className="kv">
            <dt>Date of birth</dt><dd>{p.dateOfBirth}</dd>
            {p.phone && (<><dt>Mobile</dt><dd>{p.phone}</dd></>)}
            <dt>Insurance</dt><dd>{p.insurance || (p.insuranceDeferred ? <span className="warn-text">Patient will add later</span> : <span className="warn-text">Missing</span>)}</dd>
            {p.accessibilityNeeds.length > 0 && (<><dt>Accessibility</dt><dd>{p.accessibilityNeeds.map((a) => ACCESS_LABEL[a] || a).join(', ')}</dd></>)}
            <dt>Checked in</dt><dd>{new Date(p.checkedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {SOURCE_LABEL[p.source]}</dd>
          </dl>
        </section>
      </div>

      <div className="panel-actions">
        {p.careDue && (
          <button type="button" className="btn-danger-outline" disabled={busy} data-testid="care-check" onClick={() => act(`${p.waitingNumber} 60-minute care check completed`, () => api.recordContact(p.id, { kind: 'check_in', note: '60-minute W2 nurse care check completed' }))}>Complete 60-minute care check</button>
        )}
        {p.status === 'waiting_nurse' && (
          <>
            <button type="button" className="btn-primary" disabled={busy} data-testid="start-assessment" onClick={() => act(`${p.waitingNumber} moved to assessment`, () => api.updatePatient(p.id, { status: 'in_assessment' }))}>Start assessment</button>
            <button type="button" className="link center" disabled={busy} onClick={() => act(`${p.waitingNumber} departure recorded for review`, () => api.updatePatient(p.id, { status: 'left' }))}>Record departure — LWBS review required</button>
          </>
        )}
        {p.status === 'in_assessment' && (
          <>
            <button type="button" className="btn-primary" disabled={busy} data-testid="complete-assessment" onClick={completeAssessment}>Complete assessment</button>
            <button type="button" className="btn-outline" disabled={busy} onClick={() => act(`${p.waitingNumber} returned to queue`, () => api.updatePatient(p.id, { status: 'waiting_nurse' }))}>Return to waiting</button>
          </>
        )}
        {p.status === 'waiting_provider' && (
          <>
            {p.callStatus === 'waiting' && <button type="button" className="btn-primary" disabled={busy} data-testid="call-to-care" onClick={() => act(`${p.waitingNumber} formally called`, () => api.updatePatient(p.id, { roomEvent: 'called' }))}>Call to treatment room</button>}
            {p.callStatus === 'called' && <button type="button" className="btn-primary" disabled={busy} data-testid="room-entered" onClick={() => act(`${p.waitingNumber} entered treatment room`, () => api.updatePatient(p.id, { roomEvent: 'entered' }))}>Room entered — end W2</button>}
            {p.callStatus === 'called' && <button type="button" className="btn-danger-outline" disabled={busy} data-testid="no-response" onClick={() => act(`${p.waitingNumber} recall started`, () => api.updatePatient(p.id, { roomEvent: 'no_response' }))}>No response — start 30-minute recall</button>}
            {p.callStatus === 'recall_active' && <button type="button" className="btn-primary" disabled={busy} data-testid="patient-returned" onClick={() => act(`${p.waitingNumber} returned for reassessment`, () => api.updatePatient(p.id, { roomEvent: 'returned' }))}>Patient returned — require reassessment</button>}
            <button type="button" className="link center" disabled={busy} onClick={() => act(`${p.waitingNumber} departure recorded for review`, () => api.updatePatient(p.id, { status: 'left' }))}>Record departure — LWBS review required</button>
          </>
        )}
        {p.status === 'with_care_team' && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => act(`${p.waitingNumber} visit complete`, () => api.updatePatient(p.id, { status: 'completed' }))}>Complete visit</button>
        )}
        {['left', 'inactive'].includes(p.status) && (
          <button type="button" className="btn-outline" disabled={busy} onClick={() => act(`${p.waitingNumber} returned for nurse reassessment`, () => api.updatePatient(p.id, { status: 'waiting_nurse' }))}>Patient returned — reassess before queue</button>
        )}
      </div>
    </PanelShell>
  );
}
