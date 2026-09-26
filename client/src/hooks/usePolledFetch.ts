import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { connectionAtom, loadCompleteOf } from '../atoms/conversations';
import {
  IDLE_ENTRY,
  type Resource,
  type ResourceEntry,
  loadResource,
  resourceAtomFamily,
  retainResourceKey,
} from '../atoms/resources';

/**
 * The cache variant, with `data` on every variant. `failed`: the error IS the view; `stale`: `data`
 * is the view and the error a notice beside it. See docs/client-rationale.md#polled-state.
 */
export type PolledState<T> =
  | { kind: 'idle'; data: null }
  | { kind: 'loading'; data: null }
  | { kind: 'ready'; data: T }
  | { kind: 'failed'; data: null; error: Error }
  | { kind: 'stale'; data: T; error: Error };

export type UsePolledFetchResult<T> = PolledState<T> & { refetch: () => Promise<void> };

/**
 * A URL or a keyed Resource. A bare fetcher is rejected: no key, nothing to cache under. See
 * docs/client-rationale.md#polled-source.
 */
export type PolledSource<T> = string | Resource<T>;

/** Build a keyed Resource from a multi-request fetcher. */
export const resource = <T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>
): Resource<T> => ({ key, load });

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** κ — the single point where a loose call-site form becomes canonical. */
const toResource = <T>(source: PolledSource<T>): Resource<T> =>
  typeof source === 'string'
    ? { key: source, load: (signal) => fetchJson<T>(source, signal) }
    : source;

/** Thin dispatcher: one cache variant in, the same variant out, no work in any arm. */
function viewOf<T>(entry: ResourceEntry<T>): PolledState<T> {
  switch (entry.kind) {
    case 'idle':
      return { kind: 'idle', data: null };
    case 'loading':
      return { kind: 'loading', data: null };
    case 'ready':
      return { kind: 'ready', data: entry.value };
    case 'failed':
      return { kind: 'failed', data: null, error: entry.error };
    case 'stale':
      return { kind: 'stale', data: entry.value, error: entry.error };
  }
}

/**
 * Read a server resource into the keyed cache (atoms/resources.ts); owns no data. Remount renders
 * cached data and revalidates; a failed refresh is `stale`, never a blank page. `intervalMs` 0
 * fetches on key change only. See docs/client-rationale.md#polled-fetch.
 */
export function usePolledFetch<T>(
  source: PolledSource<T> | null,
  intervalMs: number,
  enabled = true
): UsePolledFetchResult<T> {
  const active = enabled && source !== null;
  const key = active ? (typeof source === 'string' ? source : source.key) : '';

  // Held in a ref so a caller rebuilding its Resource every render cannot
  // retrigger the effect below; only a changed key can. Null when disabled, so
  // neither the WS-reconnect refresh nor a caller's `refetch()` can load a
  // resource the component asked not to load.
  const sourceRef = useRef<PolledSource<T> | null>(active ? source : null);
  sourceRef.current = active ? source : null;

  const cached = useAtomValue(resourceAtomFamily(key)) as ResourceEntry<T>;
  const connection = useAtomValue(connectionAtom);
  const wsStatus = connection.socket.tag;
  const loadComplete = loadCompleteOf(connection.server);

  const refresh = useCallback((): Promise<void> => {
    const current = sourceRef.current;
    if (!current) return Promise.resolve();
    return loadResource(toResource(current));
  }, []);

  // Retain + initial load + interval + visibilitychange pause/resume.
  useEffect(() => {
    if (!key) return;
    const release = retainResourceKey(key);
    void refresh();

    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      if (intervalMs <= 0) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      timer = window.setInterval(() => void refresh(), intervalMs);
    };
    start();

    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      void refresh();
      start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
      release();
    };
  }, [key, intervalMs, refresh]);

  // Immediate refresh on WS reconnect (post-drain).
  const prevWsRef = useRef(wsStatus);
  useEffect(() => {
    const wasConnected = prevWsRef.current === 'open';
    prevWsRef.current = wsStatus;
    if (!wasConnected && wsStatus === 'open' && loadComplete) void refresh();
  }, [wsStatus, loadComplete, refresh]);

  const entry = key ? cached : (IDLE_ENTRY as ResourceEntry<T>);
  return { ...viewOf(entry), refetch: refresh };
}
