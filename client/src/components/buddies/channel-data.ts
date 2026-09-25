/**
 * client/src/components/buddies/channel-data.ts
 *
 * Channel data shared by the desktop channel browser and the mobile channel
 * screens: resource URLs, transcript rows, the workspace directory (members,
 * Tasks, @ references) and who is replying. No JSX, no CSS — mobile may import
 * it (gate G3 allows components/buddies/).
 */
import {
  type BuddyChannelThread,
  BuddyChannelThreadSchema,
  type BuddyListAuthor,
  type BuddyMailingListPost,
  BuddyMailingListPostsSchema,
  type BuddyMemberExecution,
  type BuddyWorkspaceActivity,
  BuddyWorkspaceActivitySchema,
  type OwnerChannelUnread,
  OwnerChannelUnreadSchema,
  type OwnerListUnread,
  type OwnerReadThrough,
  isAfterReadThrough,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type UIEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type OutboxEntry, channelOutboxAtom, outboxDrop } from '../../atoms/channel-outbox';
import { warmResources } from '../../atoms/prefetch';
import { seedResource } from '../../atoms/resources';
import { type PolledState, resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { buddyApi } from './api';
import { type ChannelReference, type ChannelTask, workspaceTasksUrl } from './channel-text';

export function workspaceActivityResource(workspaceId: string) {
  const path = `/api/buddies/workspaces/${encodeURIComponent(workspaceId)}/activity`;
  return resource(path, async (signal: AbortSignal) => {
    const response = await fetch(path, { signal });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        payload.error ?? `Unable to load workspace activity (HTTP ${response.status})`
      );
    }
    return BuddyWorkspaceActivitySchema.parse(await response.json());
  });
}

export interface BuddyMailingListSummary {
  id: string;
  workspaceId: string;
  name: string;
  purpose: string;
  createdBy: BuddyListAuthor;
  createdAt: string;
  postCount: number;
  latestPostAt: string | null;
}

export function authorKey(author: BuddyListAuthor): string {
  switch (author.kind) {
    case 'owner':
      return 'owner';
    case 'buddy':
      return author.buddyId;
  }
}

// Channels are pushed, not polled: the server's `channel_changed` (a post, or
// who is replying) and `buddies_changed` (any other write) refresh exactly the
// views they touch, and a reconnect or a tab returning to view refreshes
// everything. This poll is only a backstop for a lost push.
export const CHANNEL_BACKSTOP_MS = 30_000;

export function listsUrl(workspaceId: string): string {
  return `/api/buddies/lists?workspaceId=${encodeURIComponent(workspaceId)}`;
}

/** Posts per page read; the newest page is what every channel warms. */
export const CHANNEL_PAGE = 50;

// What a feed reads: D = Latest ⊕ From(floor).
// Latest is the newest page. Once the reader pages back, the feed reads from
// its oldest loaded post (the floor) to the newest instead. Re-reading the
// newest page would slide the window: every new post would push the oldest
// one out above the reader, and open a gap between it and the history they
// loaded. `complete`: the floor is the feed's first post.
export type ChannelRange = { kind: 'latest' } | { kind: 'from'; floor: string; complete: boolean };

const LATEST_RANGE: ChannelRange = { kind: 'latest' };

// Where a feed's posts sit in its answer. Every post read parses here: the
// fetch boundary checks the v33 wire shape once, so a stale or foreign server
// surfaces as the view's refresh error instead of a crash (or a silent
// "Unknown") deep in rendering.
type FeedWindow<V> = {
  parse(json: unknown): V;
  posts(value: V): readonly BuddyMailingListPost[];
  withOlder(value: V, older: readonly BuddyMailingListPost[]): V;
};

// A channel's or a Task's answer is its posts.
const POSTS: FeedWindow<BuddyMailingListPost[]> = {
  parse: (json) => BuddyMailingListPostsSchema.parse(json),
  posts: (posts) => posts,
  withOlder: (posts, older) => [...posts, ...older],
};

// A thread's answer is its root beside the replies read.
const THREAD: FeedWindow<BuddyChannelThread> = {
  parse: (json) => BuddyChannelThreadSchema.parse(json),
  posts: (thread) => thread.replies,
  withOlder: (thread, older) => ({ ...thread, replies: [...thread.replies, ...older] }),
};

/**
 * A feed the owner reads, paged by keyset: D = Channel ⊕ Task ⊕ Thread
 * (server/src/buddies/channel-pages.ts OwnerFeed). Every feed route answers
 * the same query, newest-first: the newest page (`limit`), the page before a
 * post (`before`), or a post and everything newer (`from`). So a feed is only
 * its URL up to that query (`query`, ending in `?` or `&`), where its posts
 * sit in the answer, and the range it opens on.
 */
export type PostFeed<V> = { query: string; window: FeedWindow<V>; opens: ChannelRange };

export function channelPostFeed(listId: string): PostFeed<BuddyMailingListPost[]> {
  return {
    query: `/api/buddies/lists/${encodeURIComponent(listId)}/posts?`,
    window: POSTS,
    opens: LATEST_RANGE,
  };
}

// A Task filter reads the workspace-wide feed so one Task's discussion is
// visible across every channel, not just the selected one.
export function taskPostFeed(
  workspaceId: string,
  projectId: string
): PostFeed<BuddyMailingListPost[]> {
  return {
    query: `/api/buddies/posts?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&`,
    window: POSTS,
    opens: LATEST_RANGE,
  };
}

// A thread opens on its newest replies, or from the reply a permalink names
// (`post=`) so that reply renders however far back it is; whether it is the
// first reply shows when the page before it comes back empty. Opening on the
// newest 50 alone would leave an older linked reply unrendered, unscrolled-to.
export function threadPostFeed(
  listId: string,
  rootId: string,
  linkedPostId: string | null
): PostFeed<BuddyChannelThread> {
  return {
    query: `/api/buddies/lists/${encodeURIComponent(listId)}/threads/${encodeURIComponent(rootId)}?`,
    window: THREAD,
    opens:
      linkedPostId === null ? LATEST_RANGE : { kind: 'from', floor: linkedPostId, complete: false },
  };
}

function rangeQuery(range: ChannelRange): string {
  switch (range.kind) {
    case 'latest':
      return `limit=${CHANNEL_PAGE}`;
    case 'from':
      return `from=${encodeURIComponent(range.floor)}`;
  }
}

function feedResource<V>(feed: PostFeed<V>, range: ChannelRange) {
  const url = `${feed.query}${rangeQuery(range)}`;
  return resource(url, async (signal: AbortSignal) =>
    feed.window.parse(await buddyApi(url, { signal }))
  );
}

export function channelPostsResource(listId: string) {
  return feedResource(channelPostFeed(listId), LATEST_RANGE);
}

// The top of a feed: D = More ⊕ Loading ⊕ Failed ⊕ Complete.
export type OlderEdge =
  | { kind: 'more' }
  | { kind: 'loading' }
  | { kind: 'failed'; error: Error }
  | { kind: 'complete' };

type OlderRequest = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed'; error: Error };

const IDLE_REQUEST: OlderRequest = { kind: 'idle' };
const LOADING_REQUEST: OlderRequest = { kind: 'loading' };
const NO_POSTS: readonly BuddyMailingListPost[] = [];

function olderEdge(
  range: ChannelRange,
  request: OlderRequest,
  posts: readonly BuddyMailingListPost[]
): OlderEdge {
  switch (request.kind) {
    case 'idle':
      return settledEdge(range, posts);
    case 'loading':
    case 'failed':
      return request;
  }
}

// A newest page shorter than a full page is the whole feed.
function settledEdge(range: ChannelRange, posts: readonly BuddyMailingListPost[]): OlderEdge {
  switch (range.kind) {
    case 'latest':
      return { kind: posts.length < CHANNEL_PAGE ? 'complete' : 'more' };
    case 'from':
      return { kind: range.complete ? 'complete' : 'more' };
  }
}

// Paging belongs to the feed it paged (its `query`). A pane switched to
// another feed, another Task in the filter, starts that one where it opens
// instead of asking it for the last feed's floor, which it would refuse.
type Paging = { query: string | null; range: ChannelRange; request: OlderRequest };

function opening<V>(feed: PostFeed<V> | null): Paging {
  return feed === null
    ? { query: null, range: LATEST_RANGE, request: IDLE_REQUEST }
    : { query: feed.query, range: feed.opens, request: IDLE_REQUEST };
}

/**
 * One feed's posts, newest-first, with history on demand; `null` reads
 * nothing (no Task filtered). `loadOlder` reads the page before the oldest
 * post held and moves the feed to a From range covering it, seeded with what
 * it already holds so the switch renders at once. `beforePrepend` runs just
 * before the older rows render above the reader (useFollowBottom's `hold`).
 */
export function useChannelFeed<V>(feed: PostFeed<V> | null) {
  const opened = opening(feed);
  const [held, setHeld] = useState(opened);
  const paging = held.query === opened.query ? held : opened;
  const view = usePolledFetch(
    feed === null ? null : feedResource(feed, paging.range),
    CHANNEL_BACKSTOP_MS
  );
  const posts = feed === null || view.data === null ? NO_POSTS : feed.window.posts(view.data);
  const edge = olderEdge(paging.range, paging.request, posts);
  const loadOlder = async (beforePrepend: () => void) => {
    const shown = view.data;
    const oldest = posts[posts.length - 1];
    if (feed === null || shown === null || !oldest) return;
    if (edge.kind === 'loading' || edge.kind === 'complete') return;
    setHeld({ ...paging, request: LOADING_REQUEST });
    try {
      const page = feed.window.posts(
        feed.window.parse(
          await buddyApi(
            `${feed.query}before=${encodeURIComponent(oldest.id)}&limit=${CHANNEL_PAGE}`
          )
        )
      );
      const next: ChannelRange = {
        kind: 'from',
        floor: (page[page.length - 1] ?? oldest).id,
        complete: page.length < CHANNEL_PAGE,
      };
      if (page.length > 0) beforePrepend();
      seedResource(feedResource(feed, next), feed.window.withOlder(shown, page));
      setHeld({ query: feed.query, range: next, request: IDLE_REQUEST });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setHeld({ ...paging, request: { kind: 'failed', error } });
    }
  };
  return { feed: view, edge, loadOlder };
}

/**
 * Warm every channel's posts at idle once the rail knows them, so switching
 * to a channel for the first time renders from cache like switching back does.
 * Keyed on the id set, not the polled array, so a poll does not re-schedule.
 */
export function useWarmChannelPosts(lists: readonly { id: string }[] | null): void {
  const ids = lists?.map((list) => list.id).join('\n') ?? '';
  useEffect(() => {
    if (ids) warmResources(ids.split('\n').map(channelPostsResource));
  }, [ids]);
}

export function respondingUrl(listId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/responding`;
}

// Every workspace member names posts (archived authors included); only active
// ones appear in the rail and the @ menu.
export type ChannelMember = {
  id: string;
  name: string;
  role: string;
  status: string;
  execution: BuddyMemberExecution;
};

// 'queued': the reply waits for a free slot under the Buddy's run limit
// (server channel-responder.ts). Optional on the wire: a backend that has not
// reloaded yet sends rows without it, and those are all replying.
export type ChannelResponse = {
  threadRootId: string;
  buddyId: string;
  state?: 'replying' | 'queued';
};

// =============================================================================
// Transcript rows: D = Day ⊕ Lead ⊕ Continuation.
// A Lead opens a sender run (avatar + name); a Continuation is a later post by
// the same instance (Buddy AND conversation) within GROUP_WINDOW_MS, so two
// concurrent conversations running as one Buddy never merge into one run.
// =============================================================================
export type ChannelRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'lead'; key: string; post: BuddyMailingListPost }
  | { kind: 'continuation'; key: string; post: BuddyMailingListPost };

const GROUP_WINDOW_MS = 5 * 60_000;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function sameInstance(a: BuddyMailingListPost, b: BuddyMailingListPost): boolean {
  return (
    authorKey(a.author) === authorKey(b.author) && a.senderConversationId === b.senderConversationId
  );
}

/**
 * `posts` (one channel's roots, or one thread's replies) plus the owner's
 * posts the server has not returned yet (atoms/channel-outbox.ts), so Send
 * shows the message at once. Entries a refetch now includes leave the outbox.
 * `null` stays `null`: nothing loaded yet is not the same as no posts.
 */
export function useWithOutbox(
  workspaceId: string,
  listId: string,
  threadRootId: string | null,
  posts: readonly BuddyMailingListPost[] | null
): readonly BuddyMailingListPost[] | null {
  const outbox = useAtomValue(channelOutboxAtom);
  const served = useMemo(() => new Set(posts?.map((post) => post.id)), [posts]);
  const pending = useMemo(
    () =>
      outbox.flatMap((entry): BuddyMailingListPost[] => {
        const post = outboxPost(workspaceId, entry);
        return post.listId === listId && post.threadRootId === threadRootId && !served.has(post.id)
          ? [post]
          : [];
      }),
    [outbox, workspaceId, listId, threadRootId, served]
  );
  const confirmed = useMemo(
    () =>
      outbox.flatMap((entry) =>
        entry.kind === 'sent' && served.has(entry.post.id) ? [entry.key] : []
      ),
    [outbox, served]
  );
  useEffect(() => {
    if (confirmed.length > 0) outboxDrop(new Set(confirmed));
  }, [confirmed]);
  return useMemo(() => (posts === null ? null : [...pending, ...posts]), [pending, posts]);
}

function outboxPost(workspaceId: string, entry: OutboxEntry): BuddyMailingListPost {
  switch (entry.kind) {
    case 'sent':
      return entry.post;
    case 'sending':
      return {
        id: `outbox:${entry.key}`,
        listId: entry.listId,
        workspaceId,
        author: { kind: 'owner' },
        threadRootId: entry.threadRootId,
        replyCount: 0,
        latestReplyAt: null,
        purpose: 'message',
        body: entry.body,
        evidence: [],
        projectId: null,
        createdAt: entry.createdAt,
        senderConversationId: null,
        senderRunId: null,
      };
  }
}

// Posts arrive newest-first; a Slack transcript reads oldest-first with the
// newest message at the bottom, next to the composer.
export function channelRows(newestFirst: readonly BuddyMailingListPost[]): ChannelRow[] {
  const posts = [...newestFirst].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const rows: ChannelRow[] = [];
  let previous: BuddyMailingListPost | null = null;
  for (const post of posts) {
    const newDay = previous === null || dayKey(previous.createdAt) !== dayKey(post.createdAt);
    if (newDay) {
      rows.push({
        kind: 'day',
        key: `day:${dayKey(post.createdAt)}`,
        label: new Date(post.createdAt).toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }),
      });
    }
    const continues =
      previous !== null &&
      !newDay &&
      sameInstance(previous, post) &&
      new Date(post.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
    rows.push({ kind: continues ? 'continuation' : 'lead', key: post.id, post });
    previous = post;
  }
  return rows;
}

// What a feed pane shows: D = Loading ⊕ Failed ⊕ Empty ⊕ Posts.
// `rows.length === 0` alone conflated "never loaded" with "loaded, no posts",
// so every cold channel said "No posts yet" and then flashed its posts in.
export type FeedPhase = 'loading' | 'failed' | 'empty' | 'posts';

export function feedPhase(feed: {
  kind: PolledState<unknown>['kind'];
  data: readonly unknown[] | null;
}): FeedPhase {
  if (feed.data === null) return feed.kind === 'failed' ? 'failed' : 'loading';
  return feed.data.length === 0 ? 'empty' : 'posts';
}

/** Thin dispatcher: one handler per phase, exhaustive by the Record type. */
export function renderFeed<R>(phase: FeedPhase, handlers: Record<FeedPhase, () => R>): R {
  return handlers[phase]();
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function joinNames(names: readonly string[]): string {
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Conversational purposes read as plain chat; every other purpose (standup,
// handoff, decision, reply_failed…) is a label worth showing.
export const CONVERSATIONAL_PURPOSES: ReadonlySet<string> = new Set(['message', 'reply']);

// A post's purpose as UI: the raw tag (styling hook, e.g. reply_failed) and the
// label to show, which is null for plain conversation. Kept here so the mobile
// tree never reads a raw `.purpose` (gate G2 guards Conversation.purpose there).
export function postPurposeTag(post: BuddyMailingListPost): string {
  return post.purpose;
}

export function postPurposeLabel(post: BuddyMailingListPost): string | null {
  return CONVERSATIONAL_PURPOSES.has(post.purpose) ? null : post.purpose.replaceAll('_', ' ');
}

const TASK_STATUS_LABELS: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

// The universal @ menu: active Buddies and every non-cancelled Task; the fuzzy
// ranker orders them together by match quality.
export function channelReferences(
  members: readonly ChannelMember[],
  tasks: readonly ChannelTask[]
): ChannelReference[] {
  return [
    ...members
      .filter((member) => member.status === 'active')
      .map(
        (member): ChannelReference => ({
          kind: 'buddy',
          id: member.id,
          label: member.name,
          detail: member.role,
          execution: member.execution,
        })
      ),
    ...tasks
      .filter((task) => task.status !== 'cancelled')
      .map(
        (task): ChannelReference => ({
          kind: 'task',
          id: task.id,
          label: task.title,
          status: task.status,
          detail: `${TASK_STATUS_LABELS[task.status] ?? task.status} · ${task.ownerName}`,
        })
      ),
  ];
}

export type WorkspaceDirectory = {
  workspaceName: string;
  members: readonly ChannelMember[];
  activeMembers: readonly ChannelMember[];
  tasks: readonly ChannelTask[];
  buddyNames: Readonly<Record<string, string>>;
  taskById: ReadonlyMap<string, ChannelTask>;
  references: readonly ChannelReference[];
};

const NO_TASKS: readonly ChannelTask[] = [];

/** Members, Tasks and the @ index for one workspace, polled and cached. */
export function useWorkspaceDirectory(workspaceId: string): WorkspaceDirectory {
  const loadActivity = useMemo(() => workspaceActivityResource(workspaceId), [workspaceId]);
  const activity = usePolledFetch<BuddyWorkspaceActivity>(loadActivity, 10_000);
  const tasksFeed = usePolledFetch<ChannelTask[]>(workspaceTasksUrl(workspaceId), 15_000);
  const tasks = tasksFeed.data ?? NO_TASKS;
  return useMemo(() => {
    const members = (activity.data?.members ?? []).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      status: member.status,
      execution: member.execution,
    }));
    return {
      workspaceName: activity.data?.workspace.name ?? 'Channels',
      members,
      activeMembers: members.filter((member) => member.status === 'active'),
      tasks,
      buddyNames: Object.fromEntries(members.map((member) => [member.id, member.name])),
      taskById: new Map(tasks.map((task) => [task.id, task])),
      references: channelReferences(members, tasks),
    };
  }, [activity.data, tasks]);
}

/**
 * "Ada is replying…", "Ada is queued at the run limit…", or both, per thread root.
 * A root nobody is answering has no entry.
 */
export function respondingText(
  rows: readonly ChannelResponse[],
  buddyNames: Readonly<Record<string, string>>
): ReadonlyMap<string, string> {
  const byRoot = new Map<string, { replying: string[]; queued: string[] }>();
  for (const row of rows) {
    const entry = byRoot.get(row.threadRootId) ?? { replying: [], queued: [] };
    entry[row.state ?? 'replying'].push(buddyNames[row.buddyId] ?? row.buddyId);
    byRoot.set(row.threadRootId, entry);
  }
  const phrase = (names: string[], verb: string) =>
    names.length === 0 ? [] : [`${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} ${verb}`];
  return new Map(
    [...byRoot].map(([root, { replying, queued }]) => [
      root,
      [...phrase(replying, 'replying…'), ...phrase(queued, 'queued at the run limit…')].join(' · '),
    ])
  );
}

/** Who is composing a reply, as display text by thread root. */
export function useChannelResponding(
  listId: string,
  buddyNames: Readonly<Record<string, string>>
): ReadonlyMap<string, string> {
  const responding = usePolledFetch<ChannelResponse[]>(respondingUrl(listId), CHANNEL_BACKSTOP_MS);
  return useMemo(
    () => respondingText(responding.data ?? [], buddyNames),
    [responding.data, buddyNames]
  );
}

// Pin to the newest message on open, and keep following new posts only while
// the reader is already at the bottom — never yank someone reading history
// back down on a poll.
//
// `linkedPostId` is the post a permalink named (channel-link.ts `post=`):
// once its row renders, scroll it into view instead — once, so a poll never
// drags the reader back to it — and stop following the bottom.
export function useFollowBottom(rowCount: number, version: unknown, linkedPostId: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const revealedRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the re-pin trigger
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || rowCount === 0) return;
    const linked =
      linkedPostId !== null && revealedRef.current !== linkedPostId
        ? node.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(linkedPostId)}"]`)
        : null;
    if (linked) {
      revealedRef.current = linkedPostId;
      followRef.current = false;
      // Scroll only this pane; scrollIntoView would also scroll its ancestors.
      node.scrollTop +=
        linked.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        node.clientHeight / 4;
      return;
    }
    if (followRef.current) node.scrollTop = node.scrollHeight;
  }, [rowCount, version, linkedPostId]);
  // Older posts render ABOVE the reader (useChannelFeed's loadOlder). Keep
  // their distance from the bottom across that render, or the page they were
  // reading jumps down by everything that loaded. A layout effect, so the
  // restored position is the first one painted.
  const heldRef = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rowCount is the prepend trigger
  useLayoutEffect(() => {
    const node = scrollRef.current;
    const held = heldRef.current;
    if (!node || held === null) return;
    heldRef.current = null;
    node.scrollTop = node.scrollHeight - held;
  }, [rowCount]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };
  const pin = () => {
    followRef.current = true;
  };
  const hold = () => {
    const node = scrollRef.current;
    if (node) heldRef.current = node.scrollHeight - node.scrollTop;
  };
  return { scrollRef, onScroll, pin, hold };
}

/** Create a channel as the owner; resolves to the new list id. */
export async function createChannel(
  workspaceId: string,
  name: string,
  purpose: string
): Promise<string> {
  const result = await buddyApi<{ list: { id: string } }>('/api/buddies/lists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, author: { kind: 'owner' }, key: newId(), name, purpose }),
  });
  return result.list.id;
}

// ── Owner unread (server/src/buddies/owner-channel-reads.ts) ──────────────
// The owner's own read marks, separate from every Buddy's. One resource for
// every workspace: the rail, the sidebar, the mobile tab and the tab title all
// read it, and `channel_changed` refreshes it (atoms/resources.ts).

export const OWNER_UNREAD_PATH = '/api/buddies/channels/unread';

export function useOwnerUnread() {
  return usePolledFetch(
    resource(OWNER_UNREAD_PATH, async (signal: AbortSignal) =>
      OwnerChannelUnreadSchema.parse(await buddyApi(OWNER_UNREAD_PATH, { signal }))
    ),
    CHANNEL_BACKSTOP_MS
  );
}

const NO_LIST_UNREAD: ReadonlyMap<string, OwnerListUnread> = new Map();

export function ownerUnreadByList(
  unread: OwnerChannelUnread | null,
  workspaceId: string
): ReadonlyMap<string, OwnerListUnread> {
  const workspace = unread?.workspaces.find((entry) => entry.workspaceId === workspaceId);
  return workspace ? new Map(workspace.lists.map((list) => [list.listId, list])) : NO_LIST_UNREAD;
}

// What a nav item shows: the badge counts replies waiting on the owner, the
// dot says some channel has anything new. `workspaceId` null sums them all.
export type OwnerUnreadTotal = { repliesToYou: number; unreadChannels: number };

export function ownerUnreadTotal(
  unread: OwnerChannelUnread | null,
  workspaceId: string | null
): OwnerUnreadTotal {
  const total = { repliesToYou: 0, unreadChannels: 0 };
  for (const workspace of unread?.workspaces ?? []) {
    if (workspaceId !== null && workspace.workspaceId !== workspaceId) continue;
    for (const list of workspace.lists) {
      total.repliesToYou += list.repliesToYou;
      if (hasOwnerUnread(list)) total.unreadChannels += 1;
    }
  }
  return total;
}

export function hasOwnerUnread(list: OwnerListUnread): boolean {
  return list.unread > 0 || list.repliesToYou > 0 || list.unreadThreads.length > 0;
}

/** Where "New messages" goes: the oldest top-level post by someone else after the mark. */
export function firstUnreadPostId(
  newestFirst: readonly BuddyMailingListPost[],
  readThrough: OwnerReadThrough
): string | null {
  let first: string | null = null;
  for (const post of newestFirst) {
    if (post.author.kind === 'owner' || post.threadRootId !== null) continue;
    if (isAfterReadThrough(post, readThrough)) first = post.id;
  }
  return first;
}

// Slack's rail: a channel with anything new reads bold; a quiet one dims.
// Unknown until the owner's unread state loads, so it renders as neither.
export function channelUnreadAttr(unread: OwnerListUnread | undefined): 'new' | 'read' | undefined {
  if (unread === undefined) return undefined;
  return hasOwnerUnread(unread) ? 'new' : 'read';
}

async function markOwnerRead(listId: string, postId: string): Promise<void> {
  await buddyApi(`/api/buddies/lists/${encodeURIComponent(listId)}/owner-read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postId }),
  });
}

// Starts false and reads `document` only in the effect: components render
// through react-dom/server in client tests, where there is no document.
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * The owner is looking at a channel. Returns what was unread when they
 * arrived — the snapshot the "New messages" line and bold thread links draw
 * from, held until they leave, the way Slack does — and marks the channel
 * read through its newest post whenever it is on screen with something newer
 * than the mark. The mark echoes the server's `newestPostId`, so a post that
 * lands after this render stays unread until the next refresh shows it.
 * D = Arriving (unread state not loaded yet) ⊕ Arrived(snapshot).
 */
export type OwnerChannelVisit =
  | { kind: 'arriving' }
  | { kind: 'arrived'; snapshot: OwnerListUnread };

export function useOwnerChannelVisit(
  listId: string,
  current: OwnerListUnread | undefined
): OwnerChannelVisit {
  const [visit, setVisit] = useState<OwnerChannelVisit>(() =>
    current ? { kind: 'arrived', snapshot: current } : { kind: 'arriving' }
  );
  useEffect(() => {
    if (current && visit.kind === 'arriving') setVisit({ kind: 'arrived', snapshot: current });
  }, [current, visit.kind]);
  const visible = useDocumentVisible();
  const newest = current?.newestPostId ?? null;
  const readThrough = current?.readThrough;
  const alreadyRead = readThrough?.kind === 'post' && readThrough.postId === newest;
  useEffect(() => {
    if (!visible || newest === null || alreadyRead) return;
    void markOwnerRead(listId, newest).catch((error: unknown) =>
      console.warn(`[channels] could not mark #${listId} read:`, error)
    );
  }, [listId, newest, alreadyRead, visible]);
  return visit;
}

/**
 * The browser tab title carries the owner's unread state: `(3) Unleashd` for
 * replies waiting on them, `• Unleashd` when channels only have new posts.
 * Mounted once, in AppInner, so it holds on every route.
 */
export function useOwnerUnreadTitle(): void {
  const unread = useOwnerUnread();
  const total = ownerUnreadTotal(unread.data, null);
  const baseTitle = useRef(document.title);
  useEffect(() => {
    const prefix =
      total.repliesToYou > 0 ? `(${total.repliesToYou}) ` : total.unreadChannels > 0 ? '• ' : '';
    document.title = `${prefix}${baseTitle.current}`;
  }, [total.repliesToYou, total.unreadChannels]);
}

// What the owner's arrival leaves on screen: D = Arriving ⊕ Arrived.
export function arrivalMarks(
  visit: OwnerChannelVisit,
  posts: readonly BuddyMailingListPost[]
): { firstUnread: string | null; unreadThreads: readonly string[] } {
  switch (visit.kind) {
    case 'arriving':
      return { firstUnread: null, unreadThreads: [] };
    case 'arrived':
      return {
        firstUnread: firstUnreadPostId(posts, visit.snapshot.readThrough),
        unreadThreads: visit.snapshot.unreadThreads,
      };
  }
}
