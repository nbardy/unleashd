import { getBuddyContext } from '@unleashd/shared';
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { getConversationLastActivity } from '../utils/time';
import { allConversationsAtom } from './conversations';

export const buddyBackgroundConversationsAtomFamily = atomFamily(
  ({ buddyId, workspaceId }: { buddyId: string; workspaceId: string | null }) =>
    atom((get) => {
      const conversations = get(allConversationsAtom)
        .filter((conversation) => {
          const context = getBuddyContext(conversation);
          return (
            conversation.placement === 'background' &&
            context?.buddyId === buddyId &&
            (workspaceId === null || context.workspaceId === workspaceId)
          );
        })
        .sort(
          (a, b) =>
            Number(b.isRunning) - Number(a.isRunning) ||
            getConversationLastActivity(b).getTime() - getConversationLastActivity(a).getTime()
        );
      return {
        conversations,
        runningCount: conversations.filter((conversation) => conversation.isRunning).length,
      };
    }),
  (a, b) => a.buddyId === b.buddyId && a.workspaceId === b.workspaceId
);
