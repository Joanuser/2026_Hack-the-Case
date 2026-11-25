import { fmt } from '../i18n';
import { EXIT_RADIUS_M } from '../lib/geo';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { BackLink, EmergencyWarning, Field, Modal, PrimaryButton, Progress, Screen, TextInput } from '../components/ui';
import { Pin } from '../ui/icons';
import { validateInfo, type InfoForm } from '../lib/validation';
import { DobSelect } from '../components/DobSelect';

export const ACCESS_KEYS = ['acc_wheelchair', 'acc_vision', 'acc_hearing', 'acc_forms', 'acc_other'] as const;

/** Multi-select dropdown (more than one need is common, e.g. blind and using a wheelchair). "None" clears the rest. */
function AccessibilitySelect({ value, onChange, id }: { value: string[]; onChange: (v: string[]) => void; id: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const none = value.includes('acc_none');
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const labels = value.map((k) => (t as unknown as Record<string, string>)[k]).filter(Boolean);
  const summary = labels.length ? labels.join(', ') : t.accessibilityPh;
  return (
    <div className={`ms ${open ? 'open' : ''}`} ref={boxRef}>
      <button type="button" id={id} className={`ms-btn ${labels.length ? '' : 'empty'}`} aria-haspopup="true" aria-expanded={open} aria-controls={`${id}-panel`} aria-labelledby={`${id}-lbl ${id}`} onClick={() => setOpen((o) => !o)} data-testid="acc-select">
        <span className="ms-val">{summary}</span>
        {labels.length > 1 && <span className="ms-count">{labels.length}</span>}
        <svg className="ms-chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="ms-panel" id={`${id}-panel`} role="group" aria-labelledby={`${id}-lbl`}>
          <label className={`ms-opt ${none ? 'on' : ''}`}>
            <input type="checkbox" checked={none} onChange={() => { onChange(none ? [] : ['acc_none']); if (!none) setOpen(false); }} data-testid="acc-none" />
            <span>{t.acc_none}</span>
          </label>
          {ACCESS_KEYS.map((k) => {
            const on = value.includes(k);
            return (
              <label key={k} className={`ms-opt ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== k) : [...value.filter((x) => x !== 'acc_none'), k])} data-testid={k} />
                <span>{t[k]}</span>
              </label>
            );
          })}
          <button type="button" className="ms-done" onClick={() => setOpen(false)} data-testid="acc-done">{t.accDone}</button>
        </div>
      )}
    </div>
  );
}

export function Info({ value, onChange, onBack, onNext, location }: { value: InfoForm; onChange: (v: InfoForm) => void; onBack: () => void; onNext: () => void; location?: { on: boolean; denied: boolean; onToggle: (on: boolean) => void } }) {
  const { t } = useApp();
  const [submitted, setSubmitted] = useState(false);
  const [askLoc, setAskLoc] = useState(false);
  const errors = submitted ? validateInfo(value, t) : {};
  const set = <K extends keyof InfoForm>(k: K, v: InfoForm[K]) => onChange({ ...value, [k]: v });

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validateInfo(value, t);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    onNext();
  };

  return (
    <Screen label="info">
      <BackLink onClick={onBack} />
      <form className="card form-card" onSubmit={next} noValidate>
        <Progress step={2} />
        <h1 tabIndex={-1}>{t.infoTitle}</h1>
        <EmergencyWarning />
        <p className="req-note">{t.requiredField}</p>
        {submitted && Object.keys(errors).length > 0 && <p className="form-error" role="alert">{t.fixErrors}</p>}
        <div className="fields">
          <Field id="f-legalName" label={t.legalName} required error={errors.legalName}>
            {(a) => <TextInput {...a} value={value.legalName} autoComplete="name" placeholder={t.legalNamePh} onChange={(e) => set('legalName', e.target.value)} />}
          </Field>
          <Field id="f-dob" label={t.dob} required error={errors.dob}>
            {(a) => <DobSelect id={a.id} invalid={a['aria-invalid']} describedBy={a['aria-describedby']} value={value.dob} onChange={(v) => set('dob', v)} />}
          </Field>
          <Field id="f-phone" label={t.mobile} error={errors.phone}>
            {(a) => <TextInput {...a} value={value.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder={t.mobilePh} onChange={(e) => set('phone', e.target.value)} dir="ltr" />}
          </Field>
          <Field id="f-insurance" label={t.insurance} required={!value.insuranceDeferred} error={errors.insurance}>
            {(a) => (
              <TextInput {...a} value={value.insurance} disabled={value.insuranceDeferred} placeholder={t.insurancePh} onChange={(e) => set('insurance', e.target.value)} />
            )}
          </Field>
          <label className="check-inline">
            <input type="checkbox" checked={value.insuranceDeferred} onChange={(e) => onChange({ ...value, insuranceDeferred: e.target.checked, insurance: e.target.checked ? '' : value.insurance })} />
            <span>{t.insuranceLater}</span>
          </label>
          <div className="field acc-field">
            <label id="f-access-lbl" htmlFor="f-access">{t.accessibility}</label>
            <p className="hint">{t.accessibilityHint}</p>
            <AccessibilitySelect id="f-access" value={value.accessibility} onChange={(v) => set('accessibility', v)} />
          </div>
          {location && (
            <div className="loc-optin">
              <p className="loc-title">{t.locationOptTitle}</p>
              <label className={`acc-row ${location.on ? 'on' : ''}`}>
                <input type="checkbox" checked={location.on} onChange={(e) => (e.target.checked ? setAskLoc(true) : location.onToggle(false))} data-testid="share-location" />
                <span>{t.shareLocation}</span>
              </label>
              <p className="hint">{fmt(t.shareLocationHint, { m: EXIT_RADIUS_M })}</p>
              {location.denied && <p className="hint warn" role="alert">{t.shareLocationDenied}</p>}
            </div>
          )}
        </div>
        <div className="actions">
          <PrimaryButton type="submit">{t.continue}</PrimaryButton>
        </div>
      </form>
      {location && askLoc && (
        <Modal labelledBy="loc-title" className="loc-dialog" onClose={() => setAskLoc(false)}>
          <div className="loc-icon"><Pin size={26} /></div>
          <h2 id="loc-title">{t.locationTitle}</h2>
          <p className="loc-body">{fmt(t.locationConfirmBody, { m: EXIT_RADIUS_M })}</p>
          <PrimaryButton wide onClick={() => { setAskLoc(false); location.onToggle(true); }}>{t.allowLocation}</PrimaryButton>
          <button type="button" className="btn-outline wide" onClick={() => setAskLoc(false)} data-testid="loc-not-now">
            {t.notNow}
          </button>
        </Modal>
      )}
    </Screen>
  );
}
