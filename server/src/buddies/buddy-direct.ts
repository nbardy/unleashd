import { randomUUID } from 'node:crypto';
import type { BuddyContext } from '@unleashd/shared';
import type { ConversationRuntime } from '../conversations/runtime';
import { stableConversationId } from './channel-responder';
import type { BuddiesStorePort } from './contract';

// Direct messages and "wake up" for a Buddy, from the channels page.
//
// DM = ONE ongoing owner conversation per (workspace, Buddy), so opening it
// again shows the history instead of a blank thread. Its id is derived, not
// stored: generation 0 is the DM; if the owner deletes it (a tombstone makes
// that id permanently unusable), the next open moves to generation 1, and so on.
//
// Wake = owner input sent INTO the DM: "catch up on the channels, then act".
// The Buddy reads its unread lists with its own tools and decides per item —
// reply in the thread, start background work, hand off, or leave it — and its
// summary lands in the DM, where the owner reads what it did. No new run type,
// no hidden transcript: waking is just a message in a conversation you can open.

export const WAKE_MESSAGE = [
  'Wake-up check: catch up on the workspace channels and act on what matters to you.',
  '',
  '1. Call get_inbox. It lists every channel with your unread count, plus any mail waiting for you.',
  '2. Read each channel with unread posts using get_list (a fresh read marks it read). Where a post shows replyCount or recent latestReplyAt, read the thread with get_list({threadId}).',
  '3. For each thing that concerns you, choose one:',
  '   - answer in its thread with post({threadId}) when a reply actually helps (never just to acknowledge);',
  '   - start real work: send it to yourself as background work, or update_project on the Task it belongs to;',
  '   - hand it to the Buddy who owns it with send;',
  '   - or leave it.',
  '4. Finish with a short summary: what you read, what you replied to, and what work you started (with ids).',
].join('\n');

const MAX_DM_GENERATIONS = 32;

export interface BuddyDirectPorts {
  getStore(): Promise<BuddiesStorePort>;
  getConversation(id: string): ConversationRuntime | undefined;
  ensureConversationReady(conversation: ConversationRuntime): Promise<ConversationRuntime>;
  createConversation(input: {
    context: BuddyContext;
    commandId: string;
    conversationId: string;
    deferInitialMessage: true;
  }): Promise<ConversationRuntime>;
  isConversationDeleted(conversationId: string): Promise<boolean>;
}

export function directConversationId(workspaceId: string, buddyId: string, generation: number) {
  return stableConversationId(`dm:${workspaceId}:${buddyId}:${generation}`);
}

export function createBuddyDirect(ports: BuddyDirectPorts) {
  async function requireActiveMember(buddyId: string, workspaceId: string): Promise<void> {
    const store = await ports.getStore();
    const buddy = store.getBuddy(buddyId);
    if (!buddy || buddy.status !== 'active') throw new Error('Buddy is not active');
    const member = store
      .listBuddyWorkspaces(buddyId)
      .some((workspace) => (workspace as { id: string }).id === workspaceId);
    if (!member) throw new Error('Buddy is outside this workspace');
  }

  async function directConversation(
    buddyId: string,
    workspaceId: string
  ): Promise<ConversationRuntime> {
    await requireActiveMember(buddyId, workspaceId);
    for (let generation = 0; generation < MAX_DM_GENERATIONS; generation += 1) {
      const conversationId = directConversationId(workspaceId, buddyId, generation);
      const existing = ports.getConversation(conversationId);
      if (existing) return ports.ensureConversationReady(existing);
      if (await ports.isConversationDeleted(conversationId)) continue;
      return ports.createConversation({
        context: { buddyId, workspaceId },
        commandId: `buddy-dm-${conversationId}`,
        conversationId,
        deferInitialMessage: true,
      });
    }
    throw new Error(
      `Every direct conversation slot for this Buddy was deleted (${MAX_DM_GENERATIONS})`
    );
  }

  return {
    /** Get or create the DM; the caller navigates to it. */
    async open(buddyId: string, workspaceId: string): Promise<{ conversationId: string }> {
      const conversation = await directConversation(buddyId, workspaceId);
      return { conversationId: conversation.id };
    },

    /** Queue the wake-up check in the DM (after any turn already running there). */
    async wake(buddyId: string, workspaceId: string): Promise<{ conversationId: string }> {
      const conversation = await directConversation(buddyId, workspaceId);
      conversation.enqueueMessage(WAKE_MESSAGE, {
        origin: 'owner_input',
        inputId: `wake-${randomUUID()}`,
      });
      return { conversationId: conversation.id };
    },
  };
}

export type BuddyDirect = ReturnType<typeof createBuddyDirect>;
