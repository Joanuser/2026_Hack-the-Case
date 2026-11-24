// In-browser mock adapter (VITE_API_MODE=memory).
// Runs the same mock store as mock-server/ inside the page, persisted to localStorage
// and synced between tabs of the SAME origin with BroadcastChannel.
// Use it to demo one app on its own (e.g. a static preview deploy). For the
// cross-app end-to-end demo, run the mock server and use VITE_API_MODE=http.
import { createStore, ApiError } from '../../mock-server/store.mjs';
import { ApiRequestError, type ChangeEvent, type SeenSoonerApi } from './types';

const KEY = 'seensooner.mockstore.v1';
const LATENCY = 200;

type Store = ReturnType<typeof createStore>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return createStore({ initialState: JSON.parse(raw) });
  } catch { /* ignore */ }
  return createStore();
}

export function createMemoryApi(): SeenSoonerApi {
  let store: Store = load();
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(KEY) : null;
  const local = new Set<(e: ChangeEvent) => void>();

  const wire = () =>
    store.subscribe((evt: ChangeEvent) => {
      try { localStorage.setItem(KEY, JSON.stringify(store.getState())); } catch { /* quota */ }
      bc?.postMessage(evt);
      local.forEach((fn) => fn(evt));
    });
  wire();
  bc?.addEventListener('message', (m) => {
    store = load();
    wire();
    local.forEach((fn) => fn(m.data as ChangeEvent));
  });

  async function run<T>(fn: () => T): Promise<T> {
    await new Promise((r) => setTimeout(r, LATENCY));
    try {
      return structuredClone(fn());
    } catch (e) {
      if (e instanceof ApiError) {
        const ae = e as unknown as { status: number; code: string; message: string; fields?: Record<string, string> };
        throw new ApiRequestError(ae.status, ae.code, ae.message, ae.fields);
      }
      throw e;
    }
  }

  return {
    mode: 'memory',
    baseUrl: 'in-browser mock',
    draftSummary: (symptoms, language) => run(() => store.draftSummary({ symptoms, language })),
    createCheckIn: (req) => run(() => store.createCheckIn(req)),
    getCheckIn: (id, token) => run(() => store.getPatientStatus(id, token)),
    updateSymptoms: (id, token, body) => run(() => store.updateSymptoms(id, token, body)),
    updateInsurance: (id, token, insurance) => run(() => store.updateInsurance(id, token, { insurance })),
    reportLocationExit: (id, token, left) => run(() => store.reportLocationExit(id, token, { left })),
    listPatients: () => run(() => store.listPatients()),
    createStaffPatient: (req) => run(() => store.createStaffPatient(req)),
    updatePatient: (id, patch) => run(() => store.updatePatient(id, patch)),
    recordContact: (id, body) => run(() => store.recordContact(id, body)),
    getPublicQueue: () => run(() => store.publicQueue()),
    subscribe(_channel, _opts, onChange, onConnection) {
      const fn = (e: ChangeEvent) => onChange(e);
      local.add(fn);
      setTimeout(() => onConnection('live'), 0);
      return () => { local.delete(fn); };
    },
  };
}
