// HTTP adapter — talks to API_BASE_URL using the contract in API_CONTRACT.md.
// This is the ONLY file that knows about URLs, headers and transport.
// To connect a real backend, change endpoint paths/mappers here if they differ.
import {
  ApiRequestError,
  type ChangeEvent,
  type Channel,
  type ConnectionState,
  type SeenSoonerApi,
} from './types';

const POLL_FALLBACK_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

export function createHttpApi(baseUrl: string, opts: { staffName?: string; staffToken?: string } = {}): SeenSoonerApi {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (opts.staffToken && path.startsWith('/api/staff')) headers.Authorization = `Bearer ${opts.staffToken}`;
    if (opts.staffName && path.startsWith('/api/staff')) headers['X-Staff-Name'] = opts.staffName;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch {
      throw new ApiRequestError(0, 'network_error', 'Could not reach the server');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
      throw new ApiRequestError(res.status, err?.code || 'http_error', err?.message || `Request failed (${res.status})`, err?.fields);
    }
    return json as T;
  }

  function subscribe(
    channel: Channel,
    sOpts: { checkinId?: string; token?: string },
    onChange: (e: ChangeEvent) => void,
    onConnection: (s: ConnectionState) => void,
  ) {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    const params = new URLSearchParams({ channel });
    if (sOpts.checkinId) params.set('checkinId', sOpts.checkinId);
    if (sOpts.token) params.set('token', sOpts.token);
    if (channel === 'staff' && opts.staffToken) params.set('token', opts.staffToken);
    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => onChange({ type: 'poll', updatedAt: new Date().toISOString() }), POLL_FALLBACK_MS);
    };
    const stopPolling = () => { if (poll) { clearInterval(poll); poll = null; } };
    onConnection('connecting');
    if (typeof EventSource === 'undefined') {
      onConnection('live');
      startPolling();
    } else {
      es = new EventSource(`${base}/api/events?${params.toString()}`);
      es.addEventListener('ready', () => {
        if (closed) return;
        stopPolling();
        onConnection('live');
        onChange({ type: 'resync', updatedAt: new Date().toISOString() }); // refetch after (re)connect
      });
      es.addEventListener('change', (ev) => {
        try { onChange(JSON.parse((ev as MessageEvent).data)); } catch { onChange({ type: 'change', updatedAt: new Date().toISOString() }); }
      });
      es.onerror = () => {
        if (closed || !es) return;
        // EventSource retries on its own; meanwhile poll so data keeps flowing if SSE is blocked by a proxy.
        onConnection(es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
        startPolling();
      };
    }
    const onOnline = () => onConnection('reconnecting');
    const onOffline = () => onConnection('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      closed = true;
      es?.close();
      stopPolling();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }

  const enc = encodeURIComponent;
  return {
    mode: 'http',
    baseUrl: base,
    draftSummary: (symptoms, language) => request('POST', '/api/summaries/draft', { symptoms, language }),
    createCheckIn: (req) => request('POST', '/api/checkins', req),
    getCheckIn: (id, token) => request('GET', `/api/checkins/${enc(id)}`, undefined, token),
    updateSymptoms: (id, token, body) => request('PATCH', `/api/checkins/${enc(id)}/symptoms`, body, token),
    updateInsurance: (id, token, insurance) => request('PATCH', `/api/checkins/${enc(id)}/insurance`, { insurance }, token),
    reportLocationExit: (id, token, left, via) => request('POST', `/api/checkins/${enc(id)}/location-exit`, { left, via }, token),
    kioskLookup: (waitingNumber, dateOfBirth) => request('POST', '/api/kiosk/lookup', { waitingNumber, dateOfBirth }),
    kioskRequest: (req) => request('POST', '/api/kiosk/request', req),
    listPatients: () => request('GET', '/api/staff/patients'),
    createStaffPatient: (req) => request('POST', '/api/staff/patients', req),
    updatePatient: (id, patch) => request('PATCH', `/api/staff/patients/${enc(id)}`, patch),
    recordContact: (id, body) => request('POST', `/api/staff/patients/${enc(id)}/contacts`, body),
    getPublicQueue: () => request('GET', '/api/public/queue'),
    subscribe,
  };
}
