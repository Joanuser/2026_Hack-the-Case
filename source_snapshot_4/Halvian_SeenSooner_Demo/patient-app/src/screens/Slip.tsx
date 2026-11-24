import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../context';
import { PrimaryButton, Screen } from '../components/ui';
import { encodeSlip } from '../lib/device';
import type { PatientSession } from '../lib/storage';

const AUTO_RESET_MS = 90_000;

/** Tablet only: the check-in slip with a QR code the patient scans later to report leaving. */
export function Slip({ session, onDone }: { session: PatientSession; onDone: () => void }) {
  const { t } = useApp();
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(encodeSlip(session.id, session.token, session.waitingNumber), { margin: 1, width: 400, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [session]);
  useEffect(() => { const id = setTimeout(onDone, AUTO_RESET_MS); return () => clearTimeout(id); }, [onDone]);
  return (
    <Screen label="slip" className="slip-main">
      <div className="card slip-card">
        <h1 tabIndex={-1} className="slip-title">{t.slipTitle}</h1>
        <div className="number-block">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value" data-testid="slip-number">{session.waitingNumber}</p>
        </div>
        <div className="slip-qr" data-testid="slip-qr">
          {qr ? <img src={qr} alt={t.slipQrAlt} width={200} height={200} /> : <span className="slip-qr-placeholder" />}
        </div>
        <p className="slip-note">{t.slipScanNote}</p>
        <p className="slip-sub">{t.slipPhotoNote}</p>
        <PrimaryButton wide onClick={onDone}>{t.slipDone}</PrimaryButton>
      </div>
    </Screen>
  );
}
