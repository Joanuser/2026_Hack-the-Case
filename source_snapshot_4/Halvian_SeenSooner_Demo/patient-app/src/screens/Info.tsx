import { fmt } from '../i18n';
import { EXIT_RADIUS_M } from '../lib/geo';
import { useState } from 'react';
import { useApp } from '../context';
import { BackLink, EmergencyWarning, Field, PrimaryButton, Progress, Screen, TextInput } from '../components/ui';
import { validateInfo, type InfoForm } from '../lib/validation';
import { DobSelect } from '../components/DobSelect';

export const ACCESS_KEYS = ['acc_wheelchair', 'acc_vision', 'acc_hearing', 'acc_forms', 'acc_other'] as const;

/** Visible checklist (more than one need is common, e.g. blind and using a wheelchair). "None" clears the rest. */
function AccessibilityChecklist({ value, onChange, id }: { value: string[]; onChange: (v: string[]) => void; id: string }) {
  const { t } = useApp();
  const none = value.includes('acc_none');
  return (
    <div className="acc-list" role="group" aria-labelledby={`${id}-lbl`} id={id} tabIndex={-1}>
      <label className={`acc-row ${none ? 'on' : ''}`}>
        <input type="checkbox" checked={none} onChange={() => onChange(none ? [] : ['acc_none'])} data-testid="acc-none" />
        <span>{t.acc_none}</span>
      </label>
      {ACCESS_KEYS.map((k) => {
        const on = value.includes(k);
        return (
          <label key={k} className={`acc-row ${on ? 'on' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== k) : [...value.filter((x) => x !== 'acc_none'), k])} data-testid={k} />
            <span>{t[k]}</span>
          </label>
        );
      })}
    </div>
  );
}

export function Info({ value, onChange, onBack, onNext, location }: { value: InfoForm; onChange: (v: InfoForm) => void; onBack: () => void; onNext: () => void; location?: { on: boolean; denied: boolean; onToggle: (on: boolean) => void } }) {
  const { t } = useApp();
  const [submitted, setSubmitted] = useState(false);
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
          <fieldset className="field acc-field">
            <legend id="f-access-lbl">{t.accessibility}</legend>
            <p className="hint">{t.accessibilityHint}</p>
            <AccessibilityChecklist id="f-access" value={value.accessibility} onChange={(v) => set('accessibility', v)} />
          </fieldset>
          {location && (
            <div className="loc-optin">
              <label className={`acc-row ${location.on ? 'on' : ''}`}>
                <input type="checkbox" checked={location.on} onChange={(e) => location.onToggle(e.target.checked)} data-testid="share-location" />
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
    </Screen>
  );
}
