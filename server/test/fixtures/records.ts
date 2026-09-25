import {
  type ConversationRecord,
  ConversationRecordStore,
  openRecords,
  recordsLocation,
} from '../../src/conversations/config-records';

/**
 * A real records store (the Rust addon) under `root`, opened through the same
 * boot path as the server. Reopening the same root is a restart.
 */
export function recordStore(root: string, now?: () => Date): ConversationRecordStore {
  return new ConversationRecordStore(openRecords(recordsLocation(root)), now);
}

/**
 * Test-only: overwrite a record with arbitrary content (a kind or provider the
 * store has no mutation for). Recreates it, so revisions restart at 0.
 */
export async function replaceRecord(
  store: ConversationRecordStore,
  record: ConversationRecord
): Promise<void> {
  await store.purge(record.conversationId);
  await store.create(record);
}
