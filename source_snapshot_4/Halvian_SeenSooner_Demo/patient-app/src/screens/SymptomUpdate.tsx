import { useState } from 'react';
import { useApp } from '../context';
import { api, type PatientStatusView } from '../api';
import { Banner, BackLink, EmergencyWarning, Field, PrimaryButton, Screen } from '../components/ui';
import { SymptomFields } from './Symptoms';
import { SummaryCard, emptySummary, toSymptoms, type SummaryState } from './Review';
import { validateSymptoms, type SymptomForm } from '../lib/validation';
import type { PatientSession } from '../lib/storage';

export function SymptomUpdate({ session, current, onBack, onSent }: { session: PatientSession; current: PatientStatusView | null; onBack: () => void; onSent: (s: PatientStatusView) => void }) {
  const { t } = useApp();
  const [form, setForm] = useState<SymptomForm>(() => ({
    mainConcern: current?.symptoms.mainConcern ?? '',
    onset: current?.symptoms.onset ?? '',
    otherSymptoms: current?.symptoms.otherSymptoms ?? '',
    painLevel: current?.symptoms.painLevel ?? null,
  }));
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState<SummaryState>(emptySummary);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = submitted ? validateSymptoms(form, t) : {};
  const valid = Object.keys(validateSymptoms(form, t)).length === 0;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validateSymptoms(form, t);
    if (Object.keys(errs).length) { document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const s = await api.updateSymptoms(session.id, session.token, {
        symptoms: toSymptoms(form),
        summary: summary.status === 'ready' ? { draft: summary.draft, text: summary.text, editedByPatient: summary.editedByPatient } : undefined,
        note: note.trim(),
      });
      onSent(s);
    } catch {
      setError(t.updateError);
      setBusy(false);
    }
  };

  return (
    <Screen label="symptom-update">
      <BackLink onClick={onBack} />
      <form className="card form-card" onSubmit={send} noValidate>
        <h1 tabIndex={-1}>{t.updateTitle}</h1>
        <EmergencyWarning />
        <p className="sub">{t.updateSub}</p>
        <Field id="f-note" label={t.whatChanged}>
          {(a) => <textarea className="input textarea" rows={2} {...a} value={note} placeholder={t.whatChangedPh} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <SymptomFields value={form} onChange={setForm} errors={errors} />
        {valid && <SummaryCard symptoms={form} summary={summary} setSummary={setSummary} />}
        {error && <Banner kind="error">{error}</Banner>}
        <div className="actions">
          <PrimaryButton type="submit" busy={busy}>{busy ? t.sending : t.sendUpdate}</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
