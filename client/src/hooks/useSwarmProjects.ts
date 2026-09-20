import type { OompaRuntimeSnapshot } from '@unleashd/shared';
import { usePolledFetch } from './usePolledFetch';

export interface SwarmProjectEntry {
  projectRoot: string;
  projectName: string;
  runtime: OompaRuntimeSnapshot;
}

const EMPTY_PROJECTS: SwarmProjectEntry[] = [];

/**
 * Fetches projects that have oompa runs/ directories on disk.
 * This discovers swarms regardless of worker harness (gemini, codex, claude, etc.)
 * by reading oompa's own event-sourced run data directly.
 *
 * Keyed on the plain URL, so this shares one cache entry — and one request —
 * with SwarmsMobile's identical call. Desktop and mobile see the same store.
 *
 * A failed refresh keeps the last-known list on screen: that is the resource
 * cache's `stale` variant, not a fallback here. The hand-rolled `prevProjectsRef`
 * this used to carry only existed because the previous hook could not express
 * "the request failed but I still hold a value".
 */
export function useSwarmProjects(pollMs = 15_000): SwarmProjectEntry[] {
  const { data } = usePolledFetch<{ projects: SwarmProjectEntry[] }>('/api/swarm-projects', pollMs);
  return data?.projects ?? EMPTY_PROJECTS;
}
