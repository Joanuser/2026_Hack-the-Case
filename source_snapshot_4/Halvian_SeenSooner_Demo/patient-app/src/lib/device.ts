// Tablet (kiosk) mode: the hospital's check-in tablet opens /tablet/ (or ?device=tablet).
// Pages are the same as on a phone; the tablet also shows a check-in slip with the waiting number,
// and an "Already checked in? Tell us" flow (waiting number + date of birth).
export const IS_TABLET =
  typeof window !== 'undefined' &&
  (window.location.pathname.startsWith('/tablet') ||
    new URLSearchParams(window.location.search).get('device') === 'tablet');
