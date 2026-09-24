import { createHash } from 'node:crypto';
import type { BuddyContext, ConversationConfig } from '@unleashd/shared';
import type { ConversationRuntime } from '../conversations/runtime';
import { canonicalizePostMedia, describeMediaProblems } from './channel-media';
import { announceChannelPost } from './channel-post-feed';
import type { GateVerdict, ReplyGate } from './channel-reply-gate';
import {
  authorLabel,
  mentionedBuddyIds,
  readableChannelText,
  transcriptLine,
} from './channel-text';
import type {
  BuddiesStorePort,
  BuddyListAuthor,
  BuddyMailingList,
  BuddyMailingListPost,
} from './contract';

// Channel replies. A list post wakes nobody (package invariant); this module
// is the host policy layered on top of the store, and the only place a post
// leads to a turn. Two causes:
//
//   mention   — the OWNER @mentions a Buddy. It always answers. Buddy-authored
//               mentions never dispatch: Buddies coordinate with
//               send/update_project.
//   follow_up — any new reply in a thread (owner's or a Buddy's) asks each
//               OTHER Buddy who has posted in that thread one short gate
//               question: "should you respond, or leave it to another team
//               member?" (channel-reply-gate.ts). Only a strict `<yes>` starts
//               a reply turn. Buddy-to-Buddy follow-ups are what the
//               mailing-list spec's fan-out warning is about, so the chain is
//               bounded: once the thread's last MAX_BUDDY_CHAIN posts are all
//               Buddies', nobody is asked until the owner posts again. The
//               bound is read from the thread itself, so it survives restarts.
//
// One conversation per MENTION (the Slack model): every @mention, including a
// follow-up inside a thread, starts a new conversation seeded from the thread
// or channel context in its prompt. The thread is the memory, not a resumed
// transcript. Until 2026-09-24 a (Buddy, thread) conversation was resumed for
// every mention, which broke two ways in conv 0f1dfb23: the resumed transcript
// grew until the provider ended the turn with `out_of_tokens`, and a harness
// picked on a later mention was refused ("Provider cannot change after the
// conversation has started"). Resuming belongs to the chat view, not channels.
// The Buddy's final assistant text is posted into the thread by the SERVER as
// that Buddy (purpose "reply"), stamped with the conversation for provenance.
// The model never has to remember to call `post` for its answer.
//
// The owner may pick the harness/model for a mentioned Buddy (the composer's
// mention chip). The new conversation is created on that pick, so it applies
// to that one reply; an unpicked mention runs on the Buddy's profile default.
//
// Known gap: a turn in flight when the server restarts loses its reply post
// (the transcript survives). The owner re-mentions to retry.

// Why a Buddy is replying; it only changes how the launch prompt is framed.
type ReplyCause = { kind: 'mention' } | { kind: 'follow_up' };

export type MentionDispatch =
  | { buddyId: string; status: 'started'; conversationId: string }
  | { buddyId: string; status: 'rejected'; reason: string };

// Which configuration a mention's conversation is created on: the Buddy's
// profile default, or the owner's pick from the mention chip.
export type MentionModel = { kind: 'profile' } | { kind: 'chosen'; config: ConversationConfig };

export type ChannelResponse = {
  listId: string;
  threadRootId: string;
  buddyId: string;
  conversationId: string;
  startedAt: string;
};

export interface ChannelResponderPorts {
  getStore(): Promise<BuddiesStorePort>;
  createConversation(input: {
    context: BuddyContext;
    commandId: string;
    conversationId: string;
    deferInitialMessage: true;
    config?: ConversationConfig;
  }): Promise<ConversationRuntime>;
  uploadsRoot(): string;
  gate: ReplyGate;
  logger?: Pick<Console, 'warn'>;
}

// The launch prompt carries only the recent conversation: the last N channel
// posts with their threads collapsed, or the last N replies of the thread. The
// Buddy pulls anything older with get_list / get_thread / search_posts.
const CONTEXT_POSTS = 10;
const MAX_REPLY_BYTES = 32000;
// Consecutive Buddy posts at a thread's tail after which follow-ups stop until
// the owner speaks. Three lets two Buddies exchange a question and an answer
// and one more turn, without letting them talk to each other indefinitely.
const MAX_BUDDY_CHAIN = 3;
const THREAD_PAGE = 200;

// UUID-shaped id derived from a seed, so a (purpose, Buddy, …) tuple always
// names the same transcript across restarts without storing a mapping.
export function stableConversationId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// One transcript per (mention post, Buddy). Stable so a replayed post names
// the same conversation instead of starting another.
export function mentionConversationId(triggerPostId: string, buddyId: string): string {
  return stableConversationId(`channel-mention:${triggerPostId}:${buddyId}`);
}

export function followUpConversationId(triggerPostId: string, buddyId: string): string {
  return stableConversationId(`channel-follow-up:${triggerPostId}:${buddyId}`);
}

// What the Buddy is shown before the owner's message. A channel view lists
// top-level posts only (threads collapsed to a reply count); a thread view is
// its root plus the latest replies, noting how many earlier ones were skipped.
type ThreadContext = {
  kind: 'thread';
  root: BuddyMailingListPost;
  omittedReplies: number;
  replies: BuddyMailingListPost[];
};
type LaunchContext = { kind: 'channel'; posts: BuddyMailingListPost[] } | ThreadContext;

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
): ThreadContext {
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

function causeHeadline(cause: ReplyCause, where: string): string {
  switch (cause.kind) {
    case 'mention':
      return `The owner mentioned you in ${where}`;
    case 'follow_up':
      return `A new message arrived in ${where} you have posted in, and you chose to reply`;
  }
}

function contextLines(
  list: BuddyMailingList,
  cause: ReplyCause,
  context: LaunchContext,
  store: BuddiesStorePort
): string[] {
  switch (context.kind) {
    case 'channel':
      return [
        `${causeHeadline(cause, 'a new message')} in #${list.name} (list ${list.id}). The ${context.posts.length} most recent channel messages, oldest first (threads collapsed to a reply count):`,
        '',
        ...context.posts.map((post) => transcriptLine(post, store)),
      ];
    case 'thread':
      return [
        `${causeHeadline(cause, 'a thread')} in #${list.name} (list ${list.id}). The thread root, then its most recent replies, oldest first:`,
        '',
        ...threadTranscript(context, store),
      ];
  }
}

function threadTranscript(context: ThreadContext, store: BuddiesStorePort): string[] {
  return [
    transcriptLine(context.root, store),
    ...(context.omittedReplies > 0
      ? [`… ${context.omittedReplies} earlier replies omitted (get_thread to read them) …`]
      : []),
    ...context.replies.map((post) => transcriptLine(post, store)),
  ];
}

function buildPrompt(input: {
  list: BuddyMailingList;
  cause: ReplyCause;
  trigger: BuddyMailingListPost;
  context: LaunchContext;
  store: BuddiesStorePort;
}): string {
  return [
    ...contextLines(input.list, input.cause, input.context, input.store),
    '',
    'Each line shows its post id. Open any thread with get_thread({postId}); page the channel ' +
      'from any post with get_list({listId, before|after|around: postId}); find earlier ' +
      'discussion in any channel with search_posts({query}) or search_posts({mentions:"me"}). ' +
      'Look things up only when the reply needs it.',
    '',
    `Reply to the latest message, from ${authorLabel(input.trigger.author, input.store)}:`,
    readableChannelText(input.trigger.body),
    '',
    'Your final answer to this turn is posted into the thread as your reply, verbatim, as markdown. ' +
      'Write it for the channel: direct and concise. Embed an image or video with ' +
      '![alt](/absolute/path) (the file is copied into the channel) and reference a Task with ' +
      '[title](task:<projectId>). Do not also call post for this reply. If the request needs ' +
      'real work, do it or hand it off with send/update_project, then say what you did.',
  ].join('\n');
}

function buddyAuthorIds(author: BuddyListAuthor): string[] {
  switch (author.kind) {
    case 'owner':
      return [];
    case 'buddy':
      return [author.buddyId];
  }
}

// Buddies a post already dispatched by mention. Only the owner's mentions
// dispatch, so a Buddy mentioned by another Buddy is still asked the gate.
function dispatchedMentions(post: BuddyMailingListPost): string[] {
  switch (post.author.kind) {
    case 'owner':
      return mentionedBuddyIds(post.body);
    case 'buddy':
      return [];
  }
}

// Every post in a thread, root first, by keyset pages (the store caps a page).
function wholeThread(store: BuddiesStorePort, root: BuddyMailingListPost): BuddyMailingListPost[] {
  const posts = [root];
  let anchor: string | null = null;
  for (;;) {
    const page = store.pagePosts({
      thread: root.id,
      direction: 'newer',
      anchor,
      limit: THREAD_PAGE,
    });
    posts.push(...page);
    if (page.length < THREAD_PAGE) return posts;
    anchor = page[page.length - 1].id;
  }
}

function trailingBuddyPosts(thread: BuddyMailingListPost[]): number {
  let count = 0;
  for (let index = thread.length - 1; index >= 0; index--) {
    if (buddyAuthorIds(thread[index].author).length === 0) break;
    count++;
  }
  return count;
}

function gatePrompt(input: {
  list: BuddyMailingList;
  buddy: { name: string; role: string };
  others: { name: string; role: string }[];
  trigger: BuddyMailingListPost;
  context: ThreadContext;
  store: BuddiesStorePort;
}): string {
  const team = [
    'the Owner (the human who runs the team)',
    ...input.others.map((other) => `${other.name} (${other.role})`),
  ].join(', ');
  return [
    `You are ${input.buddy.name} (${input.buddy.role}), one member of a team in the channel #${input.list.name}.`,
    'A new message was just posted in a thread you have posted in. The thread root, then its most recent replies, oldest first:',
    '',
    ...threadTranscript(input.context, input.store),
    '',
    `New message, from ${authorLabel(input.trigger.author, input.store)}:`,
    readableChannelText(input.trigger.body),
    '',
    `Also in this thread: ${team}.`,
    '',
    'Given this thread context, should you respond, or leave it to another team member? ' +
      'Say yes only when the thread needs something from you specifically: a question aimed at ' +
      'you or your role, a correction only you can make, or work you own. Do not reply just to ' +
      'acknowledge, agree or repeat what someone else said.',
    '',
    'Answer with exactly <yes> or <no> and nothing else.',
  ].join('\n');
}

type Eligibility = { kind: 'eligible' } | { kind: 'rejected'; reason: string };

function eligibility(
  store: BuddiesStorePort,
  list: BuddyMailingList,
  buddyId: string
): Eligibility {
  const buddy = store.getBuddy(buddyId);
  if (!buddy || buddy.status !== 'active')
    return { kind: 'rejected', reason: 'Buddy is not active' };
  const inWorkspace = store
    .listBuddyWorkspaces(buddyId)
    .some((workspace) => (workspace as { id: string }).id === list.workspaceId);
  if (!inWorkspace) return { kind: 'rejected', reason: 'Buddy is outside this workspace' };
  return { kind: 'eligible' };
}

function replyKey(cause: ReplyCause, triggerId: string, buddyId: string): string {
  switch (cause.kind) {
    case 'mention':
      return `mention-reply:${triggerId}:${buddyId}`;
    case 'follow_up':
      return `follow-up-reply:${triggerId}:${buddyId}`;
  }
}

function clipReply(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_REPLY_BYTES) return text;
  const suffix = '\n\n… [reply truncated; the full answer is in the conversation]';
  let clipped = text.slice(0, MAX_REPLY_BYTES - 200);
  while (Buffer.byteLength(clipped + suffix, 'utf8') > MAX_REPLY_BYTES)
    clipped = clipped.slice(0, -200);
  return clipped + suffix;
}

// The conversation is created on the chosen config directly, so a Buddy whose
// profile harness is unavailable can still answer on the one the owner picked.
function creationConfig(model: MentionModel): { config?: ConversationConfig } {
  switch (model.kind) {
    case 'profile':
      return {};
    case 'chosen':
      return { config: model.config };
  }
}

// The runtime's turn events carry no turn identity; the conversation is new
// and runs exactly this one turn, so the next completion is ours.
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
  const active = new Map<string, ChannelResponse>();
  // (thread, Buddy) pairs with a follow-up gate or reply in flight, so a burst
  // of posts asks each Buddy once rather than stacking duplicate replies.
  const following = new Set<string>();
  const threadKey = (threadRootId: string, buddyId: string) => `${threadRootId}:${buddyId}`;
  const busy = (threadRootId: string, buddyId: string) =>
    following.has(threadKey(threadRootId, buddyId)) ||
    [...active.values()].some(
      (response) => response.threadRootId === threadRootId && response.buddyId === buddyId
    );

  async function postReply(input: {
    list: BuddyMailingList;
    cause: ReplyCause;
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
      key: replyKey(input.cause, input.trigger.id, input.buddyId),
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
        const { post } = store.createPost({ ...base, purpose: 'reply', body: clipReply(body) });
        announceChannelPost(post);
        return;
      }
      // A failure notice is not conversation: it asks nobody to follow up.
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
    cause: ReplyCause;
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
    const prompt = buildPrompt({
      list: input.list,
      cause: input.cause,
      trigger: input.trigger,
      context,
      store,
    });
    let outcome: { kind: 'answered'; text: string } | { kind: 'failed'; reason: string };
    try {
      const conversation = await ports.createConversation({
        context: { buddyId: input.buddyId, workspaceId: input.list.workspaceId },
        commandId: `channel-reply-${input.conversationId}`,
        conversationId: input.conversationId,
        deferInitialMessage: true,
        ...creationConfig(input.model),
      });
      outcome = { kind: 'answered', text: await runTurn(conversation, prompt, input.trigger.id) };
    } catch (error) {
      outcome = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    await postReply({ ...input, outcome });
  }

  // Registers the reply for "X is replying…" and runs it to its posted answer.
  function launch(input: Parameters<typeof respond>[0]): Promise<void> {
    active.set(input.conversationId, {
      listId: input.list.id,
      threadRootId: input.threadRootId,
      buddyId: input.buddyId,
      conversationId: input.conversationId,
      startedAt: new Date().toISOString(),
    });
    return respond(input)
      .catch((error) => {
        logger.warn(`[channel-responder] ${input.conversationId} reply failed:`, error);
      })
      .finally(() => active.delete(input.conversationId));
  }

  async function followUp(input: {
    list: BuddyMailingList;
    trigger: BuddyMailingListPost;
    root: BuddyMailingListPost;
    buddyId: string;
    others: string[];
  }): Promise<void> {
    const store = await ports.getStore();
    const profile = (buddyId: string) => {
      const buddy = store.getBuddy(buddyId);
      return { name: buddy?.name ?? buddyId, role: buddy?.role ?? '' };
    };
    const verdict: GateVerdict = await ports.gate({
      buddyId: input.buddyId,
      prompt: gatePrompt({
        list: input.list,
        buddy: profile(input.buddyId),
        others: input.others.map(profile),
        trigger: input.trigger,
        context: threadContext(store, input.root.id, input.trigger),
        store,
      }),
    });
    switch (verdict.kind) {
      case 'respond':
        return launch({
          list: input.list,
          cause: { kind: 'follow_up' },
          trigger: input.trigger,
          threadRootId: input.root.id,
          buddyId: input.buddyId,
          conversationId: followUpConversationId(input.trigger.id, input.buddyId),
          model: { kind: 'profile' },
        });
      case 'pass':
        return;
      // Loud, not silent: console.warn reaches the error journal, so a Buddy
      // whose model cannot answer the gate is visible rather than just quiet.
      case 'unparseable':
        logger.warn(
          `[channel-responder] ${input.buddyId} gave no <yes>/<no> for post ${input.trigger.id}: ${JSON.stringify(verdict.output)}`
        );
        return;
      case 'failed':
        logger.warn(
          `[channel-responder] reply gate failed for ${input.buddyId} on post ${input.trigger.id}: ${verdict.reason}`
        );
        return;
    }
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
        const admitted = eligibility(store, list, buddyId);
        if (admitted.kind === 'rejected')
          return { buddyId, status: 'rejected', reason: admitted.reason };
        const conversationId = mentionConversationId(post.id, buddyId);
        const config = chosen.get(buddyId);
        const model: MentionModel = config ? { kind: 'chosen', config } : { kind: 'profile' };
        void launch({
          list,
          cause: { kind: 'mention' },
          trigger: post,
          threadRootId,
          buddyId,
          conversationId,
          model,
        });
        return { buddyId, status: 'started', conversationId };
      });
    },

    /**
     * Ask every other Buddy who has posted in this post's thread whether to
     * follow up (see the header). Returns once the gates are started; a
     * `<yes>` becomes a reply turn whose answer lands in the thread.
     */
    async considerThreadPost(post: BuddyMailingListPost): Promise<void> {
      if (post.threadRootId === null) return;
      const store = await ports.getStore();
      const list = store.getList(post.listId);
      const root = store.getPost(post.threadRootId);
      if (!list || !root) throw new Error(`Thread of post ${post.id} is gone`);
      const thread = wholeThread(store, root);
      // Only the thread's newest post is followed up. A replayed post (same
      // idempotency key, same post) is then a no-op, and a burst of posts is
      // gated once, against the latest message, which sees all of them.
      if (thread[thread.length - 1].id !== post.id) return;
      if (trailingBuddyPosts(thread) >= MAX_BUDDY_CHAIN) return;
      const skipped = new Set([...buddyAuthorIds(post.author), ...dispatchedMentions(post)]);
      const participants = [...new Set(thread.flatMap((entry) => buddyAuthorIds(entry.author)))];
      for (const buddyId of participants) {
        if (skipped.has(buddyId) || busy(root.id, buddyId)) continue;
        if (eligibility(store, list, buddyId).kind === 'rejected') continue;
        const key = threadKey(root.id, buddyId);
        following.add(key);
        void followUp({
          list,
          trigger: post,
          root,
          buddyId,
          others: participants.filter((other) => other !== buddyId),
        })
          .catch((error) => {
            logger.warn(`[channel-responder] follow-up for ${buddyId} failed:`, error);
          })
          .finally(() => following.delete(key));
      }
    },

    /** Buddies currently composing a reply in this list, for "X is replying…". */
    responding(listId: string): ChannelResponse[] {
      return [...active.values()].filter((response) => response.listId === listId);
    },
  };
}

export type ChannelResponder = ReturnType<typeof createChannelResponder>;
