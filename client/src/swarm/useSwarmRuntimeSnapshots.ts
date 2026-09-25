import type { OompaRuntimeSnapshot } from '@unleashd/shared';
import { useMemo } from 'react';
import { resource, usePolledFetch } from '../hooks/usePolledFetch';

interface UseSwarmRuntimeSnapshotsOptions {
  pollMs?: number;
  enabled?: boolean;
}

const EMPTY_SNAPSHOTS: Record<string, OompaRuntimeSnapshot> = {};

const makeUnavailable = (reason: string): OompaRuntimeSnapshot => ({
  available: false,
  run: null,
  reason,
});

export function useSwarmRuntimeSnapshots(
  projectRoots: string[],
  options: UseSwarmRuntimeSnapshotsOptions = {}
): Record<string, OompaRuntimeSnapshot> {
  const { pollMs = 10_000, enabled = true } = options;
  const normalizedProjectRoots = useMemo(
    () => Array.from(new Set(projectRoots)).sort(),
    [projectRoots]
  );
  const hasRoots = normalizedProjectRoots.length > 0;

  // Multi-request resource: one /api/swarm-runtime per project root, merged
  // into a single Record. The root set is the cache key, so a snapshot read
  // back here always belongs to the roots currently being asked about — the
  // mirror-into-local-state this hook used to keep, purely to force `{}` when
  // the roots changed or the hook was disabled, is now the cache's `idle`
  // variant. The shared AbortSignal is still threaded to every inner fetch.
  const source = useMemo(
    () =>
      resource(
        `swarm-runtime:${normalizedProjectRoots.join('|')}`,
        async (signal: AbortSignal): Promise<Record<string, OompaRuntimeSnapshot>> => {
          const entries = await Promise.all(
            normalizedProjectRoots.map(async (projectRoot) => {
              // Server requires an absolute path. Skip relative paths (e.g. Gemini
              // sessions whose .project_root file is missing — workingDirectory
              // falls back to a directory basename, not an absolute path).
              if (!projectRoot.startsWith('/')) {
                return { projectRoot, snapshot: makeUnavailable('No project root available') };
              }
              try {
                const response = await fetch(
                  `/api/swarm-runtime?dir=${encodeURIComponent(projectRoot)}`,
                  { signal }
                );
                if (!response.ok) {
                  return { projectRoot, snapshot: makeUnavailable(`HTTP ${response.status}`) };
                }
                const snapshot = (await response.json()) as OompaRuntimeSnapshot;
                return { projectRoot, snapshot };
              } catch (e) {
                // An aborted cycle must fail the whole request rather than
                // report a spurious per-root failure for something we cancelled.
                if (signal.aborted) throw e;
                return {
                  projectRoot,
                  snapshot: makeUnavailable('Failed to load runtime snapshot'),
                };
              }
            })
          );
          const next: Record<string, OompaRuntimeSnapshot> = {};
          for (const entry of entries) next[entry.projectRoot] = entry.snapshot;
          return next;
        }
      ),
    [normalizedProjectRoots]
  );

  const { data } = usePolledFetch<Record<string, OompaRuntimeSnapshot>>(
    enabled && hasRoots ? source : null,
    pollMs,
    enabled
  );

  return data ?? EMPTY_SNAPSHOTS;
}
