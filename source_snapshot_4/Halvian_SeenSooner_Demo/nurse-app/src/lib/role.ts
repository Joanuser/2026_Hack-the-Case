// Two dashboards, one app: nurses open /nurse/, the front desk opens /frontdesk/ (or ?role=frontdesk).
// In the pilot each role signs in with its own account and sees only its own lists.
export type Role = 'nurse' | 'frontdesk';
const path = typeof window !== 'undefined' ? window.location.pathname : '';
const param = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('role') : null;
export const ROLE: Role = param === 'frontdesk' || /^\/frontdesk(\/|$)/.test(path) ? 'frontdesk' : 'nurse';
export const ROLE_LABEL: Record<Role, string> = { nurse: 'Nurse Dashboard', frontdesk: 'Front Desk Dashboard' };
