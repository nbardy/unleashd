import type { ConversationRow } from '@unleashd/shared';
import { atom } from 'jotai';
import { listField, rowFamily } from '../atoms/conversations';

export const NO_WORKERS: readonly ConversationRow[] = [];

/**
 * Swarm worker rows grouped by PROJECT root, promoted workers excluded. The
 * grouping itself is the list index's `workersByProject` field (one pass, in
 * core); this joins its ids with the per-id rows, so it recomputes only when
 * the grouping moves or a worker's own row changes. Every swarm view, desktop
 * and mobile, reads this one atom (`.get(root) ?? NO_WORKERS` for one project).
 */
export const swarmWorkersByProjectAtom = atom((get) => {
  const groups = new Map<string, readonly ConversationRow[]>();
  for (const [root, ids] of get(listField('workersByProject'))) {
    groups.set(
      root,
      ids.flatMap((id) => get(rowFamily(id)) ?? [])
    );
  }
  return groups as ReadonlyMap<string, readonly ConversationRow[]>;
});
