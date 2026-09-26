import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Actor, Buddy, Channel, Cursor, Post } from '@unleashd/buddies-core';
import { type ConversationConfig, isHarnessRetryFailure } from '@unleashd/shared';
import { awaitTurn } from '../conversations/await-turn';
import {
  buddyExecutionPreferences,
  configFromProviderPreferences,
} from '../conversations/config-mapping';
import type {
  ConversationRuntime,
  SeatTurnInput,
  SessionRelativePrompt,
} from '../conversations/runtime';
import {
  type LiveConversation,
  type StableConversationPorts,
  liveGenerations,
  openConversation,
  scanGenerations,
  stableConversationId,
} from './buddy-conversation-slots';
import type { ReplyGate } from './channel-reply-gate';
import { type BuddiesCore, OWNER, buddyActor } from './core';
import type { BuddyEvents } from './events';

// Channel replies: the host policy that turns a post into a Buddy turn (a post wakes nobody in
// the core). Two causes, on public channels:
//   mention   — the OWNER @mentions a Buddy; it always answers. A Buddy's mention never dispatches.
//   follow_up — a new reply in a thread asks each OTHER Buddy who posted there one gate question
//               (channel-reply-gate.ts); only a strict <yes> starts a reply. The chain stops once
//               the thread's last MAX_BUDDY_CHAIN posts are all Buddies', until the owner speaks.
// SEATS: every reply goes to the Buddy's seat in that thread, ONE resumed conversation per
// (thread, Buddy) (buddy-conversation-slots.ts). The owner's mention-chip model pick opens a new
// seat generation when the current seat runs anything else. The Buddy posts its own reply with the
// `post` tool; its text output is a private scratchpad and never reaches the channel (493c1c7: the
// server used to paste the final text, tool transcript and all, or "(no reply text)"). A turn that
// posts nothing, or fails, leaves a visible reply_failed notice. Known gap: a turn in flight at
// restart leaves neither its post (if not yet written) nor the notice.

const CONTEXT_POSTS = 10;
const MAX_BUDDY_CHAIN = 3;
const THREAD_PAGE = 200;

const MENTION = /\[@([^\]]+)\]\(buddy:([A-Za-z0-9_-]+)\)/g;
const TASK_REFERENCE = /\[([^\]]+)\]\(task:([A-Za-z0-9_-]+)\)/g;

export function mentionedBuddyIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))];
}

export function readableChannelText(body: string): string {
  return body
    .replace(MENTION, (_whole, name: string) => `@${name}`)
    .replace(TASK_REFERENCE, (_whole, title: string, id: string) => `${title} (task ${id})`);
}

type Names = ReadonlyMap<string, string>;
const label = (author: Actor, names: Names) =>
  author.kind === 'owner' ? 'Owner' : (names.get(author.id) ?? author.id);

function transcriptLine(post: Post, names: Names): string {
  const text = readableChannelText(post.body);
  const clipped = text.length > 4000 ? `${text.slice(0, 4000)}… [truncated]` : text;
  return `[${post.createdAt}] ${label(post.author, names)} (${post.id}): ${clipped}`;
}

const rootOf = (post: Post) => post.rootId ?? post.id;
const buddyAuthor = (post: Post): string[] =>
  post.author.kind === 'buddy' ? [post.author.id] : [];

// Owner authority for a seat turn follows the author of its trigger post, read back from the
// store by id — never from the prompt, which quotes Buddy text. B1 (2026-09-25): every seat turn
// was sent as 'owner_input', so a follow-up gated on ANOTHER BUDDY's post held owner authority.
// Guard: buddies-v2.test.ts "B1: a seat turn holds owner authority only when …".
export function seatTurnInput(trigger: Post): SeatTurnInput {
  switch (trigger.author.kind) {
    case 'owner':
      return { origin: 'owner_input', inputId: trigger.id };
    case 'buddy':
      return { origin: 'buddy_post', inputId: trigger.id };
  }
}

export type ThreadSeat = { buddyId: string; config: ConversationConfig };
export type SeatRequest = { kind: 'keep' } | { kind: 'chosen'; config: ConversationConfig };
export type MentionDispatch =
  | { buddyId: string; status: 'started' }
  | { buddyId: string; status: 'rejected'; reason: string };
export type ChannelResponse = {
  channelId: string;
  threadRootId: string;
  buddyId: string;
  startedAt: string;
  state: 'replying' | 'queued';
};

export const threadConversationId = (rootId: string, buddyId: string, generation: number) =>
  stableConversationId(`channel-thread:${rootId}:${buddyId}:${generation}`);
export const directConversationId = (workspaceId: string, buddyId: string, generation: number) =>
  stableConversationId(`dm:${workspaceId}:${buddyId}:${generation}`);

export const WAKE_MESSAGE = [
  'Wake-up check: catch up on the workspace channels and act on what matters to you.',
  '1. Call inbox: requests you owe, and every channel with your unread count.',
  '2. Read each channel with unread posts with channel_read (reading from the top marks it read); open threads with channel_read({read:{threadId}}).',
  '3. For each thing that concerns you: answer it in its thread (post with replyToId) when a reply helps, start the work (task_write), hand it to its owner (post a request in a DM), or leave it.',
  '4. Finish with a short summary: what you read, what you replied to, what work you started (with ids).',
].join('\n');

export interface ChannelsPorts {
  core: BuddiesCore;
  events: BuddyEvents;
  conversations: StableConversationPorts;
  uploadsRoot(): string;
  gate: ReplyGate;
  /** Who is replying changed, or a failure notice landed: push `channel_changed`. */
  channelChanged(channelId: string): void;
  logger?: Pick<Console, 'warn'>;
}

type Cause = 'mention' | 'follow_up';
type Reply = {
  channel: Channel;
  cause: Cause;
  request: SeatRequest;
  trigger: Post;
  rootId: string;
  buddyId: string;
  /** '' for the first reply to a trigger; a retry's own suffix keeps its failure notice apart. */
  attempt: string;
};
type FollowUp = { channel: Channel; trigger: Post; root: Post; buddyId: string; others: string[] };

export type Channels = ReturnType<typeof createChannels>;

export function createChannels(ports: ChannelsPorts) {
  const { core } = ports;
  const logger = ports.logger ?? console;
  const queues = new Map<string, Omit<ChannelResponse, 'state'> & { tail: Promise<void> }>();
  const gating = new Set<string>();
  const deferred = new Map<string, FollowUp>();
  const queuedForSlot = new Set<string>();
  const contextReadAt = new Map<string, string>();
  const seenThrough = new Map<string, string>();
  const pairKey = (rootId: string, buddyId: string) => `${rootId}:${buddyId}`;
  const busy = (key: string) => gating.has(key) || queues.has(key);

  async function names(workspaceId: string): Promise<Names> {
    return new Map((await core.listBuddies(workspaceId)).map((buddy) => [buddy.id, buddy.name]));
  }

  async function eligible(
    buddyId: string,
    workspaceId: string
  ): Promise<{ ok: true; buddy: Buddy } | { ok: false; reason: string }> {
    const buddy = await core.getBuddy(buddyId).catch(() => null);
    if (buddy?.status !== 'active') return { ok: false, reason: 'Buddy is not active' };
    if (buddy.workspaceId !== workspaceId)
      return { ok: false, reason: 'Buddy is outside this workspace' };
    return { ok: true, buddy };
  }

  /** Every post in a thread, root first (keyset pages, newest first, reversed). */
  async function wholeThread(root: Post): Promise<Post[]> {
    const replies: Post[] = [];
    let before: Cursor | undefined;
    for (;;) {
      const page = await core.listPosts(
        OWNER,
        { kind: 'thread', rootId: root.id },
        before,
        THREAD_PAGE
      );
      replies.push(...page.posts);
      if (!page.next) return [root, ...replies.reverse()];
      before = page.next;
    }
  }

  function tail(thread: Post[], trigger: Post) {
    const replies = thread.slice(1).filter((post) => post.id !== trigger.id);
    const shown = replies.slice(-CONTEXT_POSTS);
    return { root: thread[0], omitted: replies.length - shown.length, shown };
  }

  function headline(cause: Cause, where: string): string {
    switch (cause) {
      case 'mention':
        return `The owner mentioned you in ${where}`;
      case 'follow_up':
        return `A new message arrived in ${where} you have posted in, and you chose to reply`;
    }
  }

  async function prompt(input: Reply, context: string[], nameMap: Names): Promise<string> {
    return [
      ...context,
      '',
      'Each line shows its post id. Read more with channel_read({read:{threadId}}) or channel_read({read:{channelId}, before}) only when the reply needs it.',
      '',
      `Reply to the latest message, from ${label(input.trigger.author, nameMap)}:`,
      readableChannelText(input.trigger.body),
      '',
      `Nobody reads your text output: it is a private scratchpad, use it to think. People only see what you post in this thread. Post with post({ channel: { id: "${input.channel.id}" }, replyToId: "${input.rootId}", purpose: "reply", body, key }). You may post more than once: a short progress note, then the result. Write posts direct and concise, as markdown. Embed media as ![alt](/absolute/path); reference a task as [title](task:<id>). Put anything long in a file or a Task and link it. If this turn ends without a post, the thread gets a failure notice, not your scratchpad. If it needs real work, do it or hand it off, then post what you did.`,
    ].join('\n');
  }

  // A resumed seat already holds every post up to the trigger it last answered, so it gets only
  // what arrived since; a fresh session gets the whole context. The runtime picks between them
  // as it admits the turn (a changed audience starts a fresh session there). 2026-09-25: a delta
  // reached a fresh session, which then saw "Replies since then (0)" and no thread at all.
  async function seatPrompt(input: Reply, seatId: string): Promise<SessionRelativePrompt> {
    const nameMap = await names(input.channel.workspaceId);
    const where = `#${input.channel.kind.type === 'public' ? input.channel.kind.name : input.channel.id} (channel ${input.channel.id})`;
    if (input.trigger.rootId === undefined || input.trigger.rootId === null) {
      const page = await core.listPosts(
        OWNER,
        { kind: 'channel', channelId: input.channel.id },
        null,
        CONTEXT_POSTS + 1
      );
      const posts = page.posts
        .filter((post) => post.id !== input.trigger.id)
        .slice(0, CONTEXT_POSTS)
        .reverse();
      const text = await prompt(
        input,
        [
          `${headline(input.cause, 'a new message')} in ${where}. The ${posts.length} most recent top-level posts, oldest first:`,
          '',
          ...posts.map((p) => transcriptLine(p, nameMap)),
        ],
        nameMap
      );
      return { resumed: text, fresh: text };
    }
    const thread = await wholeThread(await core.getPost(OWNER, input.rootId));
    const context = tail(thread, input.trigger);
    const fresh = await prompt(
      input,
      [
        `${headline(input.cause, 'a thread')} in ${where}. The root, then its most recent replies, oldest first:`,
        '',
        transcriptLine(context.root, nameMap),
        ...(context.omitted > 0 ? [`… ${context.omitted} earlier replies omitted …`] : []),
        ...context.shown.map((p) => transcriptLine(p, nameMap)),
      ],
      nameMap
    );
    const seen = seenThrough.get(seatId);
    if (seen === undefined) return { fresh, resumed: fresh };
    // An anchor that is gone finds -1, so the whole thread counts as unseen: more, never less.
    const unseen = thread
      .slice(thread.findIndex((post) => post.id === seen) + 1)
      .filter((post) => post.id !== input.trigger.id && post.conversationId !== seatId);
    const shown = unseen.slice(-CONTEXT_POSTS);
    const resumed = await prompt(
      input,
      [
        `${headline(input.cause, 'a thread')} in ${where}. You have seen this thread through your last turn. Replies since then, oldest first (${shown.length}):`,
        '',
        ...(unseen.length > shown.length
          ? [`… ${unseen.length - shown.length} earlier new replies omitted …`]
          : []),
        ...shown.map((p) => transcriptLine(p, nameMap)),
      ],
      nameMap
    );
    return { fresh, resumed };
  }

  const profileConfig = (buddy: Buddy) =>
    configFromProviderPreferences(
      buddyExecutionPreferences({
        provider: buddy.provider ?? null,
        model: buddy.model ?? null,
        reasoning_effort: buddy.reasoningEffort ?? null,
      })
    );

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

  async function seatConfig(
    rootId: string,
    buddyId: string,
    request: SeatRequest
  ): Promise<LiveConversation> {
    const seats = await scanGenerations(ports.conversations, (g) =>
      threadConversationId(rootId, buddyId, g)
    );
    return seatFor(request, seats, profileConfig(await core.getBuddy(buddyId)));
  }

  // A failure notice asks nobody to follow up, so it is pushed but not announced as a post.
  async function postFailure(input: Reply, conversationId: string | null, reason: string) {
    await core.post(
      buddyActor(input.buddyId),
      { kind: 'id', id: input.channel.id },
      {
        kind: 'inform',
        evidence: [],
        replyToId: input.trigger.id,
        fromConversationId: conversationId ?? undefined,
        key: `thread-reply:${input.trigger.id}:${input.buddyId}${input.attempt}`,
        purpose: 'reply_failed',
        body: `Couldn’t reply: ${reason}`,
      }
    );
    ports.channelChanged(input.channel.id);
  }

  // What this Buddy posted in the thread since `before` (post ids seen when the turn began),
  // not counting its own failure notices. That is the reply; the text output is not.
  async function postedSince(input: Reply, before: ReadonlySet<string>): Promise<boolean> {
    const thread = await wholeThread(await core.getPost(OWNER, input.rootId));
    return thread.some(
      (post) =>
        !before.has(post.id) &&
        post.author.kind === 'buddy' &&
        post.author.id === input.buddyId &&
        post.purpose !== 'reply_failed'
    );
  }

  function trackRunSlot(
    key: string,
    channelId: string,
    conversation: ConversationRuntime
  ): () => void {
    const started = () => {
      if (queuedForSlot.delete(key)) ports.channelChanged(channelId);
    };
    if (conversation.waitingForRunSlot()) {
      queuedForSlot.add(key);
      ports.channelChanged(channelId);
    }
    conversation.once('buddy-turn-started', started);
    return () => {
      conversation.off('buddy-turn-started', started);
      started();
    };
  }

  // A turn that posted nothing — seat, turn failure, or silence — becomes a visible reply_failed post.
  async function runReply(input: Reply): Promise<void> {
    let conversationId: string | null = null;
    let failure = 'the turn ended without a channel post';
    const before = new Set(
      (await wholeThread(await core.getPost(OWNER, input.rootId))).map((post) => post.id)
    );
    try {
      const seat = await seatConfig(input.rootId, input.buddyId, input.request);
      const conversation = await openConversation(ports.conversations, {
        context: { buddyId: input.buddyId, workspaceId: input.channel.workspaceId },
        conversationId: seat.conversationId,
        commandId: `channel-thread-${seat.conversationId}`,
        config: seat.config,
      });
      conversationId = conversation.id;
      await untilIdle(conversation);
      const key = pairKey(input.rootId, input.buddyId);
      contextReadAt.set(key, new Date().toISOString());
      const seatPromptText = await seatPrompt(input, conversation.id);
      const trigger = await core.getPost(OWNER, input.trigger.id);
      let untrack: () => void = () => undefined;
      await awaitTurn(
        conversation,
        () => {
          conversation.sendSessionRelativeMessage(seatPromptText, seatTurnInput(trigger));
          untrack = trackRunSlot(key, input.channel.id, conversation);
        },
        'Buddy turn failed'
      ).finally(() => untrack());
      seenThrough.set(conversation.id, input.trigger.id);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (await postedSince(input, before)) return;
    await postFailure(input, conversationId, failure);
  }

  function reply(input: Reply): void {
    const key = pairKey(input.rootId, input.buddyId);
    const previous = queues.get(key);
    const tail = (previous?.tail ?? Promise.resolve())
      .then(() => runReply(input))
      .catch((error) => logger.warn(`[channels] reply to ${input.trigger.id} failed:`, error));
    const entry = {
      channelId: input.channel.id,
      threadRootId: input.rootId,
      buddyId: input.buddyId,
      startedAt: previous?.startedAt ?? new Date().toISOString(),
      tail,
    };
    queues.set(key, entry);
    ports.channelChanged(entry.channelId);
    void tail.finally(() => {
      if (queues.get(key) !== entry) return;
      queues.delete(key);
      ports.channelChanged(entry.channelId);
      settle(key);
    });
  }

  function gate(input: FollowUp): void {
    const key = pairKey(input.root.id, input.buddyId);
    if (busy(key)) {
      deferred.set(key, input);
      return;
    }
    gating.add(key);
    void followUp(input)
      .catch((error) => logger.warn(`[channels] follow-up for ${input.buddyId} failed:`, error))
      .finally(() => {
        gating.delete(key);
        settle(key);
      });
  }

  // The pair went idle: gate the post that arrived meanwhile, unless its last reply turn read the
  // thread after it. Until 2026-09-25 such a post was skipped and the owner's message went unanswered.
  function settle(key: string): void {
    const next = deferred.get(key);
    if (next === undefined || busy(key)) return;
    deferred.delete(key);
    if (next.trigger.createdAt <= (contextReadAt.get(key) ?? '')) return;
    gate(next);
  }

  async function followUp(input: FollowUp): Promise<void> {
    const nameMap = await names(input.channel.workspaceId);
    const role = async (id: string) => {
      const buddy = await core.getBuddy(id);
      return `${buddy.name} (${buddy.role})`;
    };
    const thread = await wholeThread(input.root);
    const context = tail(thread, input.trigger);
    const verdict = await ports.gate({
      config: (await seatConfig(input.root.id, input.buddyId, { kind: 'keep' })).config,
      prompt: [
        `You are ${await role(input.buddyId)}, one member of a team in the channel ${input.channel.kind.type === 'public' ? `#${input.channel.kind.name}` : input.channel.id}.`,
        'A new message was just posted in a thread you have posted in. The root, then its most recent replies, oldest first:',
        '',
        transcriptLine(context.root, nameMap),
        ...context.shown.map((p) => transcriptLine(p, nameMap)),
        '',
        `New message, from ${label(input.trigger.author, nameMap)}:`,
        readableChannelText(input.trigger.body),
        '',
        `Also in this thread: the Owner, ${(await Promise.all(input.others.map(role))).join(', ')}.`,
        '',
        'Should you respond, or leave it to another team member? Say yes only when the thread needs something from you specifically: a question aimed at you or your role, a correction only you can make, or work you own. Do not reply just to acknowledge or agree.',
        '',
        'Answer with exactly <yes> or <no> and nothing else.',
      ].join('\n'),
    });
    switch (verdict.kind) {
      case 'respond':
        return reply({
          channel: input.channel,
          cause: 'follow_up',
          request: { kind: 'keep' },
          trigger: input.trigger,
          rootId: input.root.id,
          buddyId: input.buddyId,
          attempt: '',
        });
      case 'pass':
        return;
      case 'unparseable':
        logger.warn(
          `[channels] ${input.buddyId} gave no <yes>/<no> for post ${input.trigger.id}: ${JSON.stringify(verdict.output)}`
        );
        return;
      // The owner waits on an answer, so a gate that could not run is shown in the thread
      // (2026-09-24: every gate failed on a Codex usage limit and threads just stayed quiet).
      case 'failed':
        logger.warn(
          `[channels] reply gate failed for ${input.buddyId} on post ${input.trigger.id}: ${verdict.reason}`
        );
        if (input.trigger.author.kind === 'owner')
          await postFailure(
            {
              channel: input.channel,
              cause: 'follow_up',
              request: { kind: 'keep' },
              trigger: input.trigger,
              rootId: input.root.id,
              buddyId: input.buddyId,
              attempt: '',
            },
            null,
            `could not decide whether to reply (${verdict.reason})`
          );
    }
  }

  async function directConversation(buddyId: string): Promise<ConversationRuntime> {
    const buddy = await core.getBuddy(buddyId);
    const admitted = await eligible(buddyId, buddy.workspaceId);
    if (!admitted.ok) throw new Error(admitted.reason);
    const { current, next } = await scanGenerations(ports.conversations, (g) =>
      directConversationId(buddy.workspaceId, buddyId, g)
    );
    const conversationId = current?.conversationId ?? next;
    return openConversation(ports.conversations, {
      context: { buddyId, workspaceId: buddy.workspaceId },
      conversationId,
      commandId: `buddy-dm-${conversationId}`,
      config: current?.config,
    });
  }

  /** Ask every other Buddy who posted in this post's thread whether to follow up. */
  async function considerThreadPost(channel: Channel, post: Post): Promise<void> {
    if (!post.rootId) return;
    const thread = await wholeThread(await core.getPost(OWNER, post.rootId));
    // Only the newest post is followed up: a burst is gated once, against the latest message.
    if (thread[thread.length - 1].id !== post.id) return;
    let chain = 0;
    for (let i = thread.length - 1; i >= 0 && thread[i].author.kind === 'buddy'; i--) chain++;
    if (chain >= MAX_BUDDY_CHAIN) return;
    const skipped = new Set([
      ...buddyAuthor(post),
      ...(post.author.kind === 'owner' ? mentionedBuddyIds(post.body) : []),
    ]);
    const replying = [...queues.values()]
      .filter((entry) => entry.threadRootId === post.rootId)
      .map((entry) => entry.buddyId);
    const participants = [...new Set([...thread.flatMap(buddyAuthor), ...replying])];
    for (const buddyId of participants) {
      if (skipped.has(buddyId) || !(await eligible(buddyId, channel.workspaceId)).ok) continue;
      gate({
        channel,
        trigger: post,
        root: thread[0],
        buddyId,
        others: participants.filter((other) => other !== buddyId),
      });
    }
  }

  // Every post, from any writer (tool, route, runner, this responder), pushes its channel; a post
  // in a public channel's thread asks the other Buddies there whether to follow up. A DM request
  // needs no gate: the core already queued the recipient's run.
  ports.events.on((event) => {
    if (event.kind !== 'posted') return;
    ports.channelChanged(event.channel.id);
    if (event.channel.kind.type !== 'public') return;
    void considerThreadPost(event.channel, event.post).catch((error) =>
      logger.warn(`[channels] follow-up gating failed for post ${event.post.id}:`, error)
    );
  });

  return {
    /** One reply per valid @mention in an OWNER post, in the Buddy's seat for this thread. */
    async respondToOwnerPost(
      channel: Channel,
      post: Post,
      chosen: ReadonlyMap<string, ConversationConfig>
    ): Promise<MentionDispatch[]> {
      return Promise.all(
        mentionedBuddyIds(post.body).map(async (buddyId): Promise<MentionDispatch> => {
          const admitted = await eligible(buddyId, channel.workspaceId);
          if (!admitted.ok) return { buddyId, status: 'rejected', reason: admitted.reason };
          const config = chosen.get(buddyId);
          reply({
            channel,
            cause: 'mention',
            request: config ? { kind: 'chosen', config } : { kind: 'keep' },
            trigger: post,
            rootId: rootOf(post),
            buddyId,
            attempt: '',
          });
          return { buddyId, status: 'started' };
        })
      );
    },

    considerThreadPost,

    /**
     * Each thread Buddy's latest seat (harness, model, reasoning): the one its next reply runs
     * on. The mention chip opens on it; until 493c1c7 it showed the profile default, which is
     * wrong once an earlier pick made the seat. A Buddy with no seat yet is omitted (its first
     * reply runs on the profile default, which the client already has).
     */
    async threadSeats(rootId: string): Promise<ThreadSeat[]> {
      const root = await core.getPost(OWNER, rootId);
      if (root.rootId) return [];
      const buddyIds = new Set<string>();
      for (const post of await wholeThread(root)) {
        for (const id of buddyAuthor(post)) buddyIds.add(id);
        if (post.author.kind === 'owner')
          for (const id of mentionedBuddyIds(post.body)) buddyIds.add(id);
      }
      const seats: ThreadSeat[] = [];
      for (const buddyId of buddyIds) {
        const { current } = await scanGenerations(ports.conversations, (g) =>
          threadConversationId(rootId, buddyId, g)
        );
        if (current) seats.push({ buddyId, config: current.config });
      }
      return seats;
    },

    /** Buddies composing a reply in this channel, for "X is replying…". */
    responding(channelId: string): ChannelResponse[] {
      return [...queues.entries()]
        .filter(([, entry]) => entry.channelId === channelId)
        .map(([key, { tail: _tail, ...response }]) => ({
          ...response,
          state: queuedForSlot.has(key) ? 'queued' : 'replying',
        }));
    },

    /**
     * Rerun a reply whose HARNESS failed (out of tokens, a provider error) on the harness the owner
     * picks, in a new seat; the failure notice stays and the new attempt is a later reply. A started
     * session cannot change provider, so the harness that failed is refused (493c1c7).
     */
    async retryReply(failed: Post, config: ConversationConfig): Promise<MentionDispatch> {
      if (failed.purpose !== 'reply_failed' || failed.author.kind !== 'buddy' || !failed.replyToId)
        throw new Error('Only a failed Buddy reply can be retried');
      if (!isHarnessRetryFailure(failed.body))
        throw new Error('Only an out-of-tokens or provider-error failure can be retried');
      const buddyId = failed.author.id;
      const channel = await core.openChannel(OWNER, { kind: 'id', id: failed.channelId });
      const admitted = await eligible(buddyId, channel.workspaceId);
      if (!admitted.ok) return { buddyId, status: 'rejected', reason: admitted.reason };
      const trigger = await core.getPost(OWNER, failed.replyToId);
      const rootId = rootOf(trigger);
      // The harness that failed: the seat that wrote the notice, else (a gate failure) the seat.
      const slot = failed.conversationId
        ? await ports.conversations.slot(failed.conversationId)
        : ({ kind: 'absent' } as const);
      const failedProvider =
        slot.kind === 'live'
          ? slot.config.provider
          : (await seatConfig(rootId, buddyId, { kind: 'keep' })).config.provider;
      if (config.provider === failedProvider)
        throw new Error(`Pick a different harness. ${failedProvider} is the one that failed.`);
      reply({
        channel,
        cause:
          trigger.author.kind === 'owner' && mentionedBuddyIds(trigger.body).includes(buddyId)
            ? 'mention'
            : 'follow_up',
        request: { kind: 'chosen', config },
        trigger,
        rootId,
        buddyId,
        attempt: `:retry:${randomUUID()}`,
      });
      return { buddyId, status: 'started' };
    },

    /** The owner's DM generations with a Buddy, oldest first; the newest is the current chat. */
    async directChain(buddyId: string): Promise<{ buddyId: string; generations: string[] }> {
      const buddy = await core.getBuddy(buddyId);
      return {
        buddyId,
        generations: await liveGenerations(ports.conversations, (g) =>
          directConversationId(buddy.workspaceId, buddyId, g)
        ),
      };
    },

    /**
     * "New chat" in a DM: the next generation, with no handoff. Earlier ones stay live, so the DM
     * shows them above a divider. `config` defaults to the current chat's; with `message` it is the
     * out-of-tokens retry, which must move to another harness and resends the owner's message.
     */
    async newDirect(
      buddyId: string,
      input: { config?: ConversationConfig; message?: string }
    ): Promise<{ conversationId: string }> {
      const buddy = await core.getBuddy(buddyId);
      const admitted = await eligible(buddyId, buddy.workspaceId);
      if (!admitted.ok) throw new Error(admitted.reason);
      const { current, next } = await scanGenerations(ports.conversations, (g) =>
        directConversationId(buddy.workspaceId, buddyId, g)
      );
      if (input.message && input.config?.provider === current?.config.provider)
        throw new Error(
          `Pick a different harness. ${input.config?.provider} is the one that failed.`
        );
      const conversation = await openConversation(ports.conversations, {
        context: { buddyId, workspaceId: buddy.workspaceId },
        conversationId: next,
        commandId: `buddy-dm-${next}`,
        config: input.config ?? current?.config,
      });
      if (input.message)
        conversation.enqueueMessage(input.message, {
          origin: 'owner_input',
          inputId: `retry-${randomUUID()}`,
        });
      return { conversationId: conversation.id };
    },

    /** The owner's ongoing chat with a Buddy (not a channel DM): open it. */
    async openDirect(buddyId: string): Promise<{ conversationId: string }> {
      return { conversationId: (await directConversation(buddyId)).id };
    },

    /** Queue the wake-up check in that chat, after any turn already running there. */
    async wake(buddyId: string): Promise<{ conversationId: string }> {
      const conversation = await directConversation(buddyId);
      conversation.enqueueMessage(WAKE_MESSAGE, {
        origin: 'owner_input',
        inputId: `wake-${randomUUID()}`,
      });
      return { conversationId: conversation.id };
    },
  };
}

// A seat is also an ordinary chat: the owner may be typing in it.
async function untilIdle(conversation: ConversationRuntime): Promise<void> {
  while (
    conversation.isRunning ||
    conversation.hasActiveProcess() ||
    conversation.queue.length > 0
  ) {
    await conversation.waitForTurnDrain();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
