// SeenSooner mock queue store.
// Plain ES module (no dependencies) so it runs both in Node (mock-server/server.mjs)
// and in the browser (src/api/memoryAdapter.ts, VITE_API_MODE=memory).
//
// This is DEMO logic only. Wait estimates are a simple placeholder model, and the
// "AI summary" is a deterministic template. The real backend owns both.

export const CONFIG = {
  numberPrefix: 'A',
  nurseMinutesPerPatient: 6,
  providerBaseMinutes: 10,
  providerMinutesPerPatient: 10,
  recheckAfterMinutes: 30,
  longWaitMinutes: 45,
};

export const STATUSES = [
  'waiting_nurse',
  'in_assessment',
  'waiting_provider',
  'with_care_team',
  'completed',
  'left',
];

export const SOURCES = ['mobile', 'ipad', 'front_desk', 'staff_assisted', 'walk_in'];

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || undefined;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, fields: this.fields } };
  }
}

const MIN = 60 * 1000;

function randomId(len = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const buf = new Uint8Array(len);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
    return out;
  }
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function roundTo5(n) {
  return Math.max(5, Math.round(n / 5) * 5);
}

function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

// ---------- Validation (mirrors the client-side rules) ----------

export function validateDob(dob, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return 'invalid';
  const [y, m, d] = dob.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return 'invalid';
  if (date.getTime() > now) return 'future';
  if (y < new Date(now).getUTCFullYear() - 120) return 'invalid';
  return null;
}

export function validateIdentity(input, now = Date.now(), { requireInsurance = true } = {}) {
  const fields = {};
  if (!str(input.legalName)) fields.legalName = 'required';
  if (!str(input.dateOfBirth)) fields.dateOfBirth = 'required';
  else {
    const e = validateDob(str(input.dateOfBirth), now);
    if (e) fields.dateOfBirth = e;
  }
  const phone = str(input.phone);
  if (phone && phone.replace(/\D/g, '').length < 7) fields.phone = 'invalid';
  if (requireInsurance && !str(input.insurance) && !input.insuranceDeferred) fields.insurance = 'required';
  return fields;
}

export function validateSymptoms(s) {
  const fields = {};
  if (!s || typeof s !== 'object') return { mainConcern: 'required' };
  if (!str(s.mainConcern)) fields.mainConcern = 'required';
  if (!str(s.onset)) fields.onset = 'required';
  const p = Number(s.painLevel);
  if (s.painLevel === null || s.painLevel === undefined || s.painLevel === '' || !Number.isInteger(p) || p < 0 || p > 10) {
    fields.painLevel = 'required';
  }
  return fields;
}

function cleanSymptoms(s) {
  return {
    mainConcern: str(s.mainConcern, 300),
    onset: str(s.onset, 120),
    otherSymptoms: str(s.otherSymptoms, 300),
    painLevel: s.painLevel === null || s.painLevel === undefined || s.painLevel === '' ? null : Number(s.painLevel),
  };
}

// ---------- Draft summary (stand-in for the AI service) ----------

function lowerFirst(t) {
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

export function draftSummary(symptoms, language = 'en') {
  const s = cleanSymptoms(symptoms || {});
  const main = s.mainConcern.replace(/[.\s]+$/, '');
  const onset = lowerFirst(s.onset.replace(/[.\s]+$/, ''));
  const other = lowerFirst(s.otherSymptoms.replace(/[.\s]+$/, ''));
  const pain = Number.isFinite(s.painLevel) ? s.painLevel : null;
  switch (language) {
    case 'es':
      return `${main}, comenzó ${onset}${other ? `, con ${other}` : ''}${pain !== null ? ` y dolor ${pain}/10` : ''}.`;
    case 'zh':
      return `${main}, started ${s.onset}${other ? `, with ${s.otherSymptoms}` : ''}${pain !== null ? `, pain level ${pain}/10` : ''}.`;
    case 'ar':
      return `${main}، بدأ ${s.onset}${other ? `، مع ${s.otherSymptoms}` : ''}${pain !== null ? `، وشدة الألم ${pain}/10` : ''}.`;
    default: {
      const parts = [`${main} began ${onset}`];
      const tail = [];
      if (other) tail.push(other);
      if (pain !== null) tail.push(`pain ${pain}/10`);
      if (tail.length === 2) parts.push(`with ${tail[0]}, and ${tail[1]}`);
      else if (tail.length === 1) parts.push(`with ${tail[0]}`);
      return parts.join(', ') + '.';
    }
  }
}

// ---------- Seed data (matches the Figma sample content) ----------

function seedPatients(now) {
  const base = {
    phone: '',
    insurance: 'On file',
    insuranceDeferred: false,
    accessibilityNeeds: [],
    location: null,
    symptomsChanged: false,
    symptomUpdates: [],
    nursePriority: null,
    contacts: [],
    accessToken: null,
  };
  const p = (o) => ({
    ...base,
    ...o,
    id: o.id,
    checkedInAt: new Date(now - o.waitMin * MIN).toISOString(),
    updatedAt: new Date(now - Math.min(o.waitMin, 5) * MIN).toISOString(),
    summary: o.symptoms
      ? { draft: draftSummary(o.symptoms, o.language), text: draftSummary(o.symptoms, o.language), editedByPatient: false }
      : null,
  });
  const contact = (label, minAgo, kind = 'registration') => ({
    kind,
    label,
    note: '',
    at: new Date(now - minAgo * MIN).toISOString(),
  });
  return [
    p({ id: 'seed-a16', waitingNumber: 'A16', legalName: 'Jordan Lee', dateOfBirth: '1971-04-02', language: 'en', source: 'mobile', status: 'with_care_team', waitMin: 92, nursePriority: 3, assessedAt: new Date(now - 70 * MIN).toISOString(),
      symptoms: { mainConcern: 'Deep cut on left hand', onset: 'About 2 hours ago', otherSymptoms: 'Bleeding controlled', painLevel: 4 } }),
    p({ id: 'seed-a18', waitingNumber: 'A18', legalName: 'Sam Rivera', dateOfBirth: '1988-09-14', language: 'es', source: 'ipad', status: 'waiting_nurse', waitMin: 49, location: { zone: 'Zone B', seat: 'Seat 12' },
      symptoms: { mainConcern: 'Dolor abdominal', onset: 'Esta mañana', otherSymptoms: 'Náuseas', painLevel: 6 } }),
    p({ id: 'seed-a07', waitingNumber: 'A07', legalName: 'Avery Wilson', dateOfBirth: '1959-01-30', language: 'en', source: 'front_desk', status: 'waiting_provider', waitMin: 46, nursePriority: 3, assessedAt: new Date(now - 20 * MIN).toISOString(), location: { zone: 'Zone A', seat: 'Seat 04' },
      symptoms: { mainConcern: 'Dizziness when standing', onset: 'Yesterday evening', otherSymptoms: 'Fatigue', painLevel: 2 } }),
    p({ id: 'seed-a33', waitingNumber: 'A33', legalName: 'Cameron Davis', dateOfBirth: '1995-06-21', language: 'en', source: 'staff_assisted', status: 'waiting_provider', waitMin: 43, nursePriority: 4, assessedAt: new Date(now - 33 * MIN).toISOString(), location: { zone: 'Zone C', seat: 'Seat 21' },
      contacts: [contact('Front desk', 31, 'check_in')],
      symptoms: { mainConcern: 'Twisted right ankle', onset: 'About 1 hour ago', otherSymptoms: 'Swelling', painLevel: 6 } }),
    p({ id: 'seed-a14', waitingNumber: 'A14', legalName: 'Drew Martinez', dateOfBirth: '2001-11-03', language: 'es', source: 'walk_in', status: 'waiting_nurse', waitMin: 37, location: { zone: 'Zone B', seat: 'Seat 09' },
      contacts: [contact('Front desk', 29, 'registration')],
      symptoms: { mainConcern: 'Fiebre y tos', onset: 'Hace dos días', otherSymptoms: 'Dolor de garganta', painLevel: 2 } }),
    p({ id: 'seed-a26', waitingNumber: 'A26', legalName: 'Quinn Nguyen', dateOfBirth: '1979-03-12', language: 'vi', source: 'front_desk', status: 'waiting_nurse', waitMin: 32, location: { zone: 'Zone A', seat: 'Seat 07' },
      symptoms: { mainConcern: 'Headache', onset: 'Since this morning', otherSymptoms: 'Sensitivity to light', painLevel: 6 } }),
    p({ id: 'seed-a23', waitingNumber: 'A23', legalName: 'Morgan Patel', dateOfBirth: '1990-07-07', language: 'en', source: 'mobile', status: 'waiting_provider', waitMin: 58, nursePriority: 3, assessedAt: new Date(now - 40 * MIN).toISOString(),
      symptoms: { mainConcern: 'Painful urination', onset: 'Two days ago', otherSymptoms: 'Low fever', painLevel: 4 } }),
    p({ id: 'seed-a24', waitingNumber: 'A24', legalName: 'Riley Chen', dateOfBirth: '1966-12-01', language: 'zh', source: 'mobile', status: 'waiting_provider', waitMin: 51, nursePriority: 4, assessedAt: new Date(now - 30 * MIN).toISOString(),
      symptoms: { mainConcern: 'Cough', onset: 'three days ago', otherSymptoms: 'mild fever', painLevel: 2 } }),
    p({ id: 'seed-a28', waitingNumber: 'A28', legalName: 'Taylor Brooks', dateOfBirth: '1983-02-17', language: 'en', source: 'mobile', status: 'waiting_nurse', waitMin: 18,
      symptoms: { mainConcern: 'Back pain after lifting', onset: 'This afternoon', otherSymptoms: '', painLevel: 6 } }),
    p({ id: 'seed-a29', waitingNumber: 'A29', legalName: 'Casey Ahmed', dateOfBirth: '1999-10-25', language: 'ar', source: 'mobile', status: 'in_assessment', waitMin: 15,
      symptoms: { mainConcern: 'ألم في الأذن', onset: 'منذ يومين', otherSymptoms: '', painLevel: 4 } }),
    p({ id: 'seed-a12', waitingNumber: 'A12', legalName: 'Alex Kim', dateOfBirth: '1975-05-05', language: 'en', source: 'mobile', status: 'completed', waitMin: 180, nursePriority: 4, assessedAt: new Date(now - 160 * MIN).toISOString(),
      symptoms: { mainConcern: 'Sore throat', onset: 'Three days ago', otherSymptoms: '', painLevel: 2 } }),
  ];
}

// ---------- Store ----------

export function createStore({ now = () => Date.now(), seed = true, initialState = null } = {}) {
  let state =
    initialState ||
    {
      nextNumber: 34,
      patients: seed ? seedPatients(now()) : [],
      updatedAt: new Date(now()).toISOString(),
    };
  const listeners = new Set();

  function emit(type, patient) {
    state.updatedAt = new Date(now()).toISOString();
    const evt = { type, updatedAt: state.updatedAt, patientId: patient ? patient.id : null, waitingNumber: patient ? patient.waitingNumber : null };
    for (const fn of listeners) {
      try { fn(evt); } catch { /* ignore listener errors */ }
    }
  }

  function find(id) {
    const p = state.patients.find((x) => x.id === id);
    if (!p) throw new ApiError(404, 'not_found', 'Check-in not found');
    return p;
  }

  function requireToken(p, token) {
    if (!token || p.accessToken !== token) throw new ApiError(401, 'unauthorized', 'Invalid or missing patient token');
  }

  function nextNumber() {
    const n = state.nextNumber++;
    return `${CONFIG.numberPrefix}${String(n).padStart(2, '0')}`;
  }

  // Queue ordering used for both "people ahead" and estimates.
  function nurseQueue() {
    return state.patients
      .filter((p) => p.status === 'waiting_nurse')
      .sort((a, b) => (Number(b.symptomsChanged) - Number(a.symptomsChanged)) || (a.checkedInAt < b.checkedInAt ? -1 : 1));
  }
  function providerQueue() {
    return state.patients
      .filter((p) => p.status === 'waiting_provider')
      .sort((a, b) => {
        const pa = a.nursePriority || 5, pb = b.nursePriority || 5;
        if (pa !== pb) return pa - pb;
        return (a.assessedAt || a.checkedInAt) < (b.assessedAt || b.checkedInAt) ? -1 : 1;
      });
  }

  function lastContact(p) {
    return p.contacts.length ? p.contacts[p.contacts.length - 1] : null;
  }

  function followUpStatus(p) {
    if (p.source === 'mobile') return null; // mobile patients receive live updates
    if (!['waiting_nurse', 'waiting_provider', 'in_assessment'].includes(p.status)) return null;
    if (p.symptomsChanged) return 'symptoms_changed';
    const lastCheck = [...p.contacts].reverse().find((c) => c.kind === 'check_in');
    if (!lastCheck) return 'needs_follow_up';
    const age = (now() - Date.parse(lastCheck.at)) / MIN;
    return age >= CONFIG.recheckAfterMinutes ? 'recheck' : 'checked';
  }

  function computed(p) {
    const waitMinutes = Math.max(0, Math.floor((now() - Date.parse(p.checkedInAt)) / MIN));
    let peopleAhead = null;
    let estimatedWaitMinutes = null;
    if (p.status === 'waiting_nurse') {
      const i = nurseQueue().findIndex((x) => x.id === p.id);
      peopleAhead = i;
      estimatedWaitMinutes = roundTo5((i + 1) * CONFIG.nurseMinutesPerPatient);
    } else if (p.status === 'waiting_provider') {
      const i = providerQueue().findIndex((x) => x.id === p.id);
      peopleAhead = i;
      estimatedWaitMinutes = roundTo5(CONFIG.providerBaseMinutes + (i + 1) * CONFIG.providerMinutesPerPatient);
    }
    return { waitMinutes, peopleAhead, estimatedWaitMinutes };
  }

  function toStaff(p) {
    const { accessToken, ...rest } = p; // never expose patient tokens to staff clients
    void accessToken;
    return {
      ...rest,
      ...computed(p),
      lastContact: lastContact(p),
      followUpStatus: followUpStatus(p),
      hasLiveUpdates: p.source === 'mobile',
    };
  }

  function toPatientStatus(p) {
    const c = computed(p);
    return {
      id: p.id,
      waitingNumber: p.waitingNumber,
      status: p.status,
      language: p.language,
      peopleAhead: c.peopleAhead,
      estimatedWaitMinutes: c.estimatedWaitMinutes,
      insuranceMissing: !p.insurance,
      symptoms: p.symptoms,
      summary: p.summary,
      lastSymptomUpdateAt: p.symptomUpdates.length ? p.symptomUpdates[p.symptomUpdates.length - 1].at : null,
      updatedAt: state.updatedAt,
    };
  }

  function buildPatient(input, source) {
    const ts = new Date(now()).toISOString();
    const symptoms = cleanSymptoms(input.symptoms || {});
    const draft = draftSummary(symptoms, input.language);
    const summaryText = str(input.summary && input.summary.text, 1000) || draft;
    return {
      id: randomId(16),
      accessToken: source === 'mobile' ? randomId(32) : null,
      waitingNumber: nextNumber(),
      legalName: str(input.legalName, 120),
      dateOfBirth: str(input.dateOfBirth, 10),
      phone: str(input.phone, 30),
      insurance: str(input.insurance, 200),
      insuranceDeferred: !str(input.insurance) && !!input.insuranceDeferred,
      accessibilityNeeds: Array.isArray(input.accessibilityNeeds) ? input.accessibilityNeeds.map((x) => str(x, 60)).filter(Boolean).slice(0, 10) : [],
      language: str(input.language, 10) || 'en',
      source,
      status: 'waiting_nurse',
      symptoms,
      summary: {
        draft: str(input.summary && input.summary.draft, 1000) || draft,
        text: summaryText,
        editedByPatient: !!(input.summary && input.summary.editedByPatient),
      },
      siteCode: str(input.siteCode, 40) || null,
      checkInLocation: input.geo && Number.isFinite(input.geo.lat) ? { lat: input.geo.lat, lng: input.geo.lng, accuracy: input.geo.accuracy || null } : null,
      location: input.location && (input.location.zone || input.location.seat) ? { zone: str(input.location.zone, 30), seat: str(input.location.seat, 30) } : null,
      nursePriority: null,
      symptomsChanged: false,
      symptomUpdates: [],
      // Front desk / staff-assisted / walk-in registration counts as a staff contact; self-service (mobile, iPad) does not.
      contacts: source === 'mobile' || source === 'ipad' ? [] : [{ kind: 'registration', label: SOURCE_LABEL[source] || 'Staff', note: '', at: ts }],
      checkedInAt: ts,
      updatedAt: ts,
      assessedAt: null,
    };
  }

  const api = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { state = { nextNumber: 34, patients: seedPatients(now()), updatedAt: new Date(now()).toISOString() }; emit('reset', null); },

    draftSummary(body) {
      const fields = validateSymptoms(body && body.symptoms);
      if (Object.keys(fields).length) throw new ApiError(422, 'validation_error', 'Symptoms are incomplete', fields);
      return { draft: draftSummary(body.symptoms, body.language || 'en'), generatedBy: 'mock-template', isDraft: true };
    },

    // ----- patient (mobile) -----
    createCheckIn(input) {
      const fields = { ...validateIdentity(input || {}, now()), ...validateSymptoms(input && input.symptoms) };
      if (Object.keys(fields).length) throw new ApiError(422, 'validation_error', 'Check-in is incomplete', fields);
      const p = buildPatient(input, 'mobile');
      state.patients.push(p);
      emit('checkin.created', p);
      return { id: p.id, accessToken: p.accessToken, waitingNumber: p.waitingNumber, status: toPatientStatus(p) };
    },
    getPatientStatus(id, token) {
      const p = find(id); requireToken(p, token);
      return toPatientStatus(p);
    },
    updateSymptoms(id, token, body) {
      const p = find(id); requireToken(p, token);
      if (['completed', 'left'].includes(p.status)) throw new ApiError(409, 'closed', 'This check-in is closed');
      const fields = validateSymptoms(body && body.symptoms);
      if (Object.keys(fields).length) throw new ApiError(422, 'validation_error', 'Symptoms are incomplete', fields);
      const symptoms = cleanSymptoms(body.symptoms);
      const at = new Date(now()).toISOString();
      p.symptomUpdates.push({ at, by: 'patient', previous: p.symptoms, symptoms, note: str(body.note, 500) });
      p.symptoms = symptoms;
      const draft = draftSummary(symptoms, p.language);
      p.summary = { draft, text: str(body.summary && body.summary.text, 1000) || draft, editedByPatient: !!(body.summary && body.summary.editedByPatient) };
      p.symptomsChanged = true;
      p.updatedAt = at;
      emit('patient.symptoms_changed', p);
      return toPatientStatus(p);
    },
    updateInsurance(id, token, body) {
      const p = find(id); requireToken(p, token);
      const ins = str(body && body.insurance, 200);
      if (!ins) throw new ApiError(422, 'validation_error', 'Insurance is required', { insurance: 'required' });
      p.insurance = ins; p.insuranceDeferred = false; p.updatedAt = new Date(now()).toISOString();
      emit('patient.updated', p);
      return toPatientStatus(p);
    },
    reportLocationExit(id, token, body) {
      const p = find(id); requireToken(p, token);
      const at = new Date(now()).toISOString();
      if (body && body.left === true) {
        if (!['completed', 'left'].includes(p.status)) p.statusBeforeLeft = p.status;
        p.status = 'left';
        p.contacts.push({ kind: 'location_exit', label: 'Patient (phone)', note: 'Confirmed leaving the emergency department', at });
      } else {
        p.contacts.push({ kind: 'location_check', label: 'Patient (phone)', note: 'Confirmed still in waiting area', at });
      }
      p.updatedAt = at;
      emit('patient.location_exit', p);
      return toPatientStatus(p);
    },

    // ----- staff -----
    listPatients() {
      return { patients: state.patients.map(toStaff), updatedAt: state.updatedAt, config: CONFIG };
    },
    createStaffPatient(input) {
      const source = SOURCES.includes(input && input.source) && input.source !== 'mobile' ? input.source : 'front_desk';
      const fields = { ...validateIdentity(input || {}, now(), { requireInsurance: false }) };
      if (!str(input && input.symptoms && input.symptoms.mainConcern)) fields.mainConcern = 'required';
      if (Object.keys(fields).length) throw new ApiError(422, 'validation_error', 'Patient details are incomplete', fields);
      const sym = input.symptoms || {};
      const pain = sym.painLevel === '' || sym.painLevel === null || sym.painLevel === undefined ? null : Number(sym.painLevel);
      if (pain !== null && !(Number.isInteger(pain) && pain >= 0 && pain <= 10)) throw new ApiError(422, 'validation_error', 'Pain must be 0–10', { painLevel: 'invalid' });
      const p = buildPatient({ ...input, symptoms: { ...sym, onset: sym.onset || 'Not recorded', painLevel: pain } }, source);
      state.patients.push(p);
      emit('checkin.created', p);
      return toStaff(p);
    },
    updatePatient(id, patch, actor = 'Nurse') {
      const p = find(id);
      const at = new Date(now()).toISOString();
      if (patch.nursePriority !== undefined) {
        const v = patch.nursePriority === null ? null : Number(patch.nursePriority);
        if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 5)) throw new ApiError(422, 'validation_error', 'Priority must be 1–5', { nursePriority: 'invalid' });
        p.nursePriority = v;
      }
      if (patch.location !== undefined) {
        p.location = patch.location ? { zone: str(patch.location.zone, 30), seat: str(patch.location.seat, 30) } : null;
      }
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw new ApiError(422, 'validation_error', 'Unknown status', { status: 'invalid' });
        if (patch.status === 'waiting_provider' && !p.nursePriority && patch.nursePriority == null) {
          throw new ApiError(422, 'validation_error', 'Set a nurse triage priority before completing the assessment', { nursePriority: 'required' });
        }
        if (patch.status === 'waiting_provider' && p.status !== 'waiting_provider') p.assessedAt = at;
        if (patch.status === 'in_assessment' || patch.status === 'waiting_provider') p.symptomsChanged = false;
        p.status = patch.status;
        p.contacts.push({ kind: 'status', label: actor, note: `Status → ${patch.status}`, at });
      }
      if (patch.acknowledgeSymptomChange) p.symptomsChanged = false;
      p.updatedAt = at;
      emit('patient.updated', p);
      return toStaff(p);
    },
    recordContact(id, body, actor = 'Nurse') {
      const p = find(id);
      const at = new Date(now()).toISOString();
      const kind = body && body.kind;
      if (kind === 'check_in') {
        p.contacts.push({ kind: 'check_in', label: actor, note: str(body.note, 500), at, checklist: Array.isArray(body.checklist) ? body.checklist.slice(0, 10) : undefined });
        if (body.notPresent) {
          p.statusBeforeLeft = p.status;
          p.status = 'left';
        }
      } else if (kind === 'symptoms_changed') {
        const note = str(body.note, 500);
        if (!note) throw new ApiError(422, 'validation_error', 'Describe what changed', { note: 'required' });
        p.contacts.push({ kind: 'symptoms_changed', label: actor, note, at });
        p.symptomUpdates.push({ at, by: 'staff', previous: p.symptoms, symptoms: p.symptoms, note });
        p.symptomsChanged = true;
      } else {
        throw new ApiError(422, 'validation_error', 'Unknown contact kind', { kind: 'invalid' });
      }
      p.updatedAt = at;
      emit(kind === 'symptoms_changed' ? 'patient.symptoms_changed' : 'patient.updated', p);
      return toStaff(p);
    },

    // ----- public display (no PHI) -----
    publicQueue() {
      const prov = providerQueue();
      return {
        updatedAt: state.updatedAt,
        providerQueue: prov.map((p, i) => ({
          waitingNumber: p.waitingNumber,
          estimatedWaitMinutes: roundTo5(CONFIG.providerBaseMinutes + (i + 1) * CONFIG.providerMinutesPerPatient),
        })),
        nowSeeing: state.patients
          .filter((p) => p.status === 'with_care_team')
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .map((p) => ({ waitingNumber: p.waitingNumber })),
        awaitingNurse: nurseQueue().map((p) => ({ waitingNumber: p.waitingNumber })),
        inAssessment: state.patients.filter((p) => p.status === 'in_assessment').map((p) => ({ waitingNumber: p.waitingNumber })),
      };
    },
  };
  return api;
}

export const SOURCE_LABEL = {
  mobile: 'Mobile check-in',
  ipad: 'iPad check-in',
  front_desk: 'Front desk',
  staff_assisted: 'Staff-assisted',
  walk_in: 'Walk-in registration',
};
