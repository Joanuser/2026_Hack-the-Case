import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './index';
import { ApiRequestError, type ChangeEvent, type Channel, type ConnectionState } from './types';

export interface LiveResult<T> {
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  connection: ConnectionState;
  lastSyncedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches data and keeps it fresh: refetches on every realtime change event,
 * on reconnect, and (while the stream is down) on a polling fallback.
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  channel: Channel,
  opts: { checkinId?: string; token?: string; enabled?: boolean; onEvent?: (e: ChangeEvent) => void } = {},
): LiveResult<T> {
  const { checkinId, token, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return inflight.current; }
    const run = (async () => {
      try {
        const d = await fetcherRef.current();
        setData(d);
        setError(null);
        setLastSyncedAt(Date.now());
      } catch (e) {
        setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'unknown', String(e)));
      } finally {
        setLoading(false);
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    if (again.current) { again.current = false; await refresh(); }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void refresh();
    const unsub = api.subscribe(
      channel,
      { checkinId, token },
      (e) => { onEventRef.current?.(e); void refresh(); },
      (s) => setConnection(s),
    );
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { unsub(); document.removeEventListener('visibilitychange', onVisible); };
  }, [channel, checkinId, token, enabled, refresh]);

  return { data, error, loading, connection, lastSyncedAt, refresh };
}
