// Tablet (kiosk) mode: the hospital's check-in tablet opens /tablet/ (or ?device=tablet).
// Pages are the same as on a phone; the tablet also prints a QR slip and lets a
// patient scan that slip later to tell the care team they are leaving.
export const IS_TABLET =
  typeof window !== 'undefined' &&
  (window.location.pathname.startsWith('/tablet') ||
    new URLSearchParams(window.location.search).get('device') === 'tablet');

const SLIP_PREFIX = 'SEENSOONER-SLIP';

export function encodeSlip(id: string, token: string, waitingNumber: string): string {
  return [SLIP_PREFIX, id, token, waitingNumber].map(encodeURIComponent).join(':');
}

export interface SlipData { id: string; token: string; waitingNumber: string }

export function parseSlip(raw: string): SlipData | null {
  const parts = raw.trim().split(':');
  if (parts.length !== 4 || decodeURIComponent(parts[0]) !== SLIP_PREFIX) return null;
  const [id, token, waitingNumber] = parts.slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  if (!id || !token || !waitingNumber) return null;
  return { id, token, waitingNumber };
}
