import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { useApp } from '../context';
import { Camera, Check, Pin } from '../ui/icons';
import { Field, Modal, PrimaryButton, Screen, TextInput } from '../components/ui';

const ALLOWED = String(import.meta.env.VITE_SITE_CODES || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/** Accepts `https://…?site=CODE`, `SEENSOONER:CODE` or a bare code. Returns the code or null. */
export function parseSiteCode(raw: string): string | null {
  let code = raw.trim();
  try {
    const u = new URL(code);
    code = u.searchParams.get('site') || '';
  } catch {
    code = code.replace(/^seensooner:/i, '');
  }
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) return null;
  if (ALLOWED.length && !ALLOWED.includes(code)) return null;
  return code;
}

type CamState = 'idle' | 'starting' | 'active' | 'blocked';

export function Scan({
  locationDecided,
  onLocationDecision,
  siteCode,
  onSite,
}: {
  locationDecided: boolean;
  onLocationDecision: (allow: boolean) => Promise<void>;
  siteCode: string | null;
  onSite: (code: string) => void;
}) {
  const { t } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<CamState>('idle');
  const [torchOk, setTorchOk] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState<string | undefined>();
  const [locBusy, setLocBusy] = useState(false);
  const [found, setFound] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const accept = useCallback(
    (c: string) => {
      setFound(c);
      stop();
      setTimeout(() => onSite(c), 600);
    },
    [onSite, stop],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setCam('blocked'); return; }
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => undefined); }
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchOk(!!caps.torch);
      setCam('active');
    } catch {
      setCam('blocked');
    }
  }, []);

  // Decode loop
  useEffect(() => {
    if (cam !== 'active') return;
    let raf = 0;
    let last = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    type BD = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BD };
    const detector = W.BarcodeDetector ? new W.BarcodeDetector({ formats: ['qr_code'] }) : null;
    let busy = false;
    const tick = async (ts: number) => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || busy || ts - last < 250 || v.readyState < 2) return;
      last = ts;
      busy = true;
      try {
        let raw: string | null = null;
        if (detector) {
          const r = await detector.detect(v);
          raw = r[0]?.rawValue ?? null;
        } else if (ctx) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          raw = jsQR(img.data, img.width, img.height)?.data ?? null;
        }
        if (raw) {
          const c = parseSiteCode(raw);
          if (c) accept(c);
          else setScanError(t.qrNotRecognized);
        }
      } catch { /* keep scanning */ }
      busy = false;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cam, accept, t.qrNotRecognized]);

  // Start the camera once the location question is answered (and no site is known yet).
  useEffect(() => {
    if (locationDecided && !siteCode && cam === 'idle') void start();
  }, [locationDecided, siteCode, cam, start]);

  useEffect(() => () => stop(), [stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn(!torchOn);
    } catch { setTorchOk(false); }
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = parseSiteCode(code);
    if (!c) { setCodeErr(t.hospitalCodeInvalid); return; }
    accept(c);
  };

  const decide = async (allow: boolean) => {
    setLocBusy(true);
    await onLocationDecision(allow);
    setLocBusy(false);
  };

  const camLabel = found ? t.hospitalConfirmed : cam === 'active' ? t.cameraActive : cam === 'starting' ? t.cameraStarting : t.cameraOff;

  return (
    <Screen label="scan" className="scan-main">
      <div className="scan-card">
        <h1 className="scan-title" tabIndex={-1}>{t.scanTitle}</h1>
        <div className="scanner" data-testid="scanner">
          <div className="scanner-status">
            <span className={`dot ${cam === 'active' || found ? 'on' : ''}`} aria-hidden />
            <Camera size={16} />
            <span className="grow">{camLabel}</span>
            <button type="button" className="flash" onClick={toggleTorch} disabled={!torchOk} aria-pressed={torchOn}>
              {t.flash}
            </button>
          </div>
          <button type="button" className="viewfinder" onClick={() => (cam === 'idle' || cam === 'blocked') && start()} aria-label={t.tapToStartCamera}>
            <video ref={videoRef} playsInline muted className={cam === 'active' ? 'show' : ''} />
            <svg className="corners" viewBox="0 0 200 200" aria-hidden>
              <path d="M8 44V22A14 14 0 0 1 22 8h22M156 8h22a14 14 0 0 1 14 14v22M192 156v22a14 14 0 0 1-14 14h-22M44 192H22A14 14 0 0 1 8 178v-22" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
            </svg>
            {!found && <span className="scanline" aria-hidden />}
            {found && (
              <span className="found" role="status">
                <Check size={28} /> {found}
              </span>
            )}
            {cam !== 'active' && !found && <span className="vf-msg">{cam === 'blocked' ? t.cameraBlocked : t.tapToStartCamera}</span>}
          </button>
          <p className="scanner-help">{scanError || t.alignQr}</p>
        </div>
        <p className="scan-point">{t.pointCamera}</p>
        {!manual ? (
          <button type="button" className="link-btn" onClick={() => setManual(true)}>
            {t.enterCodeInstead}
          </button>
        ) : (
          <form className="manual-code" onSubmit={submitCode} noValidate>
            <Field label={t.hospitalCode} error={codeErr}>
              {(a) => (
                <TextInput {...a} value={code} autoCapitalize="characters" autoComplete="off" placeholder={t.hospitalCodePh} onChange={(e) => { setCode(e.target.value); setCodeErr(undefined); }} />
              )}
            </Field>
            <PrimaryButton type="submit">{t.continue}</PrimaryButton>
          </form>
        )}
        <p className="scan-foot">{t.sentToTeam}</p>
      </div>

      {!locationDecided && (
        <Modal labelledBy="loc-title" className="loc-dialog">
          <div className="loc-icon"><Pin size={26} /></div>
          <h2 id="loc-title">{t.locationTitle}</h2>
          <p className="loc-body">{t.locationBody}</p>
          <PrimaryButton wide onClick={() => decide(true)} busy={locBusy}>{locBusy ? t.locating : t.allowLocation}</PrimaryButton>
          <button type="button" className="btn-outline wide" onClick={() => decide(false)} disabled={locBusy}>
            {t.notNow}
          </button>
        </Modal>
      )}
    </Screen>
  );
}
