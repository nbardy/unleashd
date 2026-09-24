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
  type BuddyWorkspaceActivity,
  BuddyWorkspaceActivitySchema,
} from '@unleashd/shared';
import { type UIEvent, useEffect, useMemo, useRef } from 'react';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { buddyApi } from './api';
import { type ChannelReference, type ChannelTask, workspaceTasksUrl } from './channel-text';
import { taskStatusView } from './ui-contract';

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

export function workspaceActivityResource(workspaceId: string) {
  const path = `/api/buddies/workspaces/${encodeURIComponent(workspaceId)}/activity`;
  return resource(path, async (signal: AbortSignal) =>
    BuddyWorkspaceActivitySchema.parse(await buddyApi(path, { signal }))
  );
}

function listsUrl(workspaceId: string): string {
  return `/api/buddies/lists?workspaceId=${encodeURIComponent(workspaceId)}`;
}

/** A workspace's channels, polled and cached (one key for every surface). */
export function useChannelLists(workspaceId: string) {
  return usePolledFetch<BuddyMailingListSummary[]>(listsUrl(workspaceId), 5000);
}

// Every post read goes through here: the fetch boundary parses the v33 wire
// shape once, so a stale or foreign server surfaces as the view's refresh
// error instead of a crash (or a silent "Unknown") deep in rendering.
export function postsResource(path: string) {
  return resource(path, async (signal: AbortSignal) =>
    BuddyMailingListPostsSchema.parse(await buddyApi(path, { signal }))
  );
}

export function channelPostsResource(listId: string) {
  return postsResource(`/api/buddies/lists/${encodeURIComponent(listId)}/posts?limit=50`);
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

/** The name a post's author shows as: the owner is "You", a Buddy its name. */
export function authorName(
  author: BuddyListAuthor,
  buddyNames: Readonly<Record<string, string>>
): string {
  switch (author.kind) {
    case 'owner':
      return 'You';
    case 'buddy':
      return buddyNames[author.buddyId] ?? author.buddyId;
  }
}

export function channelThreadResource(listId: string, rootId: string) {
  const path = `/api/buddies/lists/${encodeURIComponent(listId)}/threads/${encodeURIComponent(rootId)}`;
  return resource(path, async (signal: AbortSignal) =>
    BuddyChannelThreadSchema.parse(await buddyApi(path, { signal }))
  );
}

function respondingUrl(listId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/responding`;
}

// Every workspace member names posts (archived authors included); only active
// ones appear in the rail and the @ menu.
export type ChannelMember = { id: string; name: string; role: string; status: string };

type ChannelResponse = { threadRootId: string; buddyId: string; conversationId: string };

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

// The universal @ menu: active Buddies and every non-cancelled Task; the fuzzy
// ranker orders them together by match quality.
function channelReferences(
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
          detail: `${taskStatusView(task.status).label} · ${task.ownerName}`,
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

/** Every lookup the channel views derive from a workspace's members and Tasks. */
export function workspaceDirectory(
  workspaceName: string,
  members: readonly ChannelMember[],
  tasks: readonly ChannelTask[]
): WorkspaceDirectory {
  return {
    workspaceName,
    members,
    activeMembers: members.filter((member) => member.status === 'active'),
    tasks,
    buddyNames: Object.fromEntries(members.map((member) => [member.id, member.name])),
    taskById: new Map(tasks.map((task) => [task.id, task])),
    references: channelReferences(members, tasks),
  };
}

/** Members, Tasks and the @ index for one workspace, polled and cached. */
export function useWorkspaceDirectory(workspaceId: string): WorkspaceDirectory {
  const loadActivity = useMemo(() => workspaceActivityResource(workspaceId), [workspaceId]);
  const activity = usePolledFetch<BuddyWorkspaceActivity>(loadActivity, 10_000);
  const tasksFeed = usePolledFetch<ChannelTask[]>(workspaceTasksUrl(workspaceId), 15_000);
  const tasks = tasksFeed.data ?? NO_TASKS;
  return useMemo(
    () =>
      workspaceDirectory(
        activity.data?.workspace.name ?? 'Channels',
        (activity.data?.members ?? []).map((member) => ({
          id: member.id,
          name: member.name,
          role: member.role,
          status: member.status,
        })),
        tasks
      ),
    [activity.data, tasks]
  );
}

/** Buddies composing a mention reply, by thread root, plus a refetch. */
export function useChannelResponding(listId: string) {
  const responding = usePolledFetch<ChannelResponse[]>(respondingUrl(listId), 2500);
  const byRoot = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of responding.data ?? [])
      map.set(row.threadRootId, [...(map.get(row.threadRootId) ?? []), row.buddyId]);
    return map;
  }, [responding.data]);
  return { byRoot, count: responding.data?.length ?? 0, refetch: responding.refetch };
}

// Pin to the newest message on open, and keep following new posts only while
// the reader is already at the bottom — never yank someone reading history
// back down on a poll.
export function useFollowBottom(rowCount: number, version: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the re-pin trigger
  useEffect(() => {
    const node = scrollRef.current;
    if (node && followRef.current && rowCount > 0) node.scrollTop = node.scrollHeight;
  }, [rowCount, version]);
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

// A mention reply is already written when its responder entry disappears:
// fetch it now rather than on the next poll.
export function useRefetchWhenRepliesLand(respondingCount: number, refetch: () => Promise<void>) {
  const previous = useRef(respondingCount);
  useEffect(() => {
    if (respondingCount < previous.current) void refetch();
    previous.current = respondingCount;
  }, [respondingCount, refetch]);
}
