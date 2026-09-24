import type { Conversation } from '@unleashd/shared';
import { getBuddyContext, isBuddyBuilderConversation, isBuddyConversation } from '@unleashd/shared';
import { atom } from 'jotai';
import type { Buddy, BuddyOverview, Workspace } from '../components/buddies/types';
import { folderGroupKey } from '../utils/directories';
import { conversationActivityMs, sortByActivityDesc } from '../utils/time';
import { archivedBuddyIdsAtom } from './buddy-visibility';
import {
  type PendingConversationCreation,
  allConversationsAtom,
  allPendingCreationsAtom,
} from './conversations';
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

export interface BuddySidebarItemData {
  buddyId: string;
  buddyName: string;
  conversations: Conversation[];
  foregroundRunningCount: number;
  backgroundRunningCount: number;
  backgroundConversationCount: number;
  latestConversation: Conversation | null;
  latestRun: BuddySidebarRun | null;
  pendingCreation: PendingConversationCreation | null;
  workspaceId: string;
  workingDirectory?: string;
  workspaceName: string | null;
  lastActiveAt: Date | null;
}

export const buddySidebarOverviewAtom = atom<BuddySidebarOverview | null>(null);

export const buddySidebarProjectsAtom = atom((get) => {
  const overview = get(buddySidebarOverviewAtom);
  const archived = get(archivedBuddyIdsAtom);
  const all = get(allConversationsAtom);
  const ids = new Set(all.map((c) => c.id));
  const projects = new Map<
    string,
    {
      workspaceId: string;
      name: string;
      lastActiveMs: number;
      runningCount: number;
      items: BuddySidebarItemData[];
    }
  >();
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
  for (const conversation of all) {
    if (!isBuddyConversation(conversation)) continue;
    const context = getBuddyContext(conversation)!;
    const item = entries.get(entryKey(context.buddyId, context.workspaceId));
    if (!item) continue;
    const activity = conversationActivityMs(conversation);
    touch(item, activity);
    // Background conversations have their own destination, including tasks
    // linked to a foreground parent. Count them before hiding nested chat rows.
    if (conversation.placement === 'background') {
      item.backgroundConversationCount += 1;
      if (conversation.isRunning) {
        item.backgroundRunningCount += 1;
        projects.get(context.workspaceId)!.runningCount += 1;
      }
      continue;
    }
    if (conversation.parentConversationId && ids.has(conversation.parentConversationId)) continue;
    if (conversation.isRunning) {
      item.foregroundRunningCount += 1;
      projects.get(context.workspaceId)!.runningCount += 1;
    }
    if (!item.latestConversation || activity > conversationActivityMs(item.latestConversation))
      item.latestConversation = conversation;
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
    for (const item of project.items) item.conversations = sortByActivityDesc(item.conversations);
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
});

// Workspaces with a channel browser: one top-level Channels row each.
// Derived here (not a component useMemo) so every sidebar reads one list.
export const buddySidebarChannelsAtom = atom((get) => {
  const projects = get(buddySidebarProjectsAtom);
  return projects
    .filter((project) => project.workspaceId)
    .map((project) => ({ workspaceId: project.workspaceId, name: project.name }));
});

// Live non-Buddy conversations grouped exactly like the desktop sidebar.
// Keep this as a derived collection view so components do not rebuild a
// running-process index during render. Buddy runs are counted by
// buddySidebarProjectsAtom because those folders group on workspace identity.
export const sidebarRunningCountByFolderAtom = atom((get) => {
  const all = get(allConversationsAtom);
  const ids = new Set(all.map((conversation) => conversation.id));
  const promoted = new Set(get(promotedWorkersAtom));
  const counts = new Map<string, number>();
  for (const conversation of all) {
    if (
      !conversation.isRunning ||
      isBuddyConversation(conversation) ||
      isBuddyBuilderConversation(conversation) ||
      (conversation.isWorker && !promoted.has(conversation.id)) ||
      conversation.mergeChildMeta ||
      (conversation.parentConversationId && ids.has(conversation.parentConversationId))
    )
      continue;
    const key = folderGroupKey(conversation.workingDirectory);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
});

export const buddySidebarCountAtom = atom(
  (get) => new Set(get(buddySidebarProjectsAtom).flatMap((p) => p.items.map((i) => i.buddyId))).size
);

// Builder threads share project recency ordering, including completed threads so
// marking a thread done does not unexpectedly move its group.
export const buddyBuilderConversationsAtom = atom((get) => {
  const all = get(allConversationsAtom);
  const ids = new Set(all.map((conversation) => conversation.id));
  const promoted = new Set(get(promotedWorkersAtom));
  return all.filter(
    (conversation) =>
      isBuddyBuilderConversation(conversation) &&
      !(conversation.isWorker && !promoted.has(conversation.id)) &&
      !conversation.mergeChildMeta &&
      !(conversation.parentConversationId && ids.has(conversation.parentConversationId))
  );
});

export const buddySidebarGroupsAtom = atom((get) => {
  const projects = get(buddySidebarProjectsAtom);
  const builders = get(buddyBuilderConversationsAtom);
  type Group =
    | { kind: 'project'; key: string; lastActiveMs: number; project: (typeof projects)[number] }
    | { kind: 'builder'; key: string; lastActiveMs: number };
  const groups: Group[] = projects.map((project) => ({
    kind: 'project',
    key: `buddy-project:${project.workspaceId}`,
    lastActiveMs: project.lastActiveMs,
    project,
  }));
  if (builders.length) {
    groups.push({
      kind: 'builder',
      key: '__builder__',
      lastActiveMs: conversationActivityMs(builders[0]),
    });
  }
  return groups.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
});
