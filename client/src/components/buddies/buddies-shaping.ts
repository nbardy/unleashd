/**
 * client/src/components/buddies/buddies-shaping.ts
 *
 * Pure shaping helpers extracted from BuddiesDashboard.tsx (938 lines) for
 * mobile + desktop reuse. Mobile imports from `components/buddies/*` without
 * ever importing a desktop `components/*.tsx` view.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ BAN: raw `.buddyContext` / `.purpose` reads are forbidden in new     │
 * │ code. Read conversation identity ONLY via the canonical helpers:     │
 * │   getConversationKind → matchConversationKind → buddyContextFromKind │
 * │ from `@unleashd/shared` (`shared/src/conversation-kind.ts`).        │
 * │ This file is the ONLY place that may call those helpers to produce  │
 * │ a BuddyContext; callers consume the helpers here, not raw fields.   │
 * │                                                                      │
 * │ Grep lint (Agent 10):                                                │
 * │   grep -R "\.buddyContext\|\.purpose" client/src/mobile --include="*.ts*" → fail │
 * │   grep -R "\.buddyContext\|\.purpose" client/src/components/buddies/buddies-shaping.ts → allowed only inside the canonical helpers below │
 * │ Desktop adoption: BuddiesDashboard.tsx imports from here; mobile     │
 * │   (BuddiesMobile / BuddyDetailMobile) imports from here.             │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * No CSS side-effect imports — pure functions only. Mobile path
 * (`utils/` + `components/buddies/*`) must stay CSS-free.
 */

import type { BuddyContext } from '@unleashd/shared';
import type { BuddyProject, ConversationLink, LegacyWorkItem, Workspace } from './types';

// ---------------------------------------------------------------------------
// Workspace / project shaping (BuddiesDashboard.tsx:244-260)
// ---------------------------------------------------------------------------

export function selectWorkspace(
  workspaces: Workspace[],
  selectedWorkspaceId: string
): Workspace | undefined {
  return workspaces.find((item) => item.id === selectedWorkspaceId) ?? workspaces[0];
}

export function selectWorkspaceProjects(
  projects: BuddyProject[],
  workspaceId: string | undefined
): BuddyProject[] {
  if (!workspaceId) return [];
  return projects.filter((project) => project.workspace_id === workspaceId);
}

export function selectLegacyWorkForWorkspace(
  legacyWorkItems: LegacyWorkItem[],
  workspaceId: string | undefined
): LegacyWorkItem[] {
  if (!workspaceId) return [];
  return legacyWorkItems.filter((item) => item.project_id === workspaceId);
}

export function selectPrimaryProject(workspaceProjects: BuddyProject[]): BuddyProject | undefined {
  return (
    workspaceProjects.find((project) => project.status === 'in_progress') ??
    workspaceProjects.find((project) => project.status === 'ready') ??
    workspaceProjects.find((project) => !['done', 'cancelled'].includes(project.status))
  );
}

// ---------------------------------------------------------------------------
// Conversation link projections
// ---------------------------------------------------------------------------

/** The conversation a Buddy link row points at (current column, else the legacy one). */
export function linkConversationId(link: ConversationLink): string | null {
  return link.conversation_id || link.unleashd_conversation_id || null;
}

/**
 * The most recently active conversation for one Task that the client still
 * holds, or null when there is none to open (the caller starts one instead).
 */
export function projectConversation(
  links: readonly ConversationLink[],
  projectId: string,
  available: ReadonlySet<string>
): string | null {
  const held = links.flatMap((link) => {
    const conversationId = linkConversationId(link);
    return link.buddy_project_id === projectId && conversationId && available.has(conversationId)
      ? [{ conversationId, at: new Date(link.last_active_at ?? 0).getTime() }]
      : [];
  });
  held.sort((left, right) => right.at - left.at);
  return held[0]?.conversationId ?? null;
}

export function countReviewConversations(conversations: ConversationLink[]): number {
  return conversations.filter((conversation) => conversation.kind === 'review').length;
}

export function filterAutomationConversations(
  conversations: ConversationLink[]
): ConversationLink[] {
  return conversations.filter((conversation) => conversation.kind === 'automation');
}

/**
 * Most recent conversation for a given workspace.
 * Mirrors BuddiesDashboard.tsx:294-304.
 */
export function getLatestWorkspaceConversation(
  conversations: ConversationLink[],
  workspaceId: string | undefined
): ConversationLink | undefined {
  if (!workspaceId) return undefined;
  return [...conversations]
    .filter((conversation) => conversation.workspace_id === workspaceId)
    .sort(
      (left, right) =>
        new Date(right.last_active_at ?? 0).getTime() - new Date(left.last_active_at ?? 0).getTime()
    )[0];
}

// ---------------------------------------------------------------------------
// BuddyContext helpers — canonical kind path (never raw .buddyContext)
// ---------------------------------------------------------------------------

/**
 * Build a BuddyContext for `talk()` / `createConversation`.
 * Mirrors BuddiesDashboard.tsx:319-343 `talk()` context construction.
 * Pure constructor — no raw field reads.
 */
export function buildBuddyContextForTalk(params: {
  buddyId: string;
  workspaceId: string;
  buddyProjectId?: string | null;
}): BuddyContext {
  return {
    buddyId: params.buddyId,
    workspaceId: params.workspaceId,
    buddyProjectId: params.buddyProjectId ?? null,
  };
}
