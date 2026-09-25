import { atomFamily } from 'jotai-family';
import { conversationListAtom } from './conversations';
import { sameItems, stableAtom } from './structural';

/**
 * One Buddy's foreground chats, running first, then newest. Background,
 * provider-child and swarm-worker transcripts have their own surfaces; they
 * are not ordinary chats. Rows come from the conversations the client holds,
 * so every id here is openable — there is no dead link row to filter out.
 */
export const buddyConversationIdsAtomFamily = atomFamily((buddyId: string) =>
  stableAtom(
    (get) =>
      get(conversationListAtom)
        .filter(
          (entry) =>
            entry.kind === 'buddy' &&
            entry.buddyId === buddyId &&
            entry.placement !== 'background' &&
            !entry.isWorker &&
            entry.parentConversationId === null
        )
        .sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || b.activityMs - a.activityMs)
        .map((entry) => entry.id),
    sameItems
  )
);
