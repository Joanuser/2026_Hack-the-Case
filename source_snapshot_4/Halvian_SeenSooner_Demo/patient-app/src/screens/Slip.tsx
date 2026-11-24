import { useEffect } from 'react';
import { useApp } from '../context';
import { PrimaryButton, Screen } from '../components/ui';
import type { PatientSession } from '../lib/storage';

const AUTO_RESET_MS = 90_000;

/** Tablet only: the check-in slip. The waiting number is what the patient uses later at the tablet. */
export function Slip({ session, onDone }: { session: PatientSession; onDone: () => void }) {
  const { t } = useApp();
  useEffect(() => { const id = setTimeout(onDone, AUTO_RESET_MS); return () => clearTimeout(id); }, [onDone]);
  return (
    <Screen label="slip" className="slip-main">
      <div className="card slip-card">
        <h1 tabIndex={-1} className="slip-title">{t.slipTitle}</h1>
        <div className="number-block slip-number">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value" data-testid="slip-number">{session.waitingNumber}</p>
        </div>
        <p className="slip-note">{t.slipScanNote}</p>
        <p className="slip-sub">{t.slipPhotoNote}</p>
        <PrimaryButton wide onClick={onDone}>{t.slipDone}</PrimaryButton>
      </div>
    </Screen>
  );
}
