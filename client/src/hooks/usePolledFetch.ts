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

/**
 * What a polled view renders from: the cache variant itself, with the value
 * it holds surfaced as `data` on every variant (null where none is held).
 *
 * A sum, not the `{data, loading, error}` this hook returned until 2026-09-25.
 * That product put a first load that failed and a background refresh that
 * failed into the same `error` field, so a view that tested `error` before
 * `data` swapped a page it was already showing for its full-screen failure:
 * on a slow server one "Failed to fetch" replaced a loaded Buddy page on the
 * phone with "Could not load buddy" (2026-09-24), and the Buddies directory,
 * team settings and swarm reviews blanked the same way. Here the two are
 * different variants, and `error` exists only on them, so reading it means
 * saying which one you mean:
 *
 *   failed — nothing to show; the error IS the view.
 *   stale  — `data` is still the view; the error is a notice beside it.
 */
export type PolledState<T> =
  | { kind: 'idle'; data: null }
  | { kind: 'loading'; data: null }
  | { kind: 'ready'; data: T }
  | { kind: 'failed'; data: null; error: Error }
  | { kind: 'stale'; data: T; error: Error };

export type UsePolledFetchResult<T> = PolledState<T> & { refetch: () => Promise<void> };

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
 * Read a server resource into the shared keyed cache (`atoms/resources.ts`).
 *
 * This hook owns no data. It subscribes to one cache key, asks for a refresh
 * when appropriate, and hands back the cache variant as a {@link PolledState}.
 * Consequences worth knowing:
 *
 *   - Remount on a cached key renders instantly and revalidates behind the
 *     scenes. `loading` is the variant only when there is genuinely nothing
 *     to show, so navigating back to a page no longer flashes a spinner.
 *   - A failed refresh never takes data away: it is `stale`, which still
 *     carries `data`. Render the page from `data` and the failure as a notice.
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
