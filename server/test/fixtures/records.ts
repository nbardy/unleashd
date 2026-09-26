import {
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
