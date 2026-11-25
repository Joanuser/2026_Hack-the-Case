import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { fmt } from '../i18n';
import { api, isMockMode, type PatientStatusView } from '../api';
import { useLive } from '../api/useLive';
import { Pin } from '../ui/icons';
import { Banner, BackLink, EmergencyWarning, Field, Modal, PrimaryButton, Screen, TextInput } from '../components/ui';
import { distanceMeters, EXIT_RADIUS_M, hospitalPoint } from '../lib/geo';
import type { PatientSession } from '../lib/storage';
import { REASONS, REASON_VALUE } from './TellUs';

const EXIT_SNOOZE_MS = 10 * 60 * 1000;

function useExitDetection(session: PatientSession, active: boolean, onTrigger: () => void) {
  const snoozeUntil = useRef(0);
  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return;
    if (!session.locationAuthorization?.granted) return;
    const ref = hospitalPoint();
    if (!ref) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const d = distanceMeters(ref, { lat: p.coords.latitude, lng: p.coords.longitude });
        if (d > EXIT_RADIUS_M && Date.now() > snoozeUntil.current) onTrigger();
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, session.locationAuthorization, onTrigger]);
  return { snooze: () => { snoozeUntil.current = Date.now() + EXIT_SNOOZE_MS; } };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </div>
  );
}

function InsuranceReminder({ session, onSaved }: { session: PatientSession; onSaved: (s: PatientStatusView) => void }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!val.trim()) { setErr(t.errRequired); return; }
    setBusy(true);
    try { onSaved(await api.updateInsurance(session.id, session.token, val.trim())); setOpen(false); }
    catch { setErr(t.updateError); }
    setBusy(false);
  };
  return (
    <div className="ins-reminder">
      <p className="ins-title">{t.insuranceRequiredTitle}</p>
      <p className="ins-body">{t.insuranceRequiredBody}</p>
      {!open ? (
        <button type="button" className="link-btn left" onClick={() => setOpen(true)}>{t.addInsurance}</button>
      ) : (
        <form onSubmit={save} noValidate className="ins-form">
          <Field label={t.insurance} required error={err}>
            {(a) => <TextInput {...a} value={val} placeholder={t.insurancePh} onChange={(e) => { setVal(e.target.value); setErr(undefined); }} />}
          </Field>
          <div className="row-gap">
            <button type="submit" className="btn-small primary" disabled={busy}>{t.saveInsurance}</button>
            <button type="button" className="btn-small" onClick={() => setOpen(false)}>{t.cancel}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function Waiting({
  session,
  flash,
  clearFlash,
  onBack,
  onSymptomsChanged,
  onNewCheckIn,
  onStatus,
}: {
  session: PatientSession;
  flash: string | null;
  clearFlash: () => void;
  onBack: () => void;
  onSymptomsChanged: () => void;
  onNewCheckIn: () => void;
  onStatus: (s: PatientStatusView) => void;
}) {
  const { t } = useApp();
  const fetcher = useCallback(() => api.getCheckIn(session.id, session.token), [session.id, session.token]);
  const live = useLive(fetcher, 'patient', { checkinId: session.id, token: session.token });
  const [override, setOverride] = useState<PatientStatusView | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitErr, setExitErr] = useState<string | null>(null);

  const data = override && (!live.data || override.updatedAt >= live.data.updatedAt) ? override : live.data;
  useEffect(() => { if (live.data) setOverride(null); }, [live.data]);
  useEffect(() => { if (data) onStatus(data); }, [data, onStatus]);
  useEffect(() => { if (!flash) return; const id = setTimeout(clearFlash, 5000); return () => clearTimeout(id); }, [flash, clearFlash]);

  const activeStatus = !!data && !['left', 'completed', 'inactive'].includes(data.status);
  const [exitStep, setExitStep] = useState<'ask' | 'reason' | 'phone'>('ask');
  const [exitReason, setExitReason] = useState<(typeof REASONS)[number] | null>(null);
  const [exitDetails, setExitDetails] = useState('');
  const [otherPhone, setOtherPhone] = useState<string | null>(null);
  const triggerExit = useCallback(() => {
    setExitStep('ask');
    setExitOpen(true);
    // Tell staff a "Still here?" check is pending (no coordinates). No answer in 10 min flags the front desk.
    api.reportLocationPrompt(session.id, session.token).catch(() => undefined);
  }, [session.id, session.token]);
  const exit = useExitDetection(session, activeStatus && !exitOpen, triggerExit);

  const answerExit = async (left: boolean) => {
    setExitBusy(true);
    setExitErr(null);
    try {
      const extra = left ? { reason: exitReason ? REASON_VALUE[exitReason] : undefined, details: exitDetails.trim() || undefined, phone: otherPhone?.trim() || undefined } : undefined;
      const s = await api.reportLocationExit(session.id, session.token, left, 'phone', extra);
      setOverride(s);
      if (!left) exit.snooze();
      setExitOpen(false);
    } catch {
      setExitErr(t.updateError);
    }
    setExitBusy(false);
  };

  const fatal = live.error && !live.data && (live.error.status === 401 || live.error.status === 404);
  const number = data?.waitingNumber || session.waitingNumber;

  if (fatal) {
    return (
      <Screen label="waiting-error">
        <div className="card center-card">
          <h1 tabIndex={-1}>{t.loadError}</h1>
          <EmergencyWarning />
          <PrimaryButton onClick={onNewCheckIn}>{t.startNewCheckIn}</PrimaryButton>
        </div>
      </Screen>
    );
  }

  let body: React.ReactNode;
  const s = data?.status;
  if (!data) {
    body = (
      <>
        <div className="number-block" aria-busy="true">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value">{number}</p>
        </div>
        <div className="skeleton-lines center"><span /><span className="short" /></div>
        {live.error && <Banner kind="error" action={<button type="button" className="link-btn" onClick={() => live.refresh()}>{t.retry}</button>}>{t.loadError}</Banner>}
      </>
    );
  } else if (s === 'left' || s === 'completed' || s === 'inactive') {
    body = (
      <>
        <div className="number-block muted">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value">{number}</p>
        </div>
        <h1 className="wait-title" tabIndex={-1}>{s === 'inactive' ? 'Recall window ended' : s === 'left' ? t.leftTitle : t.visitComplete}</h1>
        <p className="wait-note">{s === 'inactive' ? 'Please speak with the front desk. Inactive is not the same as LWBS, and your history is retained.' : s === 'left' ? t.leftBody : t.visitCompleteBody}</p>
        <div className="actions"><button type="button" className="btn-outline" onClick={onNewCheckIn}>{t.startNewCheckIn}</button></div>
      </>
    );
  } else if (s === 'with_care_team') {
    body = (
      <>
        <p className="care-stage ok">{t.assessmentComplete}</p>
        <div className="number-block called">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value">{number}</p>
        </div>
        <h1 className="wait-title" tabIndex={-1}>{t.yourTurn}</h1>
        <p className="wait-note">{fmt(t.yourTurnBody, { n: number })}</p>
      </>
    );
  } else {
    const provider = s === 'waiting_provider';
    body = (
      <>
        {provider && <p className="care-stage ok" data-testid="care-stage">{t.assessmentComplete}</p>}
        {s === 'in_assessment' && <p className="care-stage">{t.inAssessmentStage}</p>}
        <div className="number-block">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value" data-testid="waiting-number">{number}</p>
        </div>
        <h1 className="wait-title" tabIndex={-1} data-testid="wait-title">
          {provider ? t.waitingProvider : s === 'in_assessment' ? t.inAssessment : t.waitingNurse}
        </h1>
        <div className="actions">
          <PrimaryButton arrow={false} onClick={onSymptomsChanged} className="symptoms-btn">{t.symptomsChanged}</PrimaryButton>
        </div>
        {provider && (
          <>
            <div className="metrics">
              <Metric label={t.peopleAhead} value={String(data.peopleAhead ?? '—')} />
              <Metric
                label="Estimated remaining W2"
                value={data.remainingW2Low != null && data.remainingW2High != null ? `${Math.round(data.remainingW2Low)}–${Math.round(data.remainingW2High)} min` : '—'}
              />
            </div>
            <p className="wait-note" data-testid="prediction-source">
              Updated {data.predictionGeneratedAt ? new Date(data.predictionGeneratedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
              {data.predictionSource === 'historical_completed_w2_fallback' ? ' · Historical estimate fallback' : ' · Remaining time, not total W2'}
            </p>
            <p className="wait-note">{fmt(t.providerWillCall, { n: number })}</p>
          </>
        )}
        {data.insuranceMissing && <InsuranceReminder session={session} onSaved={setOverride} />}
      </>
    );
  }

  return (
    <Screen label={`waiting-${s || 'loading'}`} className="waiting-main">
      <BackLink onClick={onBack} />
      <div className="card waiting-card">
        <EmergencyWarning />
        {flash && <Banner kind="ok">{flash}</Banner>}
        {live.connection === 'reconnecting' && live.data && <Banner kind="warn">{t.reconnecting}</Banner>}
        {live.connection === 'offline' && <Banner kind="warn">{t.offline}</Banner>}
        {body}
        {isMockMode && activeStatus && (
          <div className="demo-tools">
            <p>{t.demoTools}</p>
            <button type="button" className="link-btn" onClick={() => setExitOpen(true)}>{t.simulateLeaving}</button>
          </div>
        )}
      </div>

      {exitOpen && (
        <Modal labelledBy="exit-title" className="exit-modal">
          {exitStep === 'ask' && (
            <>
              <div className="loc-icon round"><Pin size={22} /></div>
              <p className="eyebrow accent">{t.locationCheck}</p>
              <h2 id="exit-title">{t.leavingTitle}</h2>
              <p className="loc-body">{fmt(t.leavingBody, { m: EXIT_RADIUS_M })}</p>
              <p className="loc-note">{t.leavingNote}</p>
              {exitErr && <Banner kind="error">{exitErr}</Banner>}
              <button type="button" className="btn-primary wide" onClick={() => answerExit(false)} disabled={exitBusy} data-testid="still-here">{t.stillHere}</button>
              <button type="button" className="btn-danger-outline wide" onClick={() => setExitStep('reason')} disabled={exitBusy} data-testid="i-left">{t.yesLeft}</button>
            </>
          )}
          {exitStep === 'reason' && (
            <>
              <h2 id="exit-title">{t.exitReasonTitle}</h2>
              <div className="exit-reasons" role="radiogroup" aria-labelledby="exit-title">
                {REASONS.map((r) => (
                  <label key={r} className={`acc-row ${exitReason === r ? 'on' : ''}`}>
                    <input type="radio" name="exit-reason" checked={exitReason === r} onChange={() => setExitReason(r)} data-testid={`exit-${r}`} />
                    <span>{t[r]}</span>
                  </label>
                ))}
              </div>
              {exitReason === 'reasonOther' && (
                <TextInput value={exitDetails} onChange={(e) => setExitDetails(e.target.value)} placeholder={t.reasonOtherPh} aria-label={t.reasonOtherPh} />
              )}
              <PrimaryButton wide onClick={() => setExitStep('phone')} disabled={!exitReason}>{t.continue}</PrimaryButton>
            </>
          )}
          {exitStep === 'phone' && (
            <>
              <h2 id="exit-title">{t.exitPhoneTitle}</h2>
              <p className="loc-body">{t.exitPhoneBody}</p>
              {data?.phoneOnFile && otherPhone === null && (
                <p className="exit-phone" data-testid="phone-on-file">{fmt(t.exitCallMe, { p: data.phoneOnFile })}</p>
              )}
              {(otherPhone !== null || !data?.phoneOnFile) && (
                <TextInput value={otherPhone ?? ''} onChange={(e) => setOtherPhone(e.target.value)} inputMode="tel" placeholder={t.mobilePh} aria-label={t.mobilePh} />
              )}
              {data?.phoneOnFile && otherPhone === null && (
                <button type="button" className="link-btn" onClick={() => setOtherPhone('')}>{t.exitOtherNumber}</button>
              )}
              {exitErr && <Banner kind="error">{exitErr}</Banner>}
              <PrimaryButton wide onClick={() => answerExit(true)} disabled={exitBusy} data-testid="exit-send">{t.exitSend}</PrimaryButton>
            </>
          )}
        </Modal>
      )}
    </Screen>
  );
}
