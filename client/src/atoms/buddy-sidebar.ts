import { atom } from 'jotai';
import type { Buddy, BuddyOverview, Workspace } from '../components/buddies/types';
import { archivedBuddyIdsAtom } from './buddy-visibility';
import { priorDirectConversationIdsAtom } from './dm-chain';
import { directoryFacts } from './conversation-index';
import {
  type ConversationListEntry,
  type PendingConversationCreation,
  allPendingCreationsAtom,
  availableConversationIdSetAtom,
  conversationListAtom,
} from './conversations';
import { sameItems, sameMap, stableAtom } from './structural';
import { promotedWorkersAtom } from './ui';

/**
 * The slice of `BuddyOverview` the sidebar reads, declared as Picks over the
 * canonical types so an upstream rename fails here at compile time — and kept
 * minimal so tests can seed rows without fabricating whole Buddy records.
 * `useBuddyOverview()`'s full `BuddyOverview` is assignable to it.
 */
type SidebarBuddy = Pick<Buddy, 'id' | 'name'>;
type SidebarWorkspace = Pick<Workspace, 'id' | 'name'> & Partial<Pick<Workspace, 'root_path'>>;
type BuddySidebarRun = BuddyOverview['recentRuns'][number];

export interface BuddySidebarOverview {
  employees: Array<{ buddy: SidebarBuddy; workspaces: SidebarWorkspace[] }>;
  recentRuns: BuddySidebarRun[];
}

// Conversations appear here as list entries (atoms/conversation-index.ts):
// the sidebar needs their ids, order and flags, and each row subscribes to its
// own conversation for everything else.
export interface BuddySidebarItemData {
  buddyId: string;
  buddyName: string;
  conversations: ConversationListEntry[];
  foregroundRunningCount: number;
  backgroundRunningCount: number;
  backgroundConversationCount: number;
  latestConversation: ConversationListEntry | null;
  latestRun: BuddySidebarRun | null;
  pendingCreation: PendingConversationCreation | null;
  workspaceId: string;
  workingDirectory?: string;
  workspaceName: string | null;
  lastActiveAt: Date | null;
}

export const buddySidebarOverviewAtom = atom<BuddySidebarOverview | null>(null);

export interface BuddySidebarProject {
  workspaceId: string;
  name: string;
  lastActiveMs: number;
  runningCount: number;
  items: BuddySidebarItemData[];
}

function sameBuddyItem(a: BuddySidebarItemData, b: BuddySidebarItemData): boolean {
  return (
    a.buddyId === b.buddyId &&
    a.buddyName === b.buddyName &&
    a.workspaceId === b.workspaceId &&
    a.workspaceName === b.workspaceName &&
    a.workingDirectory === b.workingDirectory &&
    a.foregroundRunningCount === b.foregroundRunningCount &&
    a.backgroundRunningCount === b.backgroundRunningCount &&
    a.backgroundConversationCount === b.backgroundConversationCount &&
    a.latestConversation === b.latestConversation &&
    a.latestRun === b.latestRun &&
    a.pendingCreation === b.pendingCreation &&
    a.lastActiveAt?.getTime() === b.lastActiveAt?.getTime() &&
    sameItems(a.conversations, b.conversations)
  );
}

// The projects are rebuilt whenever the list moves (any conversation's
// activity or status); handing back the previous array when nothing a Buddy
// row shows changed keeps the Sidebar from re-rendering on unrelated events.
function sameBuddyProjects(a: BuddySidebarProject[], b: BuddySidebarProject[]): boolean {
  return (
    a.length === b.length &&
    a.every((project, i) => {
      const other = b[i];
      return (
        project.workspaceId === other.workspaceId &&
        project.name === other.name &&
        project.lastActiveMs === other.lastActiveMs &&
        project.runningCount === other.runningCount &&
        project.items.length === other.items.length &&
        project.items.every((item, j) => sameBuddyItem(item, other.items[j]))
      );
    })
  );
}

export const buddySidebarProjectsAtom = stableAtom((get): BuddySidebarProject[] => {
  const overview = get(buddySidebarOverviewAtom);
  const archived = get(archivedBuddyIdsAtom);
  const all = get(conversationListAtom);
  const ids = get(availableConversationIdSetAtom);
  const priorDmIds = get(priorDirectConversationIdsAtom);
  const projects = new Map<string, BuddySidebarProject>();
  const entries = new Map<string, BuddySidebarItemData>();
  const entryKey = (buddyId: string, workspaceId: string) => JSON.stringify([workspaceId, buddyId]);
  const ensure = (buddy: SidebarBuddy, workspace?: SidebarWorkspace) => {
    const workspaceId = workspace?.id ?? '';
    let project = projects.get(workspaceId);
    if (!project) {
      project = {
        workspaceId,
        name: workspace?.name ?? 'Unassigned',
        lastActiveMs: 0,
        runningCount: 0,
        items: [],
      };
      projects.set(workspaceId, project);
    }
    const key = entryKey(buddy.id, workspaceId);
    let item = entries.get(key);
    if (!item) {
      item = {
        buddyId: buddy.id,
        buddyName: buddy.name,
        workspaceId,
        workspaceName: project.name,
        workingDirectory: workspace?.root_path,
        conversations: [],
        foregroundRunningCount: 0,
        backgroundRunningCount: 0,
        backgroundConversationCount: 0,
        latestConversation: null,
        latestRun: null,
        pendingCreation: null,
        lastActiveAt: null,
      };
      entries.set(key, item);
      project.items.push(item);
    }
    return item;
  };
  const touch = (item: BuddySidebarItemData, ms: number) => {
    if (!Number.isFinite(ms)) return;
    if (ms > (item.lastActiveAt?.getTime() ?? 0)) item.lastActiveAt = new Date(ms);
    const project = projects.get(item.workspaceId)!;
    project.lastActiveMs = Math.max(project.lastActiveMs, ms);
  };
  for (const { buddy, workspaces: memberships } of overview?.employees ?? []) {
    if (archived.has(buddy.id)) continue;
    for (const workspace of memberships) ensure(buddy, workspace);
    if (!memberships.length) ensure(buddy);
  }
  // Only the roster creates navigable workspace/member rows. Imported transcripts
  // (including live-test sessions) can outlive their Buddy store, and stale runs
  // can outlive memberships. Keep their history in the conversation store without
  // inventing UUID folders, unnamed Buddies, or creation targets from those IDs.
  for (const run of overview?.recentRuns ?? []) {
    const item = entries.get(entryKey(run.buddyId, run.workspaceId));
    if (!item) continue;
    if (!item.latestRun || Date.parse(run.lastActiveAt) > Date.parse(item.latestRun.lastActiveAt))
      item.latestRun = run;
    touch(item, Date.parse(run.lastActiveAt));
  }
  // `all` is newest-first, so the first foreground entry per item is its latest
  // and pushing in order keeps each item's list sorted.
  for (const conversation of all) {
    if (conversation.kind !== 'buddy' || conversation.buddyId === null) continue;
    const workspaceId = conversation.buddyWorkspaceId ?? '';
    const item = entries.get(entryKey(conversation.buddyId, workspaceId));
    if (!item) continue;
    // An earlier DM generation stays in the store so the open chat can draw it
    // above the New chat divider. It is not its own sidebar row.
    if (priorDmIds.has(conversation.id)) {
      if (conversation.isRunning && conversation.placement !== 'background') {
        item.foregroundRunningCount += 1;
        projects.get(workspaceId)!.runningCount += 1;
      }
      continue;
    }
    touch(item, conversation.activityMs);
    // Background conversations have their own destination, including tasks
    // linked to a foreground parent. Count them before hiding nested chat rows.
    if (conversation.placement === 'background') {
      item.backgroundConversationCount += 1;
      if (conversation.isRunning) {
        item.backgroundRunningCount += 1;
        projects.get(workspaceId)!.runningCount += 1;
      }
      continue;
    }
    if (conversation.parentConversationId && ids.has(conversation.parentConversationId)) continue;
    if (conversation.isRunning) {
      item.foregroundRunningCount += 1;
      projects.get(workspaceId)!.runningCount += 1;
    }
    item.latestConversation ??= conversation;
    if (!conversation.done) item.conversations.push(conversation);
  }
  for (const pending of get(allPendingCreationsAtom)) {
    const context = pending.buddyContext;
    if (!context) continue;
    const item = entries.get(entryKey(context.buddyId, context.workspaceId));
    if (!item) continue;
    item.pendingCreation ??= pending;
    touch(item, pending.createdAt.getTime());
  }
  for (const project of projects.values()) {
    project.items.sort(
      (a, b) =>
        (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0) ||
        a.buddyName.localeCompare(b.buddyName)
    );
  }
  return [...projects.values()].sort(
    (a, b) =>
      b.lastActiveMs - a.lastActiveMs ||
      a.name.localeCompare(b.name) ||
      a.workspaceId.localeCompare(b.workspaceId)
  );
}, sameBuddyProjects);

// Workspaces with a channel browser: one top-level Channels row each.
// Derived here (not a component useMemo) so every sidebar reads one list.
export const buddySidebarChannelsAtom = stableAtom(
  (get) =>
    get(buddySidebarProjectsAtom)
      .filter((project) => project.workspaceId)
      .map((project) => ({ workspaceId: project.workspaceId, name: project.name })),
  (a, b) =>
    a.length === b.length &&
    a.every((row, i) => row.workspaceId === b[i].workspaceId && row.name === b[i].name)
);

/**
 * Folder rows of the desktop sidebar: everything except hidden workers, Buddy
 * threads (their own section), Builder threads (their own folder) and children
 * whose parent is listed (they nest under it).
 */
function isFolderRow(
  entry: ConversationListEntry,
  promoted: ReadonlySet<string>,
  listed: ReadonlySet<string>
): boolean {
  return (
    !(entry.isWorker && !promoted.has(entry.id)) &&
    entry.kind !== 'buddy' &&
    entry.kind !== 'buddy_builder' &&
    !(entry.parentConversationId && listed.has(entry.parentConversationId))
  );
}

const promotedSetAtom = atom((get) => new Set(get(promotedWorkersAtom)));

// Live non-Buddy conversations grouped exactly like the desktop sidebar.
// Keep this as a derived collection view so components do not rebuild a
// running-process index during render. Buddy runs are counted by
// buddySidebarProjectsAtom because those folders group on workspace identity.
export const sidebarRunningCountByFolderAtom = stableAtom(
  (get) => {
    const listed = get(availableConversationIdSetAtom);
    const promoted = get(promotedSetAtom);
    const counts = new Map<string, number>();
    for (const entry of get(conversationListAtom)) {
      if (!entry.isRunning || !isFolderRow(entry, promoted, listed)) continue;
      const key = directoryFacts(entry.workingDirectory).groupKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  },
  (a, b) => sameMap(a, b)
);

const RECENT_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;

export interface SidebarFolderGroup {
  /** `folderGroupKey` of the group's conversations. */
  directory: string;
  /** Not-done conversation ids, newest-first. A group whose conversations are
   *  all done stays (empty) so its position does not jump when one is marked. */
  activeIds: readonly string[];
}

export interface SidebarFolderView {
  /** Folders active in the last week, newest-first. */
  recent: readonly SidebarFolderGroup[];
  /** Not-done conversations older than a week, newest-first. */
  olderIds: readonly string[];
}

function sameFolderView(a: SidebarFolderView, b: SidebarFolderView): boolean {
  return (
    sameItems(a.olderIds, b.olderIds) &&
    a.recent.length === b.recent.length &&
    a.recent.every(
      (group, i) =>
        group.directory === b.recent[i].directory &&
        sameItems(group.activeIds, b.recent[i].activeIds)
    )
  );
}

// Was four `useMemo` passes inside Sidebar.tsx, re-run on every conversation
// event with a date parse per row. The list is newest-first, so the first
// entry seen for a folder dates the folder and groups come out in order.
export const sidebarFolderViewAtom = stableAtom((get): SidebarFolderView => {
  const listed = get(availableConversationIdSetAtom);
  const promoted = get(promotedSetAtom);
  const cutoff = Date.now() - RECENT_CUTOFF_MS;
  const recent = new Map<string, string[]>();
  const olderIds: string[] = [];
  for (const entry of get(conversationListAtom)) {
    if (!isFolderRow(entry, promoted, listed)) continue;
    if (entry.activityMs <= cutoff) {
      if (!entry.done) olderIds.push(entry.id);
      continue;
    }
    const key = directoryFacts(entry.workingDirectory).groupKey;
    let group = recent.get(key);
    if (!group) {
      group = [];
      recent.set(key, group);
    }
    if (!entry.done) group.push(entry.id);
  }
  return {
    recent: Array.from(recent, ([directory, activeIds]) => ({ directory, activeIds })),
    olderIds,
  };
}, sameFolderView);

export const buddySidebarCountAtom = atom(
  (get) => new Set(get(buddySidebarProjectsAtom).flatMap((p) => p.items.map((i) => i.buddyId))).size
);

// Builder threads share project recency ordering, including completed threads so
// marking a thread done does not unexpectedly move its group.
export const buddyBuilderConversationsAtom = stableAtom((get) => {
  const listed = get(availableConversationIdSetAtom);
  const promoted = get(promotedSetAtom);
  return get(conversationListAtom).filter(
    (entry) =>
      entry.kind === 'buddy_builder' &&
      !(entry.isWorker && !promoted.has(entry.id)) &&
      !(entry.parentConversationId && listed.has(entry.parentConversationId))
  );
}, sameItems);

export type BuddySidebarGroup =
  | { kind: 'project'; key: string; lastActiveMs: number; project: BuddySidebarProject }
  | { kind: 'builder'; key: string; lastActiveMs: number };

export const buddySidebarGroupsAtom = stableAtom((get): BuddySidebarGroup[] => {
  const projects = get(buddySidebarProjectsAtom);
  const builders = get(buddyBuilderConversationsAtom);
  const groups: BuddySidebarGroup[] = projects.map((project) => ({
    kind: 'project',
    key: `buddy-project:${project.workspaceId}`,
    lastActiveMs: project.lastActiveMs,
    project,
  }));
  if (builders.length) {
    groups.push({
      kind: 'builder',
      key: '__builder__',
      lastActiveMs: builders[0].activityMs,
    });
  }
  return groups.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}, sameBuddyGroups);

function sameBuddyGroups(a: BuddySidebarGroup[], b: BuddySidebarGroup[]): boolean {
  return (
    a.length === b.length &&
    a.every((group, i) => {
      const other = b[i];
      if (group.key !== other.key || group.lastActiveMs !== other.lastActiveMs) return false;
      return (
        group.kind === 'builder' || (other.kind === 'project' && group.project === other.project)
      );
    })
  );
}
