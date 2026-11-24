import { useApp } from '../context';
import type { PatientStatusView } from '../api';
import { BackLink, EmergencyWarning, Screen } from '../components/ui';
import type { InfoForm } from '../lib/validation';
import { ACCESS_KEYS } from './Info';

/** Read-only view of what was submitted (reached via Back from the waiting screen). */
export function Details({ info, status, waitingNumber, onBack }: { info: InfoForm; status: PatientStatusView | null; waitingNumber: string; onBack: () => void }) {
  const { t } = useApp();
  const s = status?.symptoms;
  return (
    <Screen label="details">
      <BackLink onClick={onBack} />
      <div className="card form-card">
        <p className="eyebrow">{t.yourWaitingNumber} · {waitingNumber}</p>
        <h1 tabIndex={-1}>{t.yourCheckIn}</h1>
        <EmergencyWarning />
        <dl className="kv">
          {info.legalName && (<><dt>{t.legalName}</dt><dd>{info.legalName}</dd></>)}
          {info.dob && (<><dt>{t.dob}</dt><dd dir="ltr">{info.dob}</dd></>)}
          {info.phone && (<><dt>{t.mobile}</dt><dd dir="ltr">{info.phone}</dd></>)}
          {info.accessibility.length > 0 && (<><dt>{t.accessibility}</dt><dd>{info.accessibility.map((k) => t[k as (typeof ACCESS_KEYS)[number]] || k).join(', ')}</dd></>)}
        </dl>
        {s && (
          <>
            <h2 className="h2">{t.submittedAnswers}</h2>
            <dl className="kv">
              <dt>{t.mainConcern}</dt><dd>{s.mainConcern}</dd>
              <dt>{t.onset}</dt><dd>{s.onset}</dd>
              {s.otherSymptoms && (<><dt>{t.otherSymptoms}</dt><dd>{s.otherSymptoms}</dd></>)}
              <dt>{t.painLevel}</dt><dd>{s.painLevel ?? '—'}/10</dd>
            </dl>
          </>
        )}
        {status?.summary && (
          <div className="ai-summary compact">
            <div className="ai-head"><span className="ai-title">{t.aiSummary}</span><span className="chip-draft">{status.summary.editedByPatient ? t.editedByYou : t.draft}</span></div>
            <p className="ai-text">{status.summary.text}</p>
          </div>
        )}
      </div>
    </Screen>
  );
}
