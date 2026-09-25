import type { ConversationRow } from '@unleashd/shared';
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { conversationAtomFamily, conversationListAtom } from './conversations';
import { sameItems, stableAtom } from './structural';

type BuddyScope = { buddyId: string; workspaceId: string | null };

// Ids of one Buddy's background conversations, running first, then newest.
// Reads list entries, so it recomputes only when a list field changes.
const backgroundIdsAtomFamily = atomFamily(
  ({ buddyId, workspaceId }: BuddyScope) =>
    stableAtom(
      (get) =>
        get(conversationListAtom)
          .filter(
            (entry) =>
              entry.background &&
              entry.buddyId === buddyId &&
              (workspaceId === null || entry.buddyWorkspaceId === workspaceId)
          )
          .sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || b.activityMs - a.activityMs)
          .map((entry) => entry.id),
      sameItems
    ),
  (a, b) => a.buddyId === b.buddyId && a.workspaceId === b.workspaceId
);

export const buddyBackgroundConversationsAtomFamily = atomFamily(
  (scope: BuddyScope) =>
    atom((get) => {
      const conversations = get(backgroundIdsAtomFamily(scope)).flatMap((id): ConversationRow[] => {
        const conversation = get(conversationAtomFamily(id));
        return conversation ? [conversation] : [];
      });
      return {
        conversations,
        runningCount: conversations.filter(
          (conversation) => conversation.run === 'running' || conversation.run === 'streaming'
        ).length,
      };
    }),
  (a, b) => a.buddyId === b.buddyId && a.workspaceId === b.workspaceId
);
