import {
  BuddySoulConflictDetailsSchema,
  BuddySoulSchema,
  BuddySoulUpdateSchema,
} from '@unleashd/shared';
import { buddySoulRelativePath } from './builder';
import { type BuddiesStorePort, BuddyMemoryOperationError } from './contract';

export function readBuddySoul(store: BuddiesStorePort, buddyId: string) {
  if (!store.readBuddySoul || !store.updateSoul) {
    throw new Error('The installed Buddies package does not support versioned soul editing');
  }
  return BuddySoulSchema.parse(store.readBuddySoul(buddyId));
}

/** Owner-directed edits share one CAS path across HTTP, Builder and Buddy chat. */
export function updateBuddySoul(
  store: BuddiesStorePort,
  buddyId: string,
  input: unknown,
  requestedBy: string,
  provenance: Record<string, unknown>
) {
  const parsed = BuddySoulUpdateSchema.parse(input);
  const buddy = store.getBuddy(buddyId);
  if (!buddy) throw new Error('Buddy not found');
  const head = readBuddySoul(store, buddyId);
  const conflict = (current: typeof head) =>
    new BuddyMemoryOperationError(
      'MEMORY_STALE',
      'Soul changed since you read it. Reconcile your draft with current_content, then retry against current_version.',
      BuddySoulConflictDetailsSchema.parse({
        document_kind: 'soul',
        current_version: current.revision,
        supplied_base: parsed.baseVersion,
        current_content: current.body,
      })
    );
  if (head.revision !== parsed.baseVersion) throw conflict(head);
  if (!buddy.soul_path) {
    // Set only the pointer. The store materializes the file AFTER committing
    // the revision; a stale write must never replace the on-disk projection.
    store.updateBuddy(buddyId, { soulPath: buddySoulRelativePath(buddy.slug) });
  }
  try {
    return store.updateSoul!(buddyId, { ...parsed, requestedBy, provenance });
  } catch (error) {
    if ((error as { code?: string }).code === 'STALE_MEMORY_WRITE') {
      throw conflict(readBuddySoul(store, buddyId));
    }
    throw error;
  }
}
