import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { ChevronDown } from '../ui/icons';
import { BackLink, EmergencyWarning, Field, PrimaryButton, Progress, Screen, TextInput } from '../components/ui';
import { maskDob, validateInfo, type InfoForm } from '../lib/validation';

export const ACCESS_KEYS = ['acc_wheelchair', 'acc_interpreter', 'acc_hearing', 'acc_vision', 'acc_forms', 'acc_other'] as const;

function AccessibilitySelect({ value, onChange, id }: { value: string[]; onChange: (v: string[]) => void; id: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const label = value.length === 0 ? t.accessibilityPh : value.length === 1 ? t[value[0] as (typeof ACCESS_KEYS)[number]] : t.selectedCount.replace('{n}', String(value.length));
  return (
    <div className="select" ref={ref}>
      <button type="button" id={id} className={`input select-trigger ${value.length ? '' : 'placeholder'}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="select-pop" role="listbox" aria-multiselectable="true">
          {ACCESS_KEYS.map((k) => {
            const on = value.includes(k);
            return (
              <label key={k} className="check-row" role="option" aria-selected={on}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])} />
                <span>{t[k]}</span>
              </label>
            );
          })}
          <button type="button" className="select-done" onClick={() => setOpen(false)}>{t.save}</button>
        </div>
      )}
    </div>
  );
}

export function Info({ value, onChange, onBack, onNext }: { value: InfoForm; onChange: (v: InfoForm) => void; onBack: () => void; onNext: () => void }) {
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
            {(a) => <TextInput {...a} value={value.dob} inputMode="numeric" autoComplete="bday" placeholder={t.dobPh} onChange={(e) => set('dob', maskDob(e.target.value))} dir="ltr" />}
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
          <Field id="f-access" label={t.accessibility}>
            {(a) => <AccessibilitySelect id={a.id} value={value.accessibility} onChange={(v) => set('accessibility', v)} />}
          </Field>
        </div>
        <div className="actions">
          <PrimaryButton type="submit">{t.continue}</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
