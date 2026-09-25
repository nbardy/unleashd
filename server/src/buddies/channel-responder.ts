import { isDeepStrictEqual } from 'node:util';
import type { ConversationConfig } from '@unleashd/shared';
import { awaitTurn } from '../conversations/await-turn';
import {
  buddyExecutionPreferences,
  configFromProviderPreferences,
} from '../conversations/config-mapping';
import type { ConversationRuntime } from '../conversations/runtime';
import {
  type LiveConversation,
  type StableConversationPorts,
  eligibility,
  openConversation,
  scanGenerations,
  stableConversationId,
} from './buddy-conversation-slots';
import { canonicalizePostMedia, describeMediaProblems } from './channel-media';
import { announceChannelPost } from './channel-post-feed';
import type { ReplyGate } from './channel-reply-gate';
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
//               a reply. Buddy-to-Buddy follow-ups are what the mailing-list
//               spec's fan-out warning is about, so the chain is bounded: once
//               the thread's last MAX_BUDDY_CHAIN posts are all Buddies',
//               nobody is asked until the owner posts again. The bound is read
//               from the thread itself, so it survives restarts. A Buddy
//               already gating or replying in the thread is asked once it
//               finishes, about the newest post its turn did not see.
//
// SEATS. Every reply by a Buddy in a thread — mention or follow-up — goes to
// its seat there: ONE resumed conversation per (thread, Buddy), so the Buddy
// remembers the thread. The seat's persisted config is the owner's harness /
// model pick: a mention-chip pick opens the seat on it (a new seat generation
// when the current seat runs anything else — a started session cannot change
// provider), and every later reply, gate question included, keeps it. With
// no pick ever made the seat runs the Buddy's profile default.
//
// History: until 2026-09-24 (46b4c0c) this resumed seats, then briefly made a
// fresh conversation per mention, blaming conv 0f1dfb23's `out_of_tokens` on
// transcript growth. It was not: the error was Codex's account USAGE LIMIT
// ("You've hit your usage limit … try again at Sep 27th"), which agent-cli
// classifies as out_of_tokens (diagnostics.ts). Resuming is safe; the one real
// constraint, provider lock, is what seat generations handle.
//
// The Buddy's final assistant text is posted into the thread by the SERVER as
// that Buddy (purpose "reply"), stamped with the conversation for provenance.
// The model never has to remember to call `post` for its answer.
//
// Known gap: a turn in flight when the server restarts loses its reply post
// (the transcript survives). The owner re-mentions to retry.

// Why a Buddy is replying; it only changes how the launch prompt is framed.
type ReplyCause = { kind: 'mention' } | { kind: 'follow_up' };

// Which seat a reply goes to. `keep`: the Buddy's current seat in the thread,
// opened on its profile when it has none. `chosen`: the owner's mention-chip
// pick — the current seat if it already runs exactly that, else a new seat
// generation on it.
export type SeatRequest = { kind: 'keep' } | { kind: 'chosen'; config: ConversationConfig };

export type MentionDispatch =
  | { buddyId: string; status: 'started' }
  | { buddyId: string; status: 'rejected'; reason: string };

export type ChannelResponse = {
  listId: string;
  threadRootId: string;
  buddyId: string;
  startedAt: string;
  // 'queued': the reply turn waits for a free slot under its Buddy's run limit
  // (default 5, shared with background work). Without it a waiting reply read
  // as "replying…" for as long as the Buddy stayed full.
  state: 'replying' | 'queued';
};

export interface ChannelResponderPorts {
  getStore(): Promise<BuddiesStorePort>;
  conversations: StableConversationPorts;
  uploadsRoot(): string;
  gate: ReplyGate;
  /**
   * This list changed in a way the channel post feed does not announce: who
   * is replying, or a failure notice. The server pushes it to clients, whose
   * channel views poll only as a 30 s backstop.
   */
  channelChanged(listId: string): void;
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

export function threadConversationId(
  threadRootId: string,
  buddyId: string,
  generation: number
): string {
  return stableConversationId(`channel-thread:${threadRootId}:${buddyId}:${generation}`);
}

function profileConfig(store: BuddiesStorePort, buddyId: string): ConversationConfig {
  const buddy = store.getBuddy(buddyId);
  if (!buddy) throw new Error(`Buddy ${buddyId} not found`);
  return configFromProviderPreferences(buddyExecutionPreferences(buddy));
}

function seatFor(
  request: SeatRequest,
  seats: { current: LiveConversation | null; next: string },
  profile: ConversationConfig
): LiveConversation {
  switch (request.kind) {
    case 'keep':
      return seats.current ?? { conversationId: seats.next, config: profile };
    case 'chosen':
      return seats.current && isDeepStrictEqual(seats.current.config, request.config)
        ? seats.current
        : { conversationId: seats.next, config: request.config };
  }
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
// A resumed seat already holds every post up to the trigger it last answered
// (its earlier prompts) and its own replies (its answers), so it is shown only
// what arrived since. Until 2026-09-25 every resumed reply re-sent the root and
// the last 10 replies, duplicating them in the seat's transcript each turn.
type ThreadDelta = {
  kind: 'thread_delta';
  omittedReplies: number;
  replies: BuddyMailingListPost[];
};
type LaunchContext =
  | { kind: 'channel'; posts: BuddyMailingListPost[] }
  | ThreadContext
  | ThreadDelta;

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

function threadDelta(
  store: BuddiesStorePort,
  threadRootId: string,
  seenThrough: string,
  seatConversationId: string,
  trigger: BuddyMailingListPost
): ThreadDelta {
  const root = store.getPost(threadRootId);
  if (!root) throw new Error('Thread root not found');
  const thread = wholeThread(store, root);
  // An anchor that is gone (deleted post) finds -1, so the whole thread counts
  // as unseen: more context, never less.
  const unseen = thread
    .slice(thread.findIndex((post) => post.id === seenThrough) + 1)
    .filter((post) => post.id !== trigger.id && post.senderConversationId !== seatConversationId);
  const replies = unseen.slice(-CONTEXT_POSTS);
  return { kind: 'thread_delta', omittedReplies: unseen.length - replies.length, replies };
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
    case 'thread_delta':
      return [
        `${causeHeadline(cause, 'a thread')} in #${list.name} (list ${list.id}). You have seen this thread through your last turn. Replies since then, oldest first (${context.replies.length}):`,
        '',
        ...(context.omittedReplies > 0
          ? [`… ${context.omittedReplies} earlier new replies omitted (get_thread to read them) …`]
          : []),
        ...context.replies.map((post) => transcriptLine(post, store)),
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

// A seat is also an ordinary chat: the owner may be typing in it.
async function untilIdle(conversation: ConversationRuntime): Promise<void> {
  while (!isIdle(conversation)) {
    await conversation.waitForTurnDrain();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function createChannelResponder(ports: ChannelResponderPorts) {
  const logger = ports.logger ?? console;
  // One queue per (thread, Buddy): its replies run one at a time, in order,
  // each opening the seat, waiting for it to idle, then taking the turn. An
  // entry lives while replies are queued; it is what "X is replying…" reads.
  const queues = new Map<string, Omit<ChannelResponse, 'state'> & { tail: Promise<void> }>();
  // Pairs with a gate question out, so a burst of posts asks each Buddy once.
  const gating = new Set<string>();
  const pairKey = (threadRootId: string, buddyId: string) => `${threadRootId}:${buddyId}`;
  const busy = (key: string) => gating.has(key) || queues.has(key);
  // Pair -> the newest thread post that arrived while the pair was busy; it is
  // gated once the pair goes idle. Until 2026-09-25 such a post was skipped: an
  // owner reply landing while the Buddy was mid-reply in that thread was never
  // asked about, and the Buddy's own reply (its author is never asked) did not
  // raise it again, so the owner's message went unanswered.
  const deferred = new Map<string, FollowUp>();
  // Pairs whose reply turn is lined up behind the Buddy's run limit.
  const queuedForSlot = new Set<string>();

  // Mark the pair queued until its turn actually starts (or ends without one).
  function trackRunSlot(
    key: string,
    listId: string,
    conversation: ConversationRuntime
  ): () => void {
    const started = () => {
      if (queuedForSlot.delete(key)) ports.channelChanged(listId);
    };
    if (conversation.waitingForRunSlot()) {
      queuedForSlot.add(key);
      ports.channelChanged(listId);
    }
    conversation.once('buddy-turn-started', started);
    return () => {
      conversation.off('buddy-turn-started', started);
      started();
    };
  }
  // Pair -> when its latest reply turn read the thread. A deferred post created
  // before then was already in that turn's context and needs no second look.
  const contextReadAt = new Map<string, string>();
  // Seat conversation id -> the trigger post of its last answered turn. In
  // memory: after a restart a seat is unknown and gets the full thread once.
  const seenThrough = new Map<string, string>();

  function launchContext(
    store: BuddiesStorePort,
    input: Reply,
    seatConversationId: string
  ): LaunchContext {
    if (input.trigger.threadRootId === null)
      return channelContext(store, input.list, input.trigger);
    const seen = seenThrough.get(seatConversationId);
    return seen === undefined
      ? threadContext(store, input.threadRootId, input.trigger)
      : threadDelta(store, input.threadRootId, seen, seatConversationId, input.trigger);
  }

  async function currentSeats(threadRootId: string, buddyId: string) {
    return scanGenerations(ports.conversations, (generation) =>
      threadConversationId(threadRootId, buddyId, generation)
    );
  }

  // Runs inside the pair's queue, so two picks can never claim one generation.
  async function openSeat(
    list: BuddyMailingList,
    threadRootId: string,
    buddyId: string,
    request: SeatRequest
  ): Promise<ConversationRuntime> {
    const store = await ports.getStore();
    const seat = seatFor(
      request,
      await currentSeats(threadRootId, buddyId),
      profileConfig(store, buddyId)
    );
    return openConversation(ports.conversations, {
      context: { buddyId, workspaceId: list.workspaceId },
      conversationId: seat.conversationId,
      commandId: `channel-thread-${seat.conversationId}`,
      config: seat.config,
    });
  }

  // The config the Buddy's next reply in this thread would run on.
  async function seatConfig(threadRootId: string, buddyId: string): Promise<ConversationConfig> {
    const store = await ports.getStore();
    const seats = await currentSeats(threadRootId, buddyId);
    return seatFor({ kind: 'keep' }, seats, profileConfig(store, buddyId)).config;
  }

  async function postReply(input: {
    list: BuddyMailingList;
    trigger: BuddyMailingListPost;
    threadRootId: string;
    buddyId: string;
    conversationId: string | null;
    outcome: { kind: 'answered'; text: string } | { kind: 'failed'; reason: string };
  }): Promise<void> {
    const store = await ports.getStore();
    const base = {
      list: input.list.id,
      author: { kind: 'buddy', buddyId: input.buddyId } as const,
      key: `thread-reply:${input.trigger.id}:${input.buddyId}`,
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
      // A failure notice is not conversation: it asks nobody to follow up, so
      // it is not announced as a post. It is still pushed: a failed gate has
      // no queue entry whose removal would refresh the channel, and before
      // 2026-09-25 its notice waited out the 30 s backstop poll.
      case 'failed':
        store.createPost({
          ...base,
          purpose: 'reply_failed',
          body: `Couldn’t reply: ${input.outcome.reason}`,
        });
        ports.channelChanged(input.list.id);
        return;
    }
  }

  type Reply = {
    list: BuddyMailingList;
    cause: ReplyCause;
    request: SeatRequest;
    trigger: BuddyMailingListPost;
    threadRootId: string;
    buddyId: string;
  };

  // Every failure — seat, turn — becomes a visible reply_failed post.
  async function runReply(input: Reply): Promise<void> {
    const store = await ports.getStore();
    let conversationId: string | null = null;
    let outcome: { kind: 'answered'; text: string } | { kind: 'failed'; reason: string };
    try {
      const conversation = await openSeat(
        input.list,
        input.threadRootId,
        input.buddyId,
        input.request
      );
      conversationId = conversation.id;
      await untilIdle(conversation);
      contextReadAt.set(pairKey(input.threadRootId, input.buddyId), new Date().toISOString());
      const context = launchContext(store, input, conversation.id);
      const prompt = buildPrompt({ ...input, context, store });
      let untrack: () => void = () => undefined;
      const text = await awaitTurn(
        conversation,
        () => {
          conversation.sendMessage(prompt, { origin: 'owner_input', inputId: input.trigger.id });
          untrack = trackRunSlot(
            pairKey(input.threadRootId, input.buddyId),
            input.list.id,
            conversation
          );
        },
        'Buddy turn failed'
      ).finally(() => untrack());
      seenThrough.set(conversation.id, input.trigger.id);
      outcome = { kind: 'answered', text };
    } catch (error) {
      outcome = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    await postReply({ ...input, conversationId, outcome });
  }

  function reply(input: Reply): void {
    const key = pairKey(input.threadRootId, input.buddyId);
    const previous = queues.get(key);
    const tail = (previous?.tail ?? Promise.resolve())
      .then(() => runReply(input))
      .catch((error) => {
        logger.warn(`[channel-responder] reply to ${input.trigger.id} failed:`, error);
      });
    const entry = {
      listId: input.list.id,
      threadRootId: input.threadRootId,
      buddyId: input.buddyId,
      startedAt: previous?.startedAt ?? new Date().toISOString(),
      tail,
    };
    queues.set(key, entry);
    ports.channelChanged(entry.listId);
    void tail.finally(() => {
      if (queues.get(key) !== entry) return;
      queues.delete(key);
      ports.channelChanged(entry.listId);
      settle(key);
    });
  }

  type FollowUp = {
    list: BuddyMailingList;
    trigger: BuddyMailingListPost;
    root: BuddyMailingListPost;
    buddyId: string;
    others: string[];
  };

  // Ask the pair's gate now, or once its current gate or reply finishes.
  function gate(input: FollowUp): void {
    const key = pairKey(input.root.id, input.buddyId);
    if (busy(key)) {
      deferred.set(key, input);
      return;
    }
    gating.add(key);
    void followUp(input)
      .catch((error) => {
        logger.warn(`[channel-responder] follow-up for ${input.buddyId} failed:`, error);
      })
      .finally(() => {
        gating.delete(key);
        settle(key);
      });
  }

  // The pair went idle: gate the post that arrived meanwhile, unless the
  // Buddy's last reply turn read the thread after it was posted.
  function settle(key: string): void {
    const next = deferred.get(key);
    if (next === undefined || busy(key)) return;
    deferred.delete(key);
    if (next.trigger.createdAt <= (contextReadAt.get(key) ?? '')) return;
    gate(next);
  }

  async function followUp(input: FollowUp): Promise<void> {
    const store = await ports.getStore();
    const profile = (buddyId: string) => {
      const buddy = store.getBuddy(buddyId);
      return { name: buddy?.name ?? buddyId, role: buddy?.role ?? '' };
    };
    const verdict = await ports.gate({
      config: await seatConfig(input.root.id, input.buddyId),
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
        return reply({
          list: input.list,
          cause: { kind: 'follow_up' },
          request: { kind: 'keep' },
          trigger: input.trigger,
          threadRootId: input.root.id,
          buddyId: input.buddyId,
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
        return gateFailedNotice(input, verdict.reason);
    }
  }

  // The owner is waiting on an answer, so a gate that could not run is shown
  // in the thread. 2026-09-24: every Buddy in a workspace ran on Codex at its
  // usage limit; each owner reply failed its gate 4 s in and the thread just
  // stayed quiet — the journal was the only trace. A Buddy's post has no one
  // waiting on it, so there the journal line is enough.
  async function gateFailedNotice(
    input: {
      list: BuddyMailingList;
      trigger: BuddyMailingListPost;
      root: BuddyMailingListPost;
      buddyId: string;
    },
    reason: string
  ): Promise<void> {
    switch (input.trigger.author.kind) {
      case 'owner':
        return postReply({
          list: input.list,
          trigger: input.trigger,
          threadRootId: input.root.id,
          buddyId: input.buddyId,
          conversationId: null,
          outcome: { kind: 'failed', reason: `could not decide whether to reply (${reason})` },
        });
      case 'buddy':
        return;
    }
  }

  return {
    /**
     * Queue one reply per valid @mention in an OWNER post, in the Buddy's seat
     * for this thread; replies land there when their turns finish. `chosen`
     * holds the owner's harness/model pick per mentioned Buddy.
     */
    async respondToOwnerPost(
      list: BuddyMailingList,
      post: BuddyMailingListPost,
      chosen: ReadonlyMap<string, ConversationConfig>
    ): Promise<MentionDispatch[]> {
      const store = await ports.getStore();
      return mentionedBuddyIds(post.body).map((buddyId): MentionDispatch => {
        const admitted = eligibility(store, buddyId, list.workspaceId);
        if (admitted.kind === 'rejected')
          return { buddyId, status: 'rejected', reason: admitted.reason };
        const config = chosen.get(buddyId);
        reply({
          list,
          cause: { kind: 'mention' },
          request: config ? { kind: 'chosen', config } : { kind: 'keep' },
          trigger: post,
          threadRootId: post.threadRootId ?? post.id,
          buddyId,
        });
        return { buddyId, status: 'started' };
      });
    },

    /**
     * Ask every other Buddy who has posted in this post's thread whether to
     * follow up (see the header). Returns once the gates are started; a
     * `<yes>` becomes a reply in that Buddy's seat.
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
      // A Buddy whose first reply here is still running participates too: the
      // owner's "one more thing" right after an @mention is meant for it.
      const replying = [...queues.values()]
        .filter((entry) => entry.threadRootId === root.id)
        .map((entry) => entry.buddyId);
      const participants = [
        ...new Set([...thread.flatMap((entry) => buddyAuthorIds(entry.author)), ...replying]),
      ];
      for (const buddyId of participants) {
        if (skipped.has(buddyId)) continue;
        if (eligibility(store, buddyId, list.workspaceId).kind === 'rejected') continue;
        gate({
          list,
          trigger: post,
          root,
          buddyId,
          others: participants.filter((other) => other !== buddyId),
        });
      }
    },

    /** Buddies currently composing a reply in this list, for "X is replying…". */
    responding(listId: string): ChannelResponse[] {
      return [...queues.entries()]
        .filter(([, entry]) => entry.listId === listId)
        .map(([key, { tail: _tail, ...response }]) => ({
          ...response,
          state: queuedForSlot.has(key) ? 'queued' : 'replying',
        }));
    },
  };
}

export type ChannelResponder = ReturnType<typeof createChannelResponder>;
