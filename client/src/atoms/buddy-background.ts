import type { Conversation } from '@unleashd/shared';
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
        .filter((entry) => entry.placement === 'background' && entry.buddyId === buddyId)
        .sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || b.activityMs - a.activityMs)
        .map((entry) => entry.id),
    sameItems
  )
);

export const buddyBackgroundConversationsAtomFamily = atomFamily((buddyId: string) =>
  atom((get) => {
    const conversations = get(backgroundIdsAtomFamily(buddyId)).flatMap((id): Conversation[] => {
      const conversation = get(conversationAtomFamily(id));
      return conversation ? [conversation] : [];
    });
    return {
      conversations,
      runningCount: conversations.filter((conversation) => conversation.isRunning).length,
    };
  })
);
