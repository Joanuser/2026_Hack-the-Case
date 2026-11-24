// Client-side validation. The backend re-validates everything (see API_CONTRACT.md).
import type { Strings } from '../i18n';

export interface InfoForm {
  legalName: string;
  dob: string; // as typed: MM/DD/YYYY
  phone: string;
  insurance: string;
  insuranceDeferred: boolean;
  accessibility: string[];
}

export interface SymptomForm {
  mainConcern: string;
  onset: string;
  otherSymptoms: string;
  painLevel: number | null;
}

export const emptyInfo: InfoForm = { legalName: '', dob: '', phone: '', insurance: '', insuranceDeferred: false, accessibility: [] };
export const emptySymptoms: SymptomForm = { mainConcern: '', onset: '', otherSymptoms: '', painLevel: null };

/** Formats raw digits as MM / DD / YYYY while typing. */
export function maskDob(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)} / ${d.slice(2)}`;
  return `${d.slice(0, 2)} / ${d.slice(2, 4)} / ${d.slice(4)}`;
}

/** MM / DD / YYYY → YYYY-MM-DD, or null when not a real date. */
export function dobToIso(masked: string): string | null {
  const d = masked.replace(/\D/g, '');
  if (d.length !== 8) return null;
  const m = Number(d.slice(0, 2)), day = Number(d.slice(2, 4)), y = Number(d.slice(4));
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  if (y < new Date().getFullYear() - 120) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isoToDob(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${m} / ${d} / ${y}` : '';
}

export type Errors<K extends string> = Partial<Record<K, string>>;

export function validateInfo(f: InfoForm, t: Strings): Errors<'legalName' | 'dob' | 'phone' | 'insurance'> {
  const e: Errors<'legalName' | 'dob' | 'phone' | 'insurance'> = {};
  if (!f.legalName.trim()) e.legalName = t.errRequired;
  if (!f.dob.trim()) e.dob = t.errRequired;
  else {
    const iso = dobToIso(f.dob);
    if (!iso) e.dob = t.errDob;
    else if (Date.parse(iso) > Date.now()) e.dob = t.errDobFuture;
  }
  if (f.phone.trim() && f.phone.replace(/\D/g, '').length < 7) e.phone = t.errPhone;
  if (!f.insurance.trim() && !f.insuranceDeferred) e.insurance = t.errInsurance;
  return e;
}

export function validateSymptoms(f: SymptomForm, t: Strings): Errors<'mainConcern' | 'onset' | 'painLevel'> {
  const e: Errors<'mainConcern' | 'onset' | 'painLevel'> = {};
  if (!f.mainConcern.trim()) e.mainConcern = t.errRequired;
  if (!f.onset.trim()) e.onset = t.errRequired;
  if (f.painLevel === null) e.painLevel = t.errPain;
  return e;
}
