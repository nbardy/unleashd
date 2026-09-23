/**
 * client/src/components/buddies/channel-data.ts
 *
 * Channel data shared by the desktop channel browser and the mobile channel
 * screens: resource URLs, transcript rows, the workspace directory (members,
 * Tasks, @ references) and who is replying. No JSX, no CSS — mobile may import
 * it (gate G3 allows components/buddies/).
 */
import { type BuddyWorkspaceActivity, BuddyWorkspaceActivitySchema } from '@unleashd/shared';
import { useMemo } from 'react';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { type BuddyMailingListPost, authorKey } from './BuddyMessages';
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

export function listsUrl(workspaceId: string): string {
  return `/api/buddies/lists?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function channelPostsUrl(listId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/posts?limit=50`;
}

export function threadUrl(listId: string, rootId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/threads/${encodeURIComponent(rootId)}`;
}

export function respondingUrl(listId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/responding`;
}

// Every workspace member names posts (archived authors included); only active
// ones appear in the rail and the @ menu.
export type ChannelMember = { id: string; name: string; role: string; status: string };

export type ChannelThread = { root: BuddyMailingListPost; replies: BuddyMailingListPost[] };
export type ChannelResponse = { threadRootId: string; buddyId: string; conversationId: string };

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
