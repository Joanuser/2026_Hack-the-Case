// SeenSooner shared API contract — TypeScript types.
// Identical copy in all three apps. See API_CONTRACT.md for the HTTP endpoints.

export type LanguageCode = 'en' | 'es' | 'zh' | 'ar' | (string & {});

export type CheckInSource = 'mobile' | 'ipad' | 'front_desk' | 'staff_assisted' | 'walk_in';

export type PatientStatus =
  | 'waiting_nurse' // checked in, waiting for nurse assessment
  | 'in_assessment' // nurse assessment in progress
  | 'waiting_provider' // nurse assessment complete, waiting to see a provider
  | 'with_care_team' // called back / being seen
  | 'completed' // visit closed
  | 'left' // departure recorded; LWBS still requires review
  | 'inactive'; // 30-minute recall ended; never equivalent to LWBS

export interface Symptoms {
  mainConcern: string;
  onset: string;
  otherSymptoms: string;
  painLevel: number | null; // 0–10
}

/** AI-organized summary. Always a DRAFT that the patient may correct. Never a triage decision. */
export interface SymptomSummary {
  draft: string; // what the summarizer produced
  text: string; // what the patient confirmed (may equal draft)
  editedByPatient: boolean;
}

export interface LocationAuthorization { granted: boolean; recordedAt: string }

export interface CheckInRequest {
  siteCode?: string | null;
  language: LanguageCode;
  legalName: string;
  dateOfBirth: string; // YYYY-MM-DD
  phone?: string;
  insurance?: string;
  insuranceDeferred?: boolean;
  accessibilityNeeds?: string[];
  symptoms: Symptoms;
  summary?: SymptomSummary;
  locationAuthorization?: LocationAuthorization;
}

export interface PatientStatusView {
  id: string;
  waitingNumber: string;
  status: PatientStatus;
  language: LanguageCode;
  peopleAhead: number | null;
  estimatedWaitMinutes: number | null;
  predictedRemainingW2Minutes: number | null;
  remainingW2Low: number | null;
  remainingW2High: number | null;
  predictedTotalW2Minutes: number | null;
  predictionGeneratedAt: string | null;
  predictionSource: string | null;
  w2ElapsedMinutes: number;
  triageCompletedAt: string | null;
  roomCalledAt: string | null;
  roomEnteredAt: string | null;
  w2ActualMinutes: number | null;
  callStatus: 'waiting' | 'called' | 'recall_active' | 'returned_requires_reassessment' | 'inactive' | 'entered';
  recallDeadlineAt: string | null;
  reassessmentRequired: boolean;
  careDue: boolean;
  insuranceMissing: boolean;
  symptoms: Symptoms;
  summary: SymptomSummary | null;
  lastSymptomUpdateAt: string | null;
  updatedAt: string;
}

export interface CheckInResponse {
  id: string;
  accessToken: string; // patient-scoped token; send as Bearer on /checkins/:id/*
  waitingNumber: string;
  status: PatientStatusView;
}

export interface DraftSummaryResponse { draft: string; generatedBy: string; isDraft: true }

export type ContactKind = 'registration' | 'check_in' | 'symptoms_changed' | 'status' | 'location_exit' | 'location_check' | 'tablet_request' | 'front_desk' | 'self_check_in';

export interface Contact { kind: ContactKind; label: string; note: string; at: string; checklist?: string[] }

export type FollowUpStatus = 'needs_follow_up' | 'recheck' | 'checked' | 'symptoms_changed' | null;

export interface StaffPatient {
  id: string;
  waitingNumber: string;
  legalName: string;
  dateOfBirth: string;
  phone: string;
  insurance: string;
  insuranceDeferred: boolean;
  accessibilityNeeds: string[];
  language: LanguageCode;
  source: CheckInSource;
  status: PatientStatus;
  symptoms: Symptoms;
  summary: SymptomSummary | null;
  location: { zone: string; seat: string } | null;
  nursePriority: number | null; // 1 (most urgent) – 5, set by a nurse only
  symptomsChanged: boolean;
  symptomUpdates: { at: string; by: 'patient' | 'staff'; previous: Symptoms; symptoms: Symptoms; note: string }[];
  contacts: Contact[];
  checkedInAt: string;
  updatedAt: string;
  assessedAt: string | null;
  // computed by the backend
  waitMinutes: number;
  peopleAhead: number | null;
  estimatedWaitMinutes: number | null;
  predictedRemainingW2Minutes: number | null;
  remainingW2Low: number | null;
  remainingW2High: number | null;
  predictedTotalW2Minutes: number | null;
  predictionGeneratedAt: string | null;
  predictionSource: string | null;
  predictionFallbackReason?: string | null;
  w2ElapsedMinutes: number;
  triageCompletedAt: string | null;
  requiredRoomType: 'REGULAR_ED' | 'FAST_TRACK' | 'RESUSCITATION_TRAUMA' | 'BEHAVIORAL_HEALTH' | null;
  roomCalledAt: string | null;
  roomEnteredAt: string | null;
  w2ActualMinutes: number | null;
  callStatus: 'waiting' | 'called' | 'recall_active' | 'returned_requires_reassessment' | 'inactive' | 'entered';
  recallDeadlineAt: string | null;
  reassessmentRequired: boolean;
  careDue: boolean;
  lastContact: Contact | null;
  followUpStatus: FollowUpStatus;
  hasLiveUpdates: boolean;
  /** Set when a patient tells the check-in tablet they are leaving (front desk calls back). */
  callBack?: { status: 'open' | 'done'; noPhone: boolean; phone: string; at: string; priority: 'Today' | 'Off-peak'; outcome?: string } | null;
  /** Set when a patient asks the tablet to be checked on. */
  tabletRequest?: { status: 'open' | 'done'; need: 'symptoms_worse' | 'question' | 'need_help'; at: string } | null;
  leaveReason?: { reason: string; details: string; source: string; at: string } | null;
}

export interface StaffPatientList {
  patients: StaffPatient[];
  updatedAt: string;
  config?: { recheckAfterMinutes: number; longWaitMinutes: number };
}

export interface StaffCreatePatientRequest {
  source: Exclude<CheckInSource, 'mobile'>;
  language: LanguageCode;
  legalName: string;
  dateOfBirth: string;
  phone?: string;
  insurance?: string;
  accessibilityNeeds?: string[];
  location?: { zone: string; seat: string } | null;
  symptoms: Partial<Symptoms> & { mainConcern: string };
}

export interface StaffUpdatePatientRequest {
  status?: PatientStatus;
  nursePriority?: number | null;
  location?: { zone: string; seat: string } | null;
  acknowledgeSymptomChange?: boolean;
  requiredRoomType?: 'REGULAR_ED' | 'FAST_TRACK' | 'RESUSCITATION_TRAUMA' | 'BEHAVIORAL_HEALTH';
  roomEvent?: 'called' | 'no_response' | 'returned' | 'entered';
  /** Front desk closes an open call-back or tablet request; the text is logged as a contact. */
  closeRequest?: string;
}

export interface StaffContactRequest {
  kind: 'check_in' | 'symptoms_changed';
  note?: string;
  checklist?: string[];
  notPresent?: boolean;
}

/** Public display payload — waiting numbers only. No names, symptoms or other PHI. */
export interface PublicQueue {
  updatedAt: string;
  providerQueue: { waitingNumber: string; estimatedWaitMinutes: number; remainingW2Low: number | null; remainingW2High: number | null; predictionSource: string | null }[];
  nowSeeing: { waitingNumber: string }[];
  awaitingNurse: { waitingNumber: string }[];
  inAssessment: { waitingNumber: string }[];
}

export type Channel = 'public' | 'staff' | 'patient';

export interface ChangeEvent {
  type: string;
  updatedAt: string;
  patientId?: string | null; // staff channel only
  waitingNumber?: string | null; // staff channel only
}

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export class ApiRequestError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
  get isNetwork() { return this.status === 0; }
}

export interface SeenSoonerApi {
  readonly mode: 'http' | 'memory';
  readonly baseUrl: string;
  // patient (phone)
  draftSummary(symptoms: Symptoms, language: LanguageCode): Promise<DraftSummaryResponse>;
  createCheckIn(req: CheckInRequest): Promise<CheckInResponse>;
  getCheckIn(id: string, token: string): Promise<PatientStatusView>;
  updateSymptoms(id: string, token: string, body: { symptoms: Symptoms; summary?: SymptomSummary; note?: string }): Promise<PatientStatusView>;
  updateInsurance(id: string, token: string, insurance: string): Promise<PatientStatusView>;
  reportLocationExit(id: string, token: string, left: boolean): Promise<PatientStatusView>;
  // staff (nurse dashboard)
  listPatients(): Promise<StaffPatientList>;
  createStaffPatient(req: StaffCreatePatientRequest): Promise<StaffPatient>;
  updatePatient(id: string, patch: StaffUpdatePatientRequest): Promise<StaffPatient>;
  recordContact(id: string, body: StaffContactRequest): Promise<StaffPatient>;
  // public (waiting-room display)
  getPublicQueue(): Promise<PublicQueue>;
  // realtime
  subscribe(
    channel: Channel,
    opts: { checkinId?: string; token?: string },
    onChange: (e: ChangeEvent) => void,
    onConnection: (s: ConnectionState) => void,
  ): () => void;
}
