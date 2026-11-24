// Type declarations for store.mjs (used by the in-browser memory adapter).
export declare const CONFIG: Record<string, number | string>;
export declare const SOURCE_LABEL: Record<string, string>;
export declare class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>);
}
export declare function draftSummary(symptoms: unknown, language?: string): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface MockStore {
  getState(): Any;
  subscribe(fn: (evt: Any) => void): () => void;
  reset(): void;
  draftSummary(body: Any): Any;
  createCheckIn(input: Any): Any;
  getPatientStatus(id: string, token: string): Any;
  updateSymptoms(id: string, token: string, body: Any): Any;
  updateInsurance(id: string, token: string, body: Any): Any;
  reportLocationExit(id: string, token: string, body: Any): Any;
  listPatients(): Any;
  createStaffPatient(input: Any): Any;
  updatePatient(id: string, patch: Any, actor?: string): Any;
  recordContact(id: string, body: Any, actor?: string): Any;
  publicQueue(): Any;
}
export declare function createStore(opts?: { now?: () => number; seed?: boolean; initialState?: Any }): MockStore;
