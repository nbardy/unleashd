import { atom } from 'jotai';
import { allConversationIdsAtom, conversationsAtom } from '../../atoms/conversations';
import { fuzzyMatch } from '../../utils/fuzzyMatch';

// =============================================================================
// Mobile search state — sum type, never string sentinel (T2)
// =============================================================================

export type MobileSearchState = { kind: 'idle' } | { kind: 'searching'; query: string };

export const mobileSearchStateAtom = atom<MobileSearchState>({ kind: 'idle' });

// Derived: matching conversation ids, newest-first. Idle → every id (rows
// subscribe per id). Searching → fuzzyMatch over workingDirectory + id +
// last-message preview. Only a live query reads full records, so an idle
// search page does no work on conversation events.
// Conversation has no title field.
export const mobileSearchResultsAtom = atom((get): readonly string[] => {
  const state = get(mobileSearchStateAtom);
  const ids = get(allConversationIdsAtom);
  if (state.kind === 'idle' || state.query.length === 0) return ids;

  const query = state.query;
  const conversations = get(conversationsAtom);
  return ids.filter((id) => {
    const conv = conversations.get(id);
    if (!conv) return false;
    // Try workingDirectory
    if (fuzzyMatch(query, conv.workingDirectory) !== null) return true;
    // Try conversation id
    if (fuzzyMatch(query, conv.id) !== null) return true;
    // Try last-message preview (full content truncated to 500 chars for perf)
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg) {
      const preview = lastMsg.content.substring(0, 500);
      if (fuzzyMatch(query, preview) !== null) return true;
    }
    return false;
  });
});
