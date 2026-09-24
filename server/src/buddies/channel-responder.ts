import { createHash } from 'node:crypto';
import type {
  BuddyContext,
  ConfigError,
  ConversationConfig,
  ConversationConfigState,
  Result,
} from '@unleashd/shared';
import type { ConversationRuntime } from '../conversations/runtime';
import { canonicalizePostMedia, describeMediaProblems } from './channel-media';
import { mentionedBuddyIds, readableChannelText, transcriptLine } from './channel-text';
import type { BuddiesStorePort, BuddyMailingList, BuddyMailingListPost } from './contract';

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
// The owner may pick the harness/model for a mentioned Buddy (the composer's
// mention chip). The choice is applied to the (Buddy, thread) conversation
// through the same config path as the chat header, so it sticks for later
// mentions in that thread, and a thread that has started keeps its harness:
// switching it is rejected and reported in the thread like any failed turn.
//
// Known gap: a turn in flight when the server restarts loses its reply post
// (the transcript survives). The owner re-mentions to retry.

export type MentionDispatch =
  | { buddyId: string; status: 'started'; conversationId: string }
  | { buddyId: string; status: 'rejected'; reason: string };

// Which configuration a mention's turn runs on. `thread` keeps whatever the
// (Buddy, thread) conversation already runs — the Buddy's profile default
// when the thread is new; `chosen` is the owner's pick from the mention chip.
export type MentionModel = { kind: 'thread' } | { kind: 'chosen'; config: ConversationConfig };

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
    config?: ConversationConfig;
  }): Promise<ConversationRuntime>;
  /** Replace a live conversation's configuration (runtime-config.ts). */
  setConversationConfig(
    conversation: ConversationRuntime,
    config: ConversationConfig
  ): Promise<Result<ConversationConfigState, ConfigError>>;
  uploadsRoot(): string;
  logger?: Pick<Console, 'warn'>;
}

// The launch prompt carries only the recent conversation: the last N channel
// posts with their threads collapsed, or the last N replies of the thread. The
// Buddy pulls anything older with get_list / get_thread / search_posts.
const CONTEXT_POSTS = 10;
const MAX_REPLY_BYTES = 32000;

// UUID-shaped id derived from a seed, so a (purpose, Buddy, …) tuple always
// names the same transcript across restarts without storing a mapping.
export function stableConversationId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// One transcript per (thread, Buddy): every mention in a thread continues it.
export function channelConversationId(threadRootId: string, buddyId: string): string {
  return stableConversationId(`channel:${threadRootId}:${buddyId}`);
}

// What the Buddy is shown before the owner's message. A channel view lists
// top-level posts only (threads collapsed to a reply count); a thread view is
// its root plus the latest replies, noting how many earlier ones were skipped.
type LaunchContext =
  | { kind: 'channel'; posts: BuddyMailingListPost[] }
  | {
      kind: 'thread';
      root: BuddyMailingListPost;
      omittedReplies: number;
      replies: BuddyMailingListPost[];
    };

function channelContext(
  store: BuddiesStorePort,
  list: BuddyMailingList,
  trigger: BuddyMailingListPost
): LaunchContext {
  const posts = store
    .listPosts({ list: list.id, limit: CONTEXT_POSTS + 1 })
    .filter((post) => post.id !== trigger.id)
    .slice(0, CONTEXT_POSTS)
    .reverse();
  return { kind: 'channel', posts };
}

function threadContext(
  store: BuddiesStorePort,
  threadRootId: string,
  trigger: BuddyMailingListPost
): LaunchContext {
  // Read the thread's tail by keyset, not listThread: listThread returns the
  // OLDEST replies up to its cap, so on a long thread its "last 10" were not
  // the latest. The trigger is itself the newest reply, hence one extra.
  const root = store.getPost(threadRootId);
  if (!root) throw new Error('Thread root not found');
  const replies = store
    .pagePosts({ thread: threadRootId, direction: 'older', limit: CONTEXT_POSTS + 1 })
    .filter((post) => post.id !== trigger.id)
    .slice(-CONTEXT_POSTS);
  return {
    kind: 'thread',
    root,
    omittedReplies: Math.max(0, root.replyCount - 1 - replies.length),
    replies,
  };
}

function contextLines(
  list: BuddyMailingList,
  context: LaunchContext,
  store: BuddiesStorePort
): string[] {
  switch (context.kind) {
    case 'channel':
      return [
        `The owner mentioned you in a new message in #${list.name} (list ${list.id}). The ${context.posts.length} most recent channel messages, oldest first (threads collapsed to a reply count):`,
        '',
        ...context.posts.map((post) => transcriptLine(post, store)),
      ];
    case 'thread':
      return [
        `The owner mentioned you in a thread in #${list.name} (list ${list.id}). The thread root, then its most recent replies, oldest first:`,
        '',
        transcriptLine(context.root, store),
        ...(context.omittedReplies > 0
          ? [`… ${context.omittedReplies} earlier replies omitted (get_thread to read them) …`]
          : []),
        ...context.replies.map((post) => transcriptLine(post, store)),
      ];
  }
}

function buildPrompt(input: {
  list: BuddyMailingList;
  trigger: BuddyMailingListPost;
  context: LaunchContext;
  store: BuddiesStorePort;
}): string {
  return [
    ...contextLines(input.list, input.context, input.store),
    '',
    'Each line shows its post id. Open any thread with get_thread({postId}); page the channel ' +
      'from any post with get_list({listId, before|after|around: postId}); find earlier ' +
      'discussion in any channel with search_posts({query}) or search_posts({mentions:"me"}). ' +
      'Look things up only when the reply needs it.',
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

// A new thread is created on the chosen config directly, so a Buddy whose
// profile harness is unavailable can still answer on the one the owner picked.
function creationConfig(model: MentionModel): { config?: ConversationConfig } {
  switch (model.kind) {
    case 'thread':
      return {};
    case 'chosen':
      return { config: model.config };
  }
}

function configRejection(error: ConfigError): string {
  const hint =
    error.code === 'provider_locked'
      ? ' A thread keeps its harness once it has started; mention the Buddy in a new message to use another.'
      : '';
  return `this thread can’t use the chosen model: ${error.message}.${hint}`;
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

  async function conversationFor(
    buddyId: string,
    workspaceId: string,
    conversationId: string,
    model: MentionModel
  ) {
    const existing = ports.getConversation(conversationId);
    if (existing) return ports.ensureConversationReady(existing);
    return ports.createConversation({
      context: { buddyId, workspaceId },
      commandId: `channel-thread-${conversationId}`,
      conversationId,
      deferInitialMessage: true,
      ...creationConfig(model),
    });
  }

  // Runs on an idle conversation (a provider change is refused mid-turn).
  // Re-applying the config a new thread was just created with only advances
  // its revision, which keeps one path for new and continuing threads.
  async function selectModel(conversation: ConversationRuntime, model: MentionModel) {
    switch (model.kind) {
      case 'thread':
        return;
      case 'chosen': {
        const result = await ports.setConversationConfig(conversation, model.config);
        if (!result.ok) throw new Error(configRejection(result.error));
        return;
      }
    }
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
    model: MentionModel;
  }): Promise<void> {
    const store = await ports.getStore();
    const context =
      input.trigger.threadRootId === null
        ? channelContext(store, input.list, input.trigger)
        : threadContext(store, input.threadRootId, input.trigger);
    const prompt = buildPrompt({ list: input.list, trigger: input.trigger, context, store });
    let outcome: { kind: 'answered'; text: string } | { kind: 'failed'; reason: string };
    try {
      const conversation = await conversationFor(
        input.buddyId,
        input.list.workspaceId,
        input.conversationId,
        input.model
      );
      await untilIdle(conversation);
      await selectModel(conversation, input.model);
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
     * `chosen` holds the owner's model pick per mentioned Buddy.
     */
    async respondToOwnerPost(
      list: BuddyMailingList,
      post: BuddyMailingListPost,
      chosen: ReadonlyMap<string, ConversationConfig>
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
        const config = chosen.get(buddyId);
        const model: MentionModel = config ? { kind: 'chosen', config } : { kind: 'thread' };
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
            await respond({ list, trigger: post, threadRootId, buddyId, conversationId, model });
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
