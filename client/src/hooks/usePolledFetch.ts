import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { conversationLoadCompleteAtom, wsStatusAtom } from '../atoms/conversations';

export interface UsePolledFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * A poll source is either a plain URL (the common case — one GET per cycle)
 * or a fetcher function for callers that need to issue multiple requests per
 * cycle (e.g. one fetch per project root) and merge them into a single T.
 * The fetcher receives this cycle's AbortSignal so it can thread it through
 * to every underlying fetch call; an AbortError it throws/rejects with is
 * treated the same as the built-in fetch path's abort (silently dropped).
 */
export type PolledSource<T> = string | ((signal: AbortSignal) => Promise<T>);

/**
 * Generic polling helper for live swarm / catalog data.
 *
 * Provides the polling primitive for mobile (SwarmsMobile, SwarmDetailMobile, SearchMobile)
 * and desktop (useSwarmRuntimeSnapshots, useSwarmProjects — both migrated onto this
 * helper). Adds the two mobile-critical behaviors hand-rolled setInterval hooks lacked:
 *   1) pause/resume on document.visibilitychange (backgrounded PWA)
 *   2) immediate refetch on WS reconnect (post-drain, after init snapshot)
 *
 * NOT tanstack-query — just useEffect + setInterval + visibilitychange (PLANNING §7 #8).
 *
 * @param source - fetch URL, a fetcher function for multi-request cycles, or null to disable
 * @param intervalMs - polling interval in ms. 0 means fetch once per source change
 *   and never poll. Use 0 for one-shot loads so they inherit the abort-on-change
 *   guarantee: a bare `useEffect(() => fetch(url).then(setState), [key])` has no
 *   such guard, so when the key changes quickly the SLOWEST response wins, not
 *   the latest — SwarmDetail's git-log / config / runs panels and SwarmAnalytics
 *   all showed the previous project's data after a fast switch (2026-09-06).
 * @param enabled - when false, no fetch and no interval (default true)
 */
export function usePolledFetch<T>(
  source: PolledSource<T> | null,
  intervalMs: number,
  enabled = true
): UsePolledFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled && source !== null);
  const [error, setError] = useState<Error | null>(null);

  const wsStatus = useAtomValue(wsStatusAtom);
  const loadComplete = useAtomValue(conversationLoadCompleteAtom);

  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<number | null>(null);
  const sourceRef = useRef<PolledSource<T> | null>(source);
  sourceRef.current = source;

  const fetchData = useCallback(async () => {
    const currentSource = sourceRef.current;
    if (!enabled || !currentSource) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const json =
        typeof currentSource === 'function'
          ? await currentSource(controller.signal)
          : await fetch(currentSource, { signal: controller.signal }).then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.json() as Promise<T>;
            });
      if (controller.signal.aborted) return;
      setData(json);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e as Error);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled]);

  // Initial fetch + interval + visibilitychange pause/resume
  useEffect(() => {
    if (!enabled || !source) {
      setLoading(false);
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    void fetchData();

    const startInterval = () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      if (intervalMs <= 0) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      intervalRef.current = window.setInterval(() => void fetchData(), intervalMs);
    };

    startInterval();

    const onVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        void fetchData();
        startInterval();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [source, intervalMs, enabled, fetchData]);

  // Immediate refetch on WS reconnect (post-drain)
  const prevWsRef = useRef(wsStatus);
  useEffect(() => {
    const wasConnected = prevWsRef.current === 'connected';
    const nowConnected = wsStatus === 'connected';
    prevWsRef.current = wsStatus;
    if (!wasConnected && nowConnected && loadComplete) {
      void fetchData();
    }
  }, [wsStatus, loadComplete, fetchData]);

  const refetch = useCallback(() => void fetchData(), [fetchData]);

  return { data, loading, error, refetch };
}
