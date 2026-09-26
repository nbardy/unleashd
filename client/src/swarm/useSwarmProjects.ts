import { usePolledFetch } from '../hooks/usePolledFetch';
import type { SwarmProjectEntry } from './swarm-groups';

const EMPTY_PROJECTS: SwarmProjectEntry[] = [];

/**
 * Projects that have oompa runs/ directories on disk, whatever the worker
 * harness (gemini, codex, claude), read from oompa's own run data.
 *
 * A failed refresh keeps the last-known list on screen: that is the resource
 * cache's `stale` variant, not a fallback here.
 */
export function useSwarmProjects(pollMs = 15_000): SwarmProjectEntry[] {
  const { data } = usePolledFetch<{ projects: SwarmProjectEntry[] }>('/api/swarm-projects', pollMs);
  return data?.projects ?? EMPTY_PROJECTS;
}
