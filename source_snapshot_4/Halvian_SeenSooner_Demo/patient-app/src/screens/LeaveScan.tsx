import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { fmt } from '../i18n';
import { api } from '../api';
import { Camera, Check } from '../ui/icons';
import { Banner, BackLink, PrimaryButton, Screen } from '../components/ui';
import { useQrScanner } from '../components/useQrScanner';
import { parseSlip, type SlipData } from '../lib/device';

type Phase = 'scan' | 'confirm' | 'sending' | 'done';

/** Tablet only: patient scans their check-in slip to tell the care team they are leaving. */
export function LeaveScan({ onExit }: { onExit: () => void }) {
  const { t } = useApp();
  const [phase, setPhase] = useState<Phase>('scan');
  const [slip, setSlip] = useState<SlipData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCode = useCallback((raw: string) => {
    const s = parseSlip(raw);
    if (!s) { setError(t.slipNotValid); return; }
    setError(null);
    setSlip(s);
    setPhase('confirm');
  }, [t.slipNotValid]);
  const scanner = useQrScanner(onCode, phase === 'scan');
  useEffect(() => { if (phase !== 'scan') scanner.stop(); }, [phase, scanner]);
  useEffect(() => {
    if (phase !== 'done') return;
    const id = setTimeout(onExit, 10_000);
    return () => clearTimeout(id);
  }, [phase, onExit]);

  const confirmLeaving = async () => {
    if (!slip) return;
    setPhase('sending');
    setError(null);
    try {
      await api.reportLocationExit(slip.id, slip.token, true, 'tablet');
      setPhase('done');
    } catch {
      setError(t.slipSendError);
      setPhase('confirm');
    }
  };

  if (phase === 'done' && slip) {
    return (
      <Screen label="leave-done" className="scan-main">
        <div className="card center-card">
          <div className="loc-icon round"><Check size={24} /></div>
          <h1 tabIndex={-1}>{t.leaveDoneTitle}</h1>
          <p className="wait-note">{fmt(t.leaveDoneBody, { n: slip.waitingNumber })}</p>
          <PrimaryButton wide onClick={onExit}>{t.slipDone}</PrimaryButton>
        </div>
      </Screen>
    );
  }

  if ((phase === 'confirm' || phase === 'sending') && slip) {
    return (
      <Screen label="leave-confirm" className="scan-main">
        <BackLink onClick={() => { setSlip(null); setPhase('scan'); }} />
        <div className="card center-card">
          <div className="number-block">
            <p className="number-label">{t.yourWaitingNumber}</p>
            <p className="number-value" data-testid="leave-number">{slip.waitingNumber}</p>
          </div>
          <h1 tabIndex={-1}>{t.leaveConfirmTitle}</h1>
          <p className="wait-note">{t.leaveConfirmBody}</p>
          {error && <Banner kind="error">{error}</Banner>}
          <button type="button" className="btn-danger-outline wide" onClick={confirmLeaving} disabled={phase === 'sending'}>{t.yesLeaving}</button>
          <button type="button" className="btn-primary wide" onClick={onExit} disabled={phase === 'sending'}>{t.stillHere}</button>
        </div>
      </Screen>
    );
  }

  const camLabel = scanner.cam === 'active' ? t.cameraActive : scanner.cam === 'starting' ? t.cameraStarting : t.cameraOff;
  return (
    <Screen label="leave-scan" className="scan-main">
      <BackLink onClick={onExit} />
      <div className="scan-card">
        <h1 className="scan-title" tabIndex={-1}>{t.leaveScanTitle}</h1>
        <div className="scanner" data-testid="leave-scanner">
          <div className="scanner-status">
            <span className={`dot ${scanner.cam === 'active' ? 'on' : ''}`} aria-hidden />
            <Camera size={16} />
            <span className="grow">{camLabel}</span>
          </div>
          <button type="button" className="viewfinder" onClick={() => (scanner.cam === 'idle' || scanner.cam === 'blocked') && scanner.start()} aria-label={t.tapToStartCamera}>
            <video ref={scanner.videoRef} playsInline muted className={scanner.cam === 'active' ? 'show' : ''} />
            <svg className="corners" viewBox="0 0 200 200" aria-hidden>
              <path d="M8 44V22A14 14 0 0 1 22 8h22M156 8h22a14 14 0 0 1 14 14v22M192 156v22a14 14 0 0 1-14 14h-22M44 192H22A14 14 0 0 1 8 178v-22" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
            </svg>
            <span className="scanline" aria-hidden />
            {scanner.cam !== 'active' && <span className="vf-msg">{scanner.cam === 'blocked' ? t.cameraBlocked : t.tapToStartCamera}</span>}
          </button>
          <p className="scanner-help" role={error ? 'alert' : undefined}>{error || t.leaveScanHelp}</p>
        </div>
        <p className="scan-point">{t.leaveScanNoSlip}</p>
      </div>
    </Screen>
  );
}
