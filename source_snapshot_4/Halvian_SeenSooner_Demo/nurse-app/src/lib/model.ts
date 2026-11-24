// View model helpers: labels, derived values, filtering and sorting for every dashboard area.
import type { CheckInSource, Contact, PatientStatus, StaffPatient } from '../api';

export type View = 'assessment' | 'followup' | 'in_assessment' | 'completed' | 'unseen' | 'callbacks';

export const SOURCE_LABEL: Record<CheckInSource, string> = {
  mobile: 'Mobile check-in',
  ipad: 'Tablet check-in',
  front_desk: 'Front desk check-in',
  staff_assisted: 'Staff-assisted',
  walk_in: 'Walk-in registration',
};

export const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  zh: 'Chinese',
  ar: 'Arabic',
  vi: 'Vietnamese',
  fr: 'French',
  ht: 'Haitian Creole',
  other: 'Other',
};
export const languageName = (c: string) => LANGUAGE_LABEL[c] || c.toUpperCase();

export const STATUS_LABEL: Record<PatientStatus, string> = {
  waiting_nurse: 'Waiting for nurse',
  in_assessment: 'In assessment',
  waiting_provider: 'Waiting for provider',
  with_care_team: 'With care team',
  completed: 'Visit complete',
  left: 'Left',
  inactive: 'Inactive after recall',
};

/** Nurse-assigned acuity (ESI). Set only by a nurse — never by the AI summary. */
export const PRIORITY: { value: number; label: string }[] = [
  { value: 1, label: 'ESI 1 · Resuscitation' },
  { value: 2, label: 'ESI 2 · Emergent' },
  { value: 3, label: 'ESI 3 · Urgent' },
  { value: 4, label: 'ESI 4 · Less urgent' },
  { value: 5, label: 'ESI 5 · Non-urgent' },
];

export const FOLLOW_UP_LABEL = {
  needs_follow_up: 'Needs follow-up',
  recheck: 'Recheck',
  checked: 'Checked in',
  symptoms_changed: 'Symptoms changed',
} as const;

export function waitMinutes(p: StaffPatient, now: number) {
  if (p.triageCompletedAt) return Math.max(0, Math.floor(p.w2ElapsedMinutes));
  return Math.max(0, Math.floor((now - Date.parse(p.checkedInAt)) / 60000));
}

export function ago(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

export function age(dob: string, now: number) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date(now);
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

const STAFF_CONTACT: Contact['kind'][] = ['registration', 'check_in', 'symptoms_changed'];
/** Last contact by staff (registration desk or nurse). Self check-in and phone answers don't count. */
export function lastStaffContact(p: StaffPatient): Contact | null {
  for (let i = p.contacts.length - 1; i >= 0; i--) if (STAFF_CONTACT.includes(p.contacts[i].kind)) return p.contacts[i];
  return null;
}

export const ACCESS_LABEL: Record<string, string> = {
  acc_wheelchair: 'Wheelchair / mobility help',
  acc_interpreter: 'Interpreter',
  acc_hearing: 'Hearing support',
  acc_vision: 'Vision support',
  acc_forms: 'Help with forms',
  acc_other: 'Other (ask patient)',
};

// ---------- area membership ----------
export function inView(p: StaffPatient, v: View) {
  switch (v) {
    case 'assessment': return p.status === 'waiting_nurse';
    case 'followup': return !p.hasLiveUpdates && ['waiting_nurse', 'waiting_provider'].includes(p.status);
    case 'in_assessment': return p.status === 'in_assessment';
    case 'completed': return ['waiting_provider', 'with_care_team', 'completed', 'left', 'inactive'].includes(p.status) && (!!p.assessedAt || ['left', 'inactive'].includes(p.status));
    // front desk: everyone registered but not yet seen by a provider (not triaged, in triage, or waiting for a provider)
    case 'unseen': return ['waiting_nurse', 'in_assessment', 'waiting_provider'].includes(p.status);
    // front desk: open call-backs (left via the tablet) and "check on me" requests
    case 'callbacks': return p.callBack?.status === 'open' || p.tabletRequest?.status === 'open';
  }
}

// ---------- filters ----------
export type WaitRange = 'all' | 'lt30' | '30to50' | 'gt50';
export const WAIT_RANGE_LABEL: Record<WaitRange, string> = { all: 'All waits', lt30: 'Under 30 min', '30to50': '30–50 min', gt50: '50+ min' };

export interface Filters {
  method: 'all' | CheckInSource;
  wait: WaitRange;
  followUp: 'needs' | 'checked' | 'all'; // follow-up area only
  status: 'all' | PatientStatus; // completed area only
  changedOnly: boolean; // assessment area only
}

export const DEFAULT_FILTERS: Record<View, Filters> = {
  assessment: { method: 'all', wait: 'all', followUp: 'all', status: 'all', changedOnly: false },
  followup: { method: 'all', wait: 'all', followUp: 'needs', status: 'all', changedOnly: false },
  in_assessment: { method: 'all', wait: 'all', followUp: 'all', status: 'all', changedOnly: false },
  completed: { method: 'all', wait: 'all', followUp: 'all', status: 'all', changedOnly: false },
  unseen: { method: 'all', wait: 'all', followUp: 'all', status: 'all', changedOnly: false },
  callbacks: { method: 'all', wait: 'all', followUp: 'all', status: 'all', changedOnly: false },
};

export function applyFilters(list: StaffPatient[], f: Filters, v: View, now: number) {
  return list.filter((p) => {
    if (f.method !== 'all' && p.source !== f.method) return false;
    const w = waitMinutes(p, now);
    if (f.wait === 'lt30' && w >= 30) return false;
    if (f.wait === '30to50' && (w < 30 || w > 50)) return false;
    if (f.wait === 'gt50' && w <= 50) return false;
    if (v === 'followup') {
      const needs = p.followUpStatus && p.followUpStatus !== 'checked';
      if (f.followUp === 'needs' && !needs) return false;
      if (f.followUp === 'checked' && p.followUpStatus !== 'checked') return false;
    }
    if (v === 'completed' && f.status !== 'all' && p.status !== f.status) return false;
    if (v === 'assessment' && f.changedOnly && !p.symptomsChanged) return false;
    return true;
  });
}

// ---------- sorting ----------
export type SortKey = 'rank' | 'number' | 'patient' | 'wait' | 'location' | 'contact' | 'status' | 'concern' | 'priority';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }

export const DEFAULT_SORT: Record<View, Sort> = {
  assessment: { key: 'rank', dir: 'asc' },
  followup: { key: 'wait', dir: 'desc' },
  in_assessment: { key: 'wait', dir: 'desc' },
  completed: { key: 'rank', dir: 'asc' },
  unseen: { key: 'wait', dir: 'desc' },
  callbacks: { key: 'contact', dir: 'asc' },
};

const FU_ORDER = { symptoms_changed: 0, needs_follow_up: 1, recheck: 2, checked: 3 } as const;
const STATUS_ORDER: Record<PatientStatus, number> = { with_care_team: 0, waiting_provider: 1, waiting_nurse: 2, in_assessment: 3, inactive: 4, completed: 5, left: 6 };

export function sortList(list: StaffPatient[], s: Sort, v: View, now: number) {
  const val = (p: StaffPatient): string | number => {
    switch (s.key) {
      case 'rank':
        if (v === 'completed') return STATUS_ORDER[p.status] * 1e6 + (p.peopleAhead ?? 0) * 1e3 - waitMinutes(p, now) / 1e3;
        return (p.symptomsChanged ? 0 : 1) * 1e7 + Date.parse(p.checkedInAt) / 1e6;
      case 'number': return Number(p.waitingNumber.replace(/\D/g, '')) || 0;
      case 'patient': return p.legalName.toLowerCase();
      case 'wait': return waitMinutes(p, now);
      case 'location': return p.location ? `${p.location.zone} ${p.location.seat.padStart(8, '0')}` : '~';
      case 'contact': { const c = lastStaffContact(p); return c ? Date.parse(c.at) : 0; }
      case 'status': return v === 'followup' ? FU_ORDER[(p.followUpStatus || 'checked') as keyof typeof FU_ORDER] : STATUS_ORDER[p.status];
      case 'concern': return (p.summary?.text || p.symptoms.mainConcern).toLowerCase();
      case 'priority': return p.nursePriority ?? 9;
    }
  };
  const dir = s.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const A = val(a), B = val(b);
    if (A < B) return -1 * dir;
    if (A > B) return 1 * dir;
    return a.waitingNumber.localeCompare(b.waitingNumber);
  });
}
