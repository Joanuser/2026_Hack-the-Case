import { useState, type ReactNode } from 'react';
import { useApp } from '../context';
import { BackLink, EmergencyWarning, Field, PrimaryButton, Progress, Screen, TextInput } from '../components/ui';
import { validateSymptoms, type SymptomForm } from '../lib/validation';

const PAIN = [0, 2, 4, 6, 8, 10];

export function SymptomFields({ value, onChange, errors }: { value: SymptomForm; onChange: (v: SymptomForm) => void; errors: Partial<Record<string, string>> }) {
  const { t } = useApp();
  const set = <K extends keyof SymptomForm>(k: K, v: SymptomForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="fields">
      <Field id="f-mainConcern" label={t.mainConcern} required error={errors.mainConcern}>
        {(a) => <textarea className="input textarea" rows={2} {...a} value={value.mainConcern} placeholder={t.mainConcernPh} onChange={(e) => set('mainConcern', e.target.value)} />}
      </Field>
      <Field id="f-onset" label={t.onset} required error={errors.onset}>
        {(a) => <TextInput {...a} value={value.onset} placeholder={t.onsetPh} onChange={(e) => set('onset', e.target.value)} />}
      </Field>
      <Field id="f-other" label={t.otherSymptoms}>
        {(a) => <TextInput {...a} value={value.otherSymptoms} placeholder={t.otherSymptomsPh} onChange={(e) => set('otherSymptoms', e.target.value)} />}
      </Field>
      <fieldset className={`field pain ${errors.painLevel ? 'has-error' : ''}`} aria-describedby="pain-hint">
        <legend className="req">{t.painLevel} *</legend>
        <div className="pain-row" role="radiogroup" id="f-painLevel" tabIndex={-1}>
          {PAIN.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={value.painLevel === n} className={value.painLevel === n ? 'on' : ''} onClick={() => set('painLevel', n)}>
              {n}
            </button>
          ))}
        </div>
        {errors.painLevel ? <p className="error" role="alert">{errors.painLevel}</p> : <p id="pain-hint" className="hint">{t.painHint}</p>}
      </fieldset>
    </div>
  );
}

export function Symptoms({ value, onChange, onBack, onNext, children }: { value: SymptomForm; onChange: (v: SymptomForm) => void; onBack: () => void; onNext: () => void; children?: ReactNode }) {
  const { t } = useApp();
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validateSymptoms(value, t) : {};
  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validateSymptoms(value, t);
    if (Object.keys(errs).length) { document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus(); return; }
    onNext();
  };
  return (
    <Screen label="symptoms">
      <BackLink onClick={onBack} />
      <form className="card form-card" onSubmit={next} noValidate>
        <Progress step={3} />
        <h1 tabIndex={-1}>{t.symptomsTitle}</h1>
        <EmergencyWarning />
        <p className="sub">{t.symptomsSub}</p>
        <SymptomFields value={value} onChange={onChange} errors={errors} />
        {children}
        <div className="actions">
          <PrimaryButton type="submit">{t.reviewCheckIn}</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
