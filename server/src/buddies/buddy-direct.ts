import { randomUUID } from 'node:crypto';
import type { ConversationConfig } from '@unleashd/shared';
import type { ConversationRuntime } from '../conversations/runtime';
import {
  type StableConversationPorts,
  eligibility,
  openConversation,
  scanGenerations,
  stableConversationId,
} from './buddy-conversation-slots';
import type { BuddiesStorePort } from './contract';
import { assertBuddyProviderSupportsMcp } from './provider-capability';

// Direct messages and "wake up" for a Buddy, from the channels page.
//
// DM = ONE ongoing owner conversation per (workspace, Buddy), so opening it
// again shows the history instead of a blank thread. Its id is derived, not
// stored (buddy-conversation-slots.ts): generation 0 is the DM. "New chat"
// opens the next generation without deleting the earlier ones, so the client
// can draw them above a divider. Deleting a generation tombstones that id;
// the next open moves past it.
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
  '2. Read each channel with unread posts using get_list (a fresh read marks it read). Where a post shows replyCount or recent latestReplyAt, expand the thread with get_thread({postId}). search_posts({query}) finds older discussion in any channel.',
  '3. For each thing that concerns you, choose one:',
  '   - answer in its thread with post({threadId}) when a reply actually helps (never just to acknowledge);',
  '   - start real work: send it to yourself as background work, or update_project on the Task it belongs to;',
  '   - hand it to the Buddy who owns it with send;',
  '   - or leave it.',
  '4. Finish with a short summary: what you read, what you replied to, and what work you started (with ids).',
].join('\n');

export interface BuddyDirectPorts {
  getStore(): Promise<BuddiesStorePort>;
  conversations: StableConversationPorts;
}

export function directConversationId(workspaceId: string, buddyId: string, generation: number) {
  return stableConversationId(`dm:${workspaceId}:${buddyId}:${generation}`);
}

export interface DirectGeneration {
  generation: number;
  conversationId: string;
}

export interface DirectChain {
  buddyId: string;
  workspaceId: string;
  currentId: string;
  generations: DirectGeneration[];
}

export function createBuddyDirect(ports: BuddyDirectPorts) {
  async function directConversation(
    buddyId: string,
    workspaceId: string
  ): Promise<ConversationRuntime> {
    const admitted = eligibility(await ports.getStore(), buddyId, workspaceId);
    if (admitted.kind === 'rejected') throw new Error(admitted.reason);
    const { current, next } = await scanGenerations(ports.conversations, (generation) =>
      directConversationId(workspaceId, buddyId, generation)
    );
    const conversationId = current?.conversationId ?? next;
    return openConversation(ports.conversations, {
      context: { buddyId, workspaceId },
      conversationId,
      commandId: `buddy-dm-${conversationId}`,
      // A live DM replays on the config it runs; a new one takes the profile.
      config: current?.config,
    });
  }

  async function liveGenerations(
    buddyId: string,
    workspaceId: string
  ): Promise<{ generations: DirectGeneration[]; current: { config: ConversationConfig } | null; next: string }> {
    const generations: DirectGeneration[] = [];
    const { current, next } = await scanGenerations(ports.conversations, (generation) => {
      const conversationId = directConversationId(workspaceId, buddyId, generation);
      return conversationId;
    });
    // scanGenerations only reports the newest live slot. Walk again so the
    // client can render every earlier generation above the divider.
    for (let generation = 0; ; generation += 1) {
      const conversationId = directConversationId(workspaceId, buddyId, generation);
      if (conversationId === next) break;
      const slot = await ports.conversations.slot(conversationId);
      if (slot.kind === 'live') generations.push({ generation, conversationId });
    }
    return { generations, current, next };
  }

  return {
    /** Get or create the DM; the caller navigates to it. */
    async open(buddyId: string, workspaceId: string): Promise<{ conversationId: string }> {
      const conversation = await directConversation(buddyId, workspaceId);
      return { conversationId: conversation.id };
    },

    /**
     * Start the next DM generation. The previous ones stay live so the thread
     * can show them above a divider. No handoff prompt: the new session starts
     * empty, and its harness stays changeable until the first message.
     * The copied config is the previous harness, so the picker opens on it.
     */
    async newChat(
      buddyId: string,
      workspaceId: string,
      input: { config?: ConversationConfig; message?: string } = {}
    ): Promise<{ conversationId: string }> {
      const admitted = eligibility(await ports.getStore(), buddyId, workspaceId);
      if (admitted.kind === 'rejected') throw new Error(admitted.reason);
      const { current, next } = await liveGenerations(buddyId, workspaceId);
      if (input.config) assertBuddyProviderSupportsMcp(input.config.provider);
      if (
        input.message &&
        input.config &&
        current &&
        input.config.provider === current.config.provider
      ) {
        throw new Error(
          `Pick a different harness. ${current.config.provider} is the one that ran out of tokens.`
        );
      }
      const conversation = await openConversation(ports.conversations, {
        context: { buddyId, workspaceId },
        conversationId: next,
        commandId: `buddy-dm-${next}`,
        config: input.config ?? current?.config,
      });
      const message = input.message?.trim();
      if (message) {
        conversation.enqueueMessage(message, {
          origin: 'owner_input',
          inputId: `retry-${randomUUID()}`,
        });
      }
      return { conversationId: conversation.id };
    },

    /** Every live DM chain. Priors are the generations other than currentId. */
    async chains(): Promise<{ chains: DirectChain[] }> {
      const store = await ports.getStore();
      const chains: DirectChain[] = [];
      for (const buddy of store.listBuddies()) {
        if (buddy.status !== 'active') continue;
        for (const workspace of store.listBuddyWorkspaces(buddy.id) as Array<{ id: string }>) {
          const { generations } = await liveGenerations(buddy.id, workspace.id);
          const currentId = generations.at(-1)?.conversationId;
          if (!currentId) continue;
          chains.push({
            buddyId: buddy.id,
            workspaceId: workspace.id,
            currentId,
            generations,
          });
        }
      }
      return { chains };
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
