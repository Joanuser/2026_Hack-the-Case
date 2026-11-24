import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context';
import { PrimaryButton, Screen } from '../components/ui';
import type { PatientSession } from '../lib/storage';

const AUTO_RESET_MS = 90_000;

// Hospital tablets run the browser in kiosk mode with silent printing to the receipt printer beside the
// tablet (e.g. Chrome --kiosk --kiosk-printing, opened with ?kiosk=1), so the slip prints by itself.
// Elsewhere (the public demo) printing is not triggered automatically; "Print again" opens the print dialog.
const KIOSK_PRINT = new URLSearchParams(window.location.search).get('kiosk') === '1';

/** Tablet only: the printed check-in slip (number only). Patients without a phone keep it to use the tablet later. */
export function Slip({ session, onDone }: { session: PatientSession; onDone: () => void }) {
  const { t } = useApp();
  useEffect(() => { const id = setTimeout(onDone, AUTO_RESET_MS); return () => clearTimeout(id); }, [onDone]);
  useEffect(() => { if (KIOSK_PRINT) { const id = setTimeout(() => window.print(), 300); return () => clearTimeout(id); } }, []);
  return (
    <Screen label="slip" className="slip-main">
      <div className="card slip-card">
        <h1 tabIndex={-1} className="slip-title">{t.slipTitle}</h1>
        <div className="number-block slip-number">
          <p className="number-label">{t.yourWaitingNumber}</p>
          <p className="number-value" data-testid="slip-number">{session.waitingNumber}</p>
        </div>
        <p className="slip-note">{t.slipScanNote}</p>
        <p className="slip-printing" role="status"><PrinterIcon />{t.slipPrinting}</p>
        <PrimaryButton wide onClick={onDone}>{t.slipDone}</PrimaryButton>
        <button type="button" className="link-btn slip-reprint" onClick={() => window.print()}>{t.slipPrintAgain}</button>
      </div>
      {createPortal(
        <div className="slip-print" aria-hidden>
        <p className="sp-head">{t.slipPrintHead}</p>
        <p className="sp-label">{t.yourWaitingNumber}</p>
        <p className="sp-num">{session.waitingNumber}</p>
        <p className="sp-note">{t.slipScanNote}</p>
        <p className="sp-time">{new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
      </div>,
        document.body,
      )}
    </Screen>
  );
}

function PrinterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
    </svg>
  );
}
