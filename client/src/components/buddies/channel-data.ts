/**
 * client/src/components/buddies/channel-data.ts
 *
 * Channel data shared by the desktop channel browser and the mobile channel
 * screens: resource URLs, transcript rows, the workspace directory (members,
 * Tasks, @ references) and who is replying. No JSX, no CSS — mobile may import
 * it (gate G3 allows components/buddies/).
 */
import {
  BuddyChannelThreadSchema,
  type BuddyListAuthor,
  type BuddyMailingListPost,
  BuddyMailingListPostsSchema,
  type BuddyMemberExecution,
  type BuddyWorkspaceActivity,
  BuddyWorkspaceActivitySchema,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type UIEvent, useEffect, useMemo, useRef } from 'react';
import { type OutboxEntry, channelOutboxAtom, outboxDrop } from '../../atoms/channel-outbox';
import { warmResources } from '../../atoms/prefetch';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
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

// Every post read goes through here: the fetch boundary parses the v33 wire
// shape once, so a stale or foreign server surfaces as the view's refresh
// error instead of a crash (or a silent "Unknown") deep in rendering.
export function postsResource(path: string) {
  return resource(path, async (signal: AbortSignal) =>
    BuddyMailingListPostsSchema.parse(await buddyApi(path, { signal }))
  );
}

// A Task filter reads the workspace-wide feed so one Task's discussion is
// visible across every channel, not just the selected one.
export function taskChannelFeedUrl(workspaceId: string, projectId: string): string {
  return `/api/buddies/posts?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&limit=50`;
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

export function channelPostsResource(listId: string) {
  return postsResource(`/api/buddies/lists/${encodeURIComponent(listId)}/posts?limit=50`);
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

export function channelThreadResource(listId: string, rootId: string) {
  const path = `/api/buddies/lists/${encodeURIComponent(listId)}/threads/${encodeURIComponent(rootId)}`;
  return resource(path, async (signal: AbortSignal) =>
    BuddyChannelThreadSchema.parse(await buddyApi(path, { signal }))
  );
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

export type ChannelResponse = { threadRootId: string; buddyId: string };

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
  data: readonly unknown[] | null;
  error: Error | null;
}): FeedPhase {
  if (feed.data === null) return feed.error ? 'failed' : 'loading';
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

/** Buddies composing a reply, by thread root. */
export function useChannelResponding(listId: string): ReadonlyMap<string, readonly string[]> {
  const responding = usePolledFetch<ChannelResponse[]>(respondingUrl(listId), CHANNEL_BACKSTOP_MS);
  return useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of responding.data ?? [])
      map.set(row.threadRootId, [...(map.get(row.threadRootId) ?? []), row.buddyId]);
    return map;
  }, [responding.data]);
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
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };
  const pin = () => {
    followRef.current = true;
  };
  return { scrollRef, onScroll, pin };
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
