import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { conversationLoadCompleteAtom, wsStatusAtom } from '../atoms/conversations';
import {
  IDLE_ENTRY,
  type Resource,
  type ResourceEntry,
  loadResource,
  resourceAtomFamily,
  retainResourceKey,
} from '../atoms/resources';

export interface UsePolledFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * A poll source is either a plain URL (the common case — one GET per cycle) or
 * a {@link Resource} for callers that issue multiple requests per cycle (e.g.
 * one fetch per project root) and merge them into a single T.
 *
 * A bare fetcher function is deliberately NOT accepted: without a key there is
 * no identity to cache under, and the un-keyed form is what forced call sites
 * to hand-roll "is this response for what I'm showing?" guards. Wrap one with
 * {@link resource} and give it a key derived from its inputs.
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

/** Thin dispatcher: one cache variant in, one view out, no work in any arm. */
function viewOf<T>(entry: ResourceEntry<T>): Omit<UsePolledFetchResult<T>, 'refetch'> {
  switch (entry.kind) {
    case 'idle':
      return { data: null, loading: false, error: null };
    case 'loading':
      return { data: null, loading: true, error: null };
    case 'ready':
      return { data: entry.value, loading: false, error: null };
    case 'failed':
      return { data: null, loading: false, error: entry.error };
    case 'stale':
      return { data: entry.value, loading: false, error: entry.error };
  }
}

/**
 * Read a server resource into the shared keyed cache (`atoms/resources.ts`).
 *
 * This hook owns no data. It subscribes to one cache key, asks for a refresh
 * when appropriate, and maps the cache variant onto the `{data, loading,
 * error}` shape call sites already use. Consequences worth knowing:
 *
 *   - Remount on a cached key renders instantly and revalidates behind the
 *     scenes. `loading` is true only when there is genuinely nothing to show,
 *     so navigating back to a page no longer flashes a spinner.
 *   - Two components on the same key share one request and one entry.
 *   - Stale-response races are structurally impossible. The old hook needed
 *     abort-on-source-change so the SLOWEST response could not win; a keyed
 *     cache is stronger — a late response lands on its own key, which whoever
 *     switched away is no longer reading. In-flight requests are therefore
 *     allowed to finish and populate the cache (that is prefetch).
 *   - The effect keys on the resource KEY, not on the source object's
 *     identity, so an unstable inline fetcher no longer refetches every render.
 *
 * Retained from the pre-cache hook: pause/resume on `visibilitychange` for a
 * backgrounded PWA, and an immediate refresh on WS reconnect once the init
 * snapshot has landed.
 *
 * NOT tanstack-query — one Map in a jotai atom plus setInterval.
 *
 * @param source - fetch URL, a keyed {@link Resource}, or null to disable
 * @param intervalMs - polling interval in ms. 0 fetches on key change only.
 * @param enabled - when false, no fetch and no interval (default true)
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
  const wsStatus = useAtomValue(wsStatusAtom);
  const loadComplete = useAtomValue(conversationLoadCompleteAtom);

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
    const wasConnected = prevWsRef.current === 'connected';
    prevWsRef.current = wsStatus;
    if (!wasConnected && wsStatus === 'connected' && loadComplete) void refresh();
  }, [wsStatus, loadComplete, refresh]);

  const entry = key ? cached : (IDLE_ENTRY as ResourceEntry<T>);
  return { ...viewOf(entry), refetch: refresh };
}
