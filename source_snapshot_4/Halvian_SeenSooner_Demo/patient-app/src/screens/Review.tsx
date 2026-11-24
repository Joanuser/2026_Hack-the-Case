import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { api, type Symptoms } from '../api';
import { Shield, Sparkle } from '../ui/icons';
import { Banner, BackLink, PrimaryButton, Progress, Screen } from '../components/ui';
import type { InfoForm, SymptomForm } from '../lib/validation';

export interface SummaryState {
  key: string; // symptoms+language the draft was generated for
  status: 'idle' | 'loading' | 'ready' | 'failed';
  draft: string;
  text: string;
  editedByPatient: boolean;
}

export const emptySummary: SummaryState = { key: '', status: 'idle', draft: '', text: '', editedByPatient: false };

export function summaryKey(s: SymptomForm, lang: string) {
  return JSON.stringify([s.mainConcern.trim(), s.onset.trim(), s.otherSymptoms.trim(), s.painLevel, lang]);
}

export function toSymptoms(s: SymptomForm): Symptoms {
  return { mainConcern: s.mainConcern.trim(), onset: s.onset.trim(), otherSymptoms: s.otherSymptoms.trim(), painLevel: s.painLevel };
}

/** AI summary card — always labelled as a draft the patient can correct. */
export function SummaryCard({ symptoms, summary, setSummary }: { symptoms: SymptomForm; summary: SummaryState; setSummary: (s: SummaryState) => void }) {
  const { t, lang } = useApp();
  const key = summaryKey(symptoms, lang);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);

  const generate = async () => {
    setSummary({ ...emptySummary, key, status: 'loading' });
    try {
      const r = await api.draftSummary(toSymptoms(symptoms), lang);
      setSummary({ key, status: 'ready', draft: r.draft, text: r.draft, editedByPatient: false });
    } catch {
      setSummary({ ...emptySummary, key, status: 'failed' });
    }
  };

  useEffect(() => {
    if (summary.key !== key || summary.status === 'idle') void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const startEdit = () => { setDraftText(summary.text); setEditErr(null); setEditing(true); };
  const saveEdit = () => {
    if (!draftText.trim()) { setEditErr(t.summaryEmpty); return; }
    setSummary({ ...summary, text: draftText.trim(), editedByPatient: draftText.trim() !== summary.draft });
    setEditing(false);
  };

  return (
    <section className="ai-summary" aria-labelledby="ai-title" aria-busy={summary.status === 'loading'}>
      <div className="ai-head">
        <span className="ai-title" id="ai-title"><Sparkle size={18} /> {t.aiSummary}</span>
        <span className="chip-draft">{summary.editedByPatient ? t.editedByYou : t.draft}</span>
      </div>
      {summary.status === 'loading' && (
        <div className="skeleton-lines" role="status">
          <span /><span /><span className="short" />
          <p className="sr-only">{t.organizing}</p>
        </div>
      )}
      {summary.status === 'failed' && (
        <Banner kind="warn" action={<button type="button" className="link-btn" onClick={generate}>{t.retry}</button>}>{t.summaryFailed}</Banner>
      )}
      {summary.status === 'ready' && !editing && (
        <>
          <p className="ai-text" data-testid="ai-summary-text">{summary.text}</p>
          <button type="button" className="link-btn left" onClick={startEdit}>{t.editSummary}</button>
        </>
      )}
      {summary.status === 'ready' && editing && (
        <div className="ai-edit">
          <textarea className="input textarea" rows={4} value={draftText} onChange={(e) => { setDraftText(e.target.value); setEditErr(null); }} aria-label={t.editSummary} aria-invalid={!!editErr} />
          {editErr && <p className="error" role="alert">{editErr}</p>}
          <div className="row-gap">
            <button type="button" className="btn-small primary" onClick={saveEdit}>{t.save}</button>
            <button type="button" className="btn-small" onClick={() => setEditing(false)}>{t.cancel}</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function Review({
  info,
  symptoms,
  summary,
  setSummary,
  onBack,
  onEditInfo,
  onSubmit,
}: {
  info: InfoForm;
  symptoms: SymptomForm;
  summary: SummaryState;
  setSummary: (s: SummaryState) => void;
  onBack: () => void;
  onEditInfo: () => void;
  onSubmit: () => Promise<void>;
}) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onSubmit(); } catch { setError(t.submitError); setBusy(false); }
  };
  return (
    <Screen label="review">
      <BackLink onClick={onBack} />
      <div className="card review-card">
        <Progress step={4} />
        <h1 tabIndex={-1}>{t.reviewTitle}</h1>
        <p className="sub">{t.reviewSub}</p>
        <SummaryCard symptoms={symptoms} summary={summary} setSummary={setSummary} />
        <details className="details-box">
          <summary>{t.yourDetails}</summary>
          <dl>
            <dt>{t.legalName}</dt><dd>{info.legalName}</dd>
            <dt>{t.dob}</dt><dd dir="ltr">{info.dob}</dd>
            {info.phone && (<><dt>{t.mobile}</dt><dd dir="ltr">{info.phone}</dd></>)}
            <dt>{t.insurance}</dt><dd>{info.insuranceDeferred ? t.insuranceLater : info.insurance}</dd>
          </dl>
          <button type="button" className="link-btn left" onClick={onEditInfo}>{t.edit}</button>
        </details>
        <div className="nurse-rule">
          <Shield size={18} />
          <p>{t.nurseRule}</p>
        </div>
        {error && <Banner kind="error">{error}</Banner>}
        <div className="actions">
          <PrimaryButton onClick={submit} busy={busy} disabled={summary.status === 'loading'}>
            {busy ? t.submitting : t.submitCheckIn}
          </PrimaryButton>
        </div>
        <p className="foot-note">{t.submitNote}</p>
      </div>
    </Screen>
  );
}
