import { createHash } from 'node:crypto';
import type { BuddyContext } from '@unleashd/shared';
import type { ConversationRuntime } from '../conversations/runtime';
import { canonicalizePostMedia, describeMediaProblems } from './channel-media';
import type {
  BuddiesStorePort,
  BuddyListAuthor,
  BuddyMailingList,
  BuddyMailingListPost,
} from './contract';

// @mentions in channels. A list post wakes nobody (package invariant), so a
// Buddy only answers when the OWNER explicitly mentions it: this is host
// policy layered on top of the store, and it is the only place a post leads
// to a turn. Buddy-authored mentions never dispatch — Buddies coordinate with
// send/update_project, and letting posts wake Buddies would reopen the
// fan-out the mailing-list spec closed.
//
// One conversation per (Buddy, thread): follow-up mentions in the same thread
// continue the same transcript, so the Buddy remembers the thread. The
// Buddy's final assistant text is posted into the thread by the SERVER as
// that Buddy (purpose "reply"), stamped with the conversation for provenance.
// The model never has to remember to call `post` for its answer.
//
// Known gap: a turn in flight when the server restarts loses its reply post
// (the transcript survives). The owner re-mentions to retry.

// Mentions are markdown links with a buddy: target, inserted by the composer
// as `[@Name](buddy:<id>)`. Tasks use `[Title](task:<id>)`.
const MENTION = /\[@([^\]]+)\]\(buddy:([A-Za-z0-9_-]+)\)/g;
const TASK_REFERENCE = /\[([^\]]+)\]\(task:([A-Za-z0-9_-]+)\)/g;

export function mentionedBuddyIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))];
}

// What a reader (human or model) sees for a token: `@Name`, `Title (task <id>)`.
export function readableChannelText(body: string): string {
  return body
    .replace(MENTION, (_whole, name: string) => `@${name}`)
    .replace(TASK_REFERENCE, (_whole, title: string, id: string) => `${title} (task ${id})`);
}

export type MentionDispatch =
  | { buddyId: string; status: 'started'; conversationId: string }
  | { buddyId: string; status: 'rejected'; reason: string };

export type ChannelResponse = {
  listId: string;
  threadRootId: string;
  buddyId: string;
  conversationId: string;
  startedAt: string;
};

export interface ChannelResponderPorts {
  getStore(): Promise<BuddiesStorePort>;
  getConversation(id: string): ConversationRuntime | undefined;
  ensureConversationReady(conversation: ConversationRuntime): Promise<ConversationRuntime>;
  createConversation(input: {
    context: BuddyContext;
    commandId: string;
    conversationId: string;
    deferInitialMessage: true;
  }): Promise<ConversationRuntime>;
  uploadsRoot(): string;
  logger?: Pick<Console, 'warn'>;
}

const MAX_CONTEXT_POSTS = 40;
const MAX_POST_CHARS = 4000;
const MAX_REPLY_BYTES = 32000;

// Stable UUID-shaped id per (thread, Buddy) so every mention in a thread
// lands in the same transcript, across restarts.
export function channelConversationId(threadRootId: string, buddyId: string): string {
  const hex = createHash('sha256').update(`channel:${threadRootId}:${buddyId}`).digest('hex');
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function authorLabel(author: BuddyListAuthor, store: BuddiesStorePort): string {
  switch (author.kind) {
    case 'owner':
      return 'Owner';
    case 'buddy':
      return store.getBuddy(author.buddyId)?.name ?? author.buddyId;
  }
}

function transcriptLine(post: BuddyMailingListPost, store: BuddiesStorePort): string {
  const text = readableChannelText(post.body);
  const clipped =
    text.length > MAX_POST_CHARS ? `${text.slice(0, MAX_POST_CHARS)}… [truncated]` : text;
  return `[${post.createdAt}] ${authorLabel(post.author, store)}: ${clipped}`;
}

function buildPrompt(input: {
  list: BuddyMailingList;
  trigger: BuddyMailingListPost;
  context: readonly BuddyMailingListPost[];
  store: BuddiesStorePort;
}): string {
  const where =
    input.trigger.threadRootId === null
      ? `a new message in #${input.list.name}. Recent channel messages, oldest first:`
      : `a thread in #${input.list.name}. The thread so far, oldest first:`;
  return [
    `The owner mentioned you in ${where}`,
    '',
    ...input.context.map((post) => transcriptLine(post, input.store)),
    '',
    'Reply to the owner’s latest message:',
    readableChannelText(input.trigger.body),
    '',
    'Your final answer to this turn is posted into the thread as your reply, verbatim, as markdown. ' +
      'Write it for the channel: direct and concise. Embed an image or video with ' +
      '![alt](/absolute/path) (the file is copied into the channel) and reference a Task with ' +
      '[title](task:<projectId>). Do not also call post for this reply. If the request needs ' +
      'real work, do it or hand it off with send/update_project, then say what you did.',
  ].join('\n');
}

function clipReply(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_REPLY_BYTES) return text;
  const suffix = '\n\n… [reply truncated; the full answer is in the conversation]';
  let clipped = text.slice(0, MAX_REPLY_BYTES - 200);
  while (Buffer.byteLength(clipped + suffix, 'utf8') > MAX_REPLY_BYTES)
    clipped = clipped.slice(0, -200);
  return clipped + suffix;
}

function isIdle(conversation: ConversationRuntime): boolean {
  return (
    !conversation.isRunning && !conversation.hasActiveProcess() && conversation.queue.length === 0
  );
}

async function untilIdle(conversation: ConversationRuntime): Promise<void> {
  while (!isIdle(conversation)) {
    await conversation.waitForTurnDrain();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// The runtime's turn events carry no turn identity, so a turn is only started
// on an idle conversation and the listeners attach right before it: the next
// completion is ours. Mentions into one conversation are serialized by the
// caller's per-conversation chain.
function runTurn(conversation: ConversationRuntime, prompt: string, inputId: string) {
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      conversation.off('buddy-turn-complete', onComplete);
      conversation.off('buddy-turn-failed', onFailure);
    };
    const onComplete = (output: string) => {
      cleanup();
      resolve(output);
    };
    const onFailure = (reason: string) => {
      cleanup();
      reject(new Error(reason || 'Buddy turn failed'));
    };
    conversation.once('buddy-turn-complete', onComplete);
    conversation.once('buddy-turn-failed', onFailure);
    conversation.sendMessage(prompt, { origin: 'owner_input', inputId });
  });
}

export function createChannelResponder(ports: ChannelResponderPorts) {
  const logger = ports.logger ?? console;
  const chains = new Map<string, Promise<void>>();
  const active = new Map<string, ChannelResponse>();

  async function conversationFor(buddyId: string, workspaceId: string, conversationId: string) {
    const existing = ports.getConversation(conversationId);
    if (existing) return ports.ensureConversationReady(existing);
    return ports.createConversation({
      context: { buddyId, workspaceId },
      commandId: `channel-thread-${conversationId}`,
      conversationId,
      deferInitialMessage: true,
    });
  }

  async function postReply(input: {
    list: BuddyMailingList;
    trigger: BuddyMailingListPost;
    threadRootId: string;
    buddyId: string;
    conversationId: string;
    outcome: { kind: 'answered'; text: string } | { kind: 'failed'; reason: string };
  }): Promise<void> {
    const store = await ports.getStore();
    const base = {
      list: input.list.id,
      author: { kind: 'buddy', buddyId: input.buddyId } as const,
      key: `mention-reply:${input.trigger.id}:${input.buddyId}`,
      evidence: [],
      threadRoot: input.threadRootId,
      conversationId: input.conversationId,
      runId: null,
    };
    switch (input.outcome.kind) {
      case 'answered': {
        const media = canonicalizePostMedia(input.outcome.text.trim() || '(no reply text)', {
          uploadsRoot: ports.uploadsRoot(),
          listId: input.list.id,
        });
        // The Buddy cannot fix a reference after its turn ended, so a bad one
        // is kept visible in the reply rather than rejecting the whole answer.
        const body =
          media.problems.length > 0
            ? `${media.body}\n\n_Some media could not be attached: ${describeMediaProblems(media.problems)}_`
            : media.body;
        store.createPost({ ...base, purpose: 'reply', body: clipReply(body) });
        return;
      }
      case 'failed':
        store.createPost({
          ...base,
          purpose: 'reply_failed',
          body: `Couldn’t reply: ${input.outcome.reason}`,
        });
        return;
    }
  }

  async function respond(input: {
    list: BuddyMailingList;
    trigger: BuddyMailingListPost;
    threadRootId: string;
    buddyId: string;
    conversationId: string;
  }): Promise<void> {
    const store = await ports.getStore();
    const context =
      input.trigger.threadRootId === null
        ? store
            .listPosts({ list: input.list.id, limit: Math.min(MAX_CONTEXT_POSTS, 16) })
            .filter((post) => post.id !== input.trigger.id)
            .reverse()
        : (() => {
            const thread = store.listThread({ root: input.threadRootId });
            return [thread.root, ...thread.replies.slice(-MAX_CONTEXT_POSTS)].filter(
              (post) => post.id !== input.trigger.id
            );
          })();
    const prompt = buildPrompt({ list: input.list, trigger: input.trigger, context, store });
    let outcome: { kind: 'answered'; text: string } | { kind: 'failed'; reason: string };
    try {
      const conversation = await conversationFor(
        input.buddyId,
        input.list.workspaceId,
        input.conversationId
      );
      await untilIdle(conversation);
      outcome = { kind: 'answered', text: await runTurn(conversation, prompt, input.trigger.id) };
    } catch (error) {
      outcome = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    await postReply({ ...input, outcome });
  }

  return {
    /**
     * Start one turn per valid @mention in an OWNER post. Returns as soon as
     * the turns are queued; replies land in the thread when they finish.
     */
    async respondToOwnerPost(
      list: BuddyMailingList,
      post: BuddyMailingListPost
    ): Promise<MentionDispatch[]> {
      const store = await ports.getStore();
      const threadRootId = post.threadRootId ?? post.id;
      return mentionedBuddyIds(post.body).map((buddyId): MentionDispatch => {
        const buddy = store.getBuddy(buddyId);
        if (!buddy || buddy.status !== 'active')
          return { buddyId, status: 'rejected', reason: 'Buddy is not active' };
        const inWorkspace = store
          .listBuddyWorkspaces(buddyId)
          .some((workspace) => (workspace as { id: string }).id === list.workspaceId);
        if (!inWorkspace)
          return { buddyId, status: 'rejected', reason: 'Buddy is outside this workspace' };
        const conversationId = channelConversationId(threadRootId, buddyId);
        const previous = chains.get(conversationId) ?? Promise.resolve();
        const job = previous
          .then(async () => {
            active.set(conversationId, {
              listId: list.id,
              threadRootId,
              buddyId,
              conversationId,
              startedAt: new Date().toISOString(),
            });
            await respond({ list, trigger: post, threadRootId, buddyId, conversationId });
          })
          .catch((error) => {
            logger.warn(`[channel-responder] ${conversationId} reply failed:`, error);
          })
          .finally(() => {
            active.delete(conversationId);
            if (chains.get(conversationId) === job) chains.delete(conversationId);
          });
        chains.set(conversationId, job);
        return { buddyId, status: 'started', conversationId };
      });
    },

    /** Buddies currently composing a reply in this list, for "X is replying…". */
    responding(listId: string): ChannelResponse[] {
      return [...active.values()].filter((response) => response.listId === listId);
    },
  };
}

export type ChannelResponder = ReturnType<typeof createChannelResponder>;
