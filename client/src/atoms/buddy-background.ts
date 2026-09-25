import type { ConversationRow } from '@unleashd/shared';
import { isRowRunning } from '../utils/conversation-row';
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { conversationAtomFamily, conversationListAtom } from './conversations';
import { sameItems, stableAtom } from './structural';

// Ids of one Buddy's background conversations, running first, then newest.
// Reads list entries, so it recomputes only when a list field changes.
const backgroundIdsAtomFamily = atomFamily((buddyId: string) =>
  stableAtom(
    (get) =>
      get(conversationListAtom)
        .filter((entry) => entry.background && entry.buddyId === buddyId)
        .sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || b.activityMs - a.activityMs)
        .map((entry) => entry.id),
    sameItems
  )
);

export const buddyBackgroundConversationsAtomFamily = atomFamily((buddyId: string) =>
  atom((get) => {
    const conversations = get(backgroundIdsAtomFamily(buddyId)).flatMap((id): ConversationRow[] => {
      const conversation = get(conversationAtomFamily(id));
      return conversation ? [conversation] : [];
    });
    return {
      conversations,
      runningCount: conversations.filter(isRowRunning).length,
    };
  })
);
