import type { ConversationListEntry } from '../../atoms/conversation-index';

/** The single Buddy Builder thread the channels rail should surface (newest, not done). */
export function latestActiveBuddyBuilder(
  builders: readonly ConversationListEntry[]
): ConversationListEntry | null {
  for (const entry of builders) {
    if (!entry.done) return entry;
  }
  return null;
}
