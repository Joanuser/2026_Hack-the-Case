import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { fmt } from '../i18n';
import { api, type KioskLookup, type KioskRequest } from '../api';
import { Check } from '../ui/icons';
import { Banner, BackLink, Field, PrimaryButton, Screen, TextInput } from '../components/ui';
import { dobToIso } from '../lib/validation';
import { DobSelect } from '../components/DobSelect';

type Step = 'identify' | 'choose' | 'reason' | 'phone' | 'need' | 'done';
export const REASONS = ['reasonWait', 'reasonBetter', 'reasonPersonal', 'reasonFamily', 'reasonOther', 'reasonNoSay'] as const;
export const REASON_VALUE: Record<(typeof REASONS)[number], string> = {
  reasonWait: 'Wait too long', reasonBetter: 'Feeling better', reasonPersonal: 'Personal stuff',
  reasonFamily: 'Family / work', reasonOther: 'Other', reasonNoSay: 'Prefer not to say',
};

/** Tablet only: an already checked-in patient (no phone needed) tells the team they are leaving or asks for help. */
export function TellUs({ onExit }: { onExit: () => void }) {
  const { t } = useApp();
  const [step, setStep] = useState<Step>('identify');
  const [num, setNum] = useState('');
  const [dob, setDob] = useState('');
  const [found, setFound] = useState<KioskLookup | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [details, setDetails] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneText, setDoneText] = useState('');

  useEffect(() => { if (step !== 'done') return; const id = setTimeout(onExit, 15_000); return () => clearTimeout(id); }, [step, onExit]);

  const identify = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const iso = dobToIso(dob);
    if (!num.trim() || !iso) { setErr(t.tellNotFound); return; }
    setBusy(true);
    try { setFound(await api.kioskLookup(num.trim(), iso)); setStep('choose'); } catch { setErr(t.tellNotFound); }
    setBusy(false);
  };
  const send = async (req: Omit<KioskRequest, 'waitingNumber' | 'dateOfBirth'>) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.kioskRequest({ ...req, waitingNumber: num.trim(), dateOfBirth: dobToIso(dob)! });
      setDoneText(req.action === 'leaving'
        ? (req.phoneStatus === 'no_phone' ? t.doneNoPhone : r.case === 'see_desk' ? t.doneSeeDesk : t.doneCall)
        : (r.case === 'nurse' ? t.doneNurse : t.doneDesk));
      setStep('done');
    } catch { setErr(t.slipSendError); }
    setBusy(false);
  };
  const back = () => {
    setErr(null);
    if (step === 'identify' || step === 'done') onExit();
    else if (step === 'choose') setStep('identify');
    else if (step === 'reason' || step === 'need') setStep('choose');
    else if (step === 'phone') setStep('reason');
  };

  let body: React.ReactNode = null;
  if (step === 'identify') body = (
    <form className="card form-card tell-card" onSubmit={identify} noValidate>
      <h1 tabIndex={-1}>{t.tellTitle}</h1>
      <p className="sub">{t.tellSub}</p>
      <Field id="k-num" label={t.tellNumber}>{(a) => <TextInput {...a} value={num} autoCapitalize="characters" autoComplete="off" placeholder={t.tellNumberPh} onChange={(e) => setNum(e.target.value)} />}</Field>
      <Field id="k-dob" label={t.dob}>{(a) => <DobSelect id={a.id} value={dob} onChange={setDob} />}</Field>
      {err && <Banner kind="error">{err}</Banner>}
      <PrimaryButton type="submit" busy={busy}>{t.tellFind}</PrimaryButton>
    </form>
  );
  else if (step === 'choose') body = (
    <div className="card tell-card">
      <div className="number-block"><p className="number-label">{t.yourWaitingNumber}</p><p className="number-value" data-testid="tell-number">{found?.waitingNumber}</p></div>
      <h1 tabIndex={-1}>{t.tellChoose}</h1>
      <button type="button" className="tell-option" onClick={() => setStep('reason')}><b>{t.tellLeaving}</b><span>{t.tellLeavingSub}</span></button>
      <button type="button" className="tell-option" onClick={() => setStep('need')}><b>{t.tellCheck}</b><span>{t.tellCheckSub}</span></button>
    </div>
  );
  else if (step === 'reason') body = (
    <div className="card tell-card">
      <h1 tabIndex={-1}>{t.reasonTitle}</h1>
      <p className="sub">{t.reasonSub}</p>
      <div className="tell-grid">
        {REASONS.map((k) => <button key={k} type="button" className={`tell-chip ${reason === k ? 'on' : ''}`} aria-pressed={reason === k} onClick={() => setReason(k)}>{t[k]}</button>)}
      </div>
      {reason === 'reasonOther' && <TextInput value={details} placeholder={t.reasonOtherPh} onChange={(e) => setDetails(e.target.value)} aria-label={t.reasonOtherPh} />}
      <PrimaryButton disabled={!reason} onClick={() => setStep('phone')}>{t.continue}</PrimaryButton>
    </div>
  );
  else if (step === 'phone') body = (
    <div className="card tell-card">
      <h1 tabIndex={-1}>{t.phoneTitle}</h1>
      {found?.phoneOnFile && <p className="sub">{fmt(t.phoneOnFile, { p: found.phoneOnFile })}</p>}
      <TextInput value={phone} type="tel" inputMode="tel" placeholder={found?.phoneOnFile ? t.phoneNew : t.mobilePh} onChange={(e) => setPhone(e.target.value)} aria-label={t.phoneNew} dir="ltr" />
      {err && <Banner kind="error">{err}</Banner>}
      <PrimaryButton busy={busy} disabled={!found?.phoneOnFile && !phone.trim()} onClick={() => send({ action: 'leaving', reason: REASON_VALUE[reason!], details, phoneStatus: 'has_phone', phone })}>{t.phoneHave}</PrimaryButton>
      <button type="button" className="btn-outline wide" disabled={busy} onClick={() => send({ action: 'leaving', reason: REASON_VALUE[reason!], details, phoneStatus: 'no_phone' })}>{t.phoneNone}</button>
    </div>
  );
  else if (step === 'need') body = (
    <div className="card tell-card">
      <h1 tabIndex={-1}>{t.needTitle}</h1>
      {([['symptoms_worse', t.needWorse], ['question', t.needQuestion], ['need_help', t.needHelp]] as const).map(([k, label]) => (
        <button key={k} type="button" className={`tell-option ${k === 'symptoms_worse' ? 'urgent' : ''}`} disabled={busy} onClick={() => send({ action: 'check_on_me', need: k })}><b>{label}</b></button>
      ))}
      {err && <Banner kind="error">{err}</Banner>}
    </div>
  );
  else body = (
    <div className="card center-card tell-card">
      <div className="loc-icon round"><Check size={24} /></div>
      <h1 tabIndex={-1}>{found?.waitingNumber}</h1>
      <p className="wait-note">{doneText}</p>
      <PrimaryButton wide onClick={onExit}>{t.slipDone}</PrimaryButton>
    </div>
  );
  return (
    <Screen label={`tell-${step}`} className="tell-main">
      {step !== 'done' && <BackLink onClick={back} />}
      {body}
    </Screen>
  );
}
