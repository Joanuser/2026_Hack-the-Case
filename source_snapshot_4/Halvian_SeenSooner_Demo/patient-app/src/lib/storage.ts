// Small wrappers around Web Storage that never throw (private mode, quota, etc.).
export function readJson<T>(store: Storage, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(store: Storage, key: string, value: unknown) {
  try {
    if (value === null || value === undefined) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface PatientSession {
  id: string;
  token: string;
  waitingNumber: string;
  locationAuthorization: { granted: boolean; recordedAt: string } | null;
}

export const SESSION_KEY = 'seensooner.patient.session';
export const DRAFT_KEY = 'seensooner.patient.draft';
export const LANG_KEY = 'seensooner.patient.lang';
