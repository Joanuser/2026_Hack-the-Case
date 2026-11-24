import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type CamState = 'idle' | 'starting' | 'active' | 'blocked';

/** Camera + QR decode loop (BarcodeDetector when available, jsQR otherwise). */
export function useQrScanner(onCode: (raw: string) => void, enabled = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<CamState>('idle');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCam((c) => (c === 'active' || c === 'starting' ? 'idle' : c));
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setCam('blocked'); return; }
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => undefined); }
      setCam('active');
    } catch {
      setCam('blocked');
    }
  }, []);

  useEffect(() => {
    if (enabled && cam === 'idle') void start();
  }, [enabled, cam, start]);

  useEffect(() => {
    if (cam !== 'active') return;
    let raf = 0;
    let last = 0;
    let busy = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    type BD = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BD };
    const detector = W.BarcodeDetector ? new W.BarcodeDetector({ formats: ['qr_code'] }) : null;
    const tick = async (ts: number) => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || busy || ts - last < 250 || v.readyState < 2) return;
      last = ts;
      busy = true;
      try {
        let raw: string | null = null;
        if (detector) raw = (await detector.detect(v))[0]?.rawValue ?? null;
        else if (ctx) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          raw = jsQR(img.data, img.width, img.height)?.data ?? null;
        }
        if (raw) onCodeRef.current(raw);
      } catch { /* keep scanning */ }
      busy = false;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cam]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((tr) => tr.stop()); }, []);

  return { videoRef, cam, start, stop };
}
