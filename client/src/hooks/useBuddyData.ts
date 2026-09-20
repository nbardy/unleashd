import { BuddyTeamStateSchema } from '@unleashd/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createConversation } from '../atoms/pending-creations';
import { asArray, buddyApi } from '../components/buddies/api';
import {
  buildBuddyContextForTalk,
  countReviewConversations,
  filterAutomationConversations,
  getLatestWorkspaceConversation,
  selectLegacyWorkForWorkspace,
  selectPrimaryProject,
  selectWorkspace,
  selectWorkspaceProjects,
} from '../components/buddies/buddies-shaping';
import type {
  Buddy,
  BuddyAutomation,
  BuddyOverview,
  BuddyProject,
  ConversationLink,
  EmployeeRecord,
  EmployeeTab,
  LegacyWorkItem,
  Sprint,
  Workspace,
} from '../components/buddies/types';
import { type UsePolledFetchResult, resource, usePolledFetch } from './usePolledFetch';

// =============================================================================
// Buddy read models — the ONE place each Buddy request is described.
//
// Desktop (BuddiesDashboard, Sidebar, SearchPalette) and mobile (BuddiesMobile,
// BuddyDetailMobile) all read through these hooks, so they share cache keys:
// the directory the Sidebar polled is the directory the mobile list renders,
// and opening a Buddy on either shell hits the same `buddy-detail:` entry.
// Before this file, both shells carried their own copy of the three-request
// detail assembly below, plus generation counters to discard late responses.
// =============================================================================

export const BUDDY_OVERVIEW_URL = '/api/buddies/overview';

export const EMPTY_AUTOMATIONS: BuddyAutomation[] = [];

export function useBuddyOverview(
  intervalMs = 0,
  enabled = true
): UsePolledFetchResult<BuddyOverview> {
  return usePolledFetch<BuddyOverview>(BUDDY_OVERVIEW_URL, intervalMs, enabled);
}

export interface BuddyDetailData {
  employee: EmployeeRecord;
  preferredWorkspaceId: string;
}

function selectPreferredBuddyWorkspace(
  workspaces: readonly Workspace[],
  legacyWorkItems: readonly LegacyWorkItem[]
): Workspace | undefined {
  return (
    workspaces.find((candidate) =>
      legacyWorkItems.some((item) => item.project_id === candidate.id)
    ) ??
    workspaces.find((candidate) => candidate.slug !== 'buddies') ??
    workspaces[0]
  );
}

async function loadBuddyDetailData(buddyId: string, signal: AbortSignal): Promise<BuddyDetailData> {
  const encodedBuddyId = encodeURIComponent(buddyId);
  const [detail, contextPayload, projectPayload] = await Promise.all([
    buddyApi<Record<string, unknown>>(`/api/buddies/${encodedBuddyId}`, { signal }),
    buddyApi<Record<string, unknown>>(`/api/buddies/${encodedBuddyId}/context`, { signal }),
    buddyApi<unknown>(`/api/buddies/${encodedBuddyId}/projects?includeClosed=true`, { signal }),
  ]);
  const buddy = (detail.buddy ?? detail) as unknown as Buddy;
  const workspaces = asArray<Workspace>(detail, 'workspaces');
  const teamState = BuddyTeamStateSchema.parse(detail);
  const legacyWorkItems = asArray<LegacyWorkItem>(detail, 'legacyWorkItems');
  const employee: EmployeeRecord = {
    buddy,
    workspaces,
    sprints: contextPayload.sprint ? [contextPayload.sprint as Sprint] : [],
    projects: asArray<BuddyProject>(projectPayload, 'projects'),
    legacyWorkItems,
    conversations: asArray<ConversationLink>(detail, 'conversations'),
    skills: asArray<{ name: string; mode?: string; instruction_path?: string | null }>(
      detail,
      'skills'
    ),
    manager: teamState.manager,
    directReports: teamState.team,
    messages: asArray<EmployeeRecord['messages'][number]>(detail, 'messages'),
    reviews: asArray<EmployeeRecord['reviews'][number]>(detail, 'reviews'),
    approvals: asArray<EmployeeRecord['approvals'][number]>(detail, 'approvals'),
  };
  return {
    employee,
    preferredWorkspaceId: selectPreferredBuddyWorkspace(workspaces, legacyWorkItems)?.id ?? '',
  };
}

/**
 * One Buddy's detail bundle. The buddy id is the cache key, so switching
 * buddies switches entries and a late response for the previous buddy is
 * simply never read — no generation counter, no "is this mine?" check.
 */
export function useBuddyDetailData(
  buddyId: string | null | undefined
): UsePolledFetchResult<BuddyDetailData> {
  const source = useMemo(
    () =>
      buddyId
        ? resource(`buddy-detail:${buddyId}`, (signal) => loadBuddyDetailData(buddyId, signal))
        : null,
    [buddyId]
  );
  return usePolledFetch<BuddyDetailData>(source, 0);
}

/** Automations are a separate route-backed projection, not part of the detail bundle. */
export function useBuddyAutomations(
  buddyId: string | null | undefined,
  enabled: boolean
): UsePolledFetchResult<BuddyAutomation[]> {
  const source = useMemo(
    () =>
      buddyId
        ? resource(`buddy-automations:${buddyId}`, async (signal) =>
            asArray<BuddyAutomation>(
              await buddyApi<unknown>(`/api/buddies/${encodeURIComponent(buddyId)}/automations`, {
                signal,
              }),
              'automations'
            )
          )
        : null,
    [buddyId]
  );
  return usePolledFetch<BuddyAutomation[]>(source, 0, enabled && Boolean(buddyId));
}

/**
 * Everything a Buddy page derives from its detail bundle, plus the two actions
 * that open a thread. BuddiesDashboard (desktop) and BuddyDetailMobile each
 * carried this block verbatim — ~80 lines of identical memos, `talk` and
 * `openProjectConversation` — so it lives here once and the shells only render.
 *
 * `openConversation` is the shell's own navigation (mobile threads route state
 * through it); it is read via a ref so an inline arrow cannot churn callbacks.
 */
export function useBuddyPage(
  buddyId: string | undefined,
  activeTab: EmployeeTab,
  availableConversationIds: ReadonlySet<string>,
  openConversation: (conversationId: string) => void
) {
  const detail = useBuddyDetailData(buddyId);
  const employee = detail.data?.employee ?? null;
  const automationsFetch = useBuddyAutomations(buddyId, activeTab === 'automations');
  const automations = automationsFetch.data ?? EMPTY_AUTOMATIONS;
  const automationError = automationsFetch.error?.message ?? null;

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [showReviewConversations, setShowReviewConversations] = useState(false);
  // Per-buddy view state resets on navigation; the tab itself is the URL and
  // deliberately does NOT reset (Back out of a thread lands on the tab you left).
  // biome-ignore lint/correctness/useExhaustiveDependencies: buddyId is the reset key, not a value the effect reads
  useEffect(() => {
    setSelectedWorkspaceId('');
    setShowReviewConversations(false);
  }, [buddyId]);

  const openRef = useRef(openConversation);
  openRef.current = openConversation;

  const workspaceId = selectedWorkspaceId || (detail.data?.preferredWorkspaceId ?? '');
  const workspace = useMemo(
    () => selectWorkspace(employee?.workspaces ?? [], workspaceId),
    [employee?.workspaces, workspaceId]
  );
  const workspaceProjects = useMemo(
    () => selectWorkspaceProjects(employee?.projects ?? [], workspace?.id),
    [employee?.projects, workspace?.id]
  );
  const legacyWork = useMemo(
    () => selectLegacyWorkForWorkspace(employee?.legacyWorkItems ?? [], workspace?.id),
    [employee?.legacyWorkItems, workspace?.id]
  );
  const primaryProject = useMemo(
    () => selectPrimaryProject(workspaceProjects),
    [workspaceProjects]
  );
  const reviewConversationCount = useMemo(
    () => countReviewConversations(employee?.conversations ?? []),
    [employee?.conversations]
  );
  const automationConversations = useMemo(
    () => filterAutomationConversations(employee?.conversations ?? []),
    [employee?.conversations]
  );
  const latestWorkspaceConversation = useMemo(
    () => getLatestWorkspaceConversation(employee?.conversations ?? [], workspace?.id),
    [employee?.conversations, workspace?.id]
  );

  const talk = useCallback(
    (targetWorkspace: Workspace, buddyProjectId?: string) => {
      if (!employee) return;
      const context = buildBuddyContextForTalk({
        buddyId: employee.buddy.id,
        workspaceId: targetWorkspace.id,
        buddyProjectId: buddyProjectId ?? null,
      });
      const id = createConversation({
        workingDirectory: targetWorkspace.root_path,
        config: {
          provider: (employee.buddy.provider || 'codex') as 'codex',
          model: employee.buddy.model
            ? { mode: 'explicit', modelId: employee.buddy.model }
            : { mode: 'default' },
          reasoning: employee.buddy.reasoning_effort
            ? { mode: 'explicit', effort: employee.buddy.reasoning_effort }
            : { mode: 'default' },
        },
        buddyContext: context,
      });
      openRef.current(id);
    },
    [employee]
  );

  const openProjectConversation = useCallback(
    (targetWorkspace: Workspace, projectId: string) => {
      const existing = [...(employee?.conversations ?? [])]
        .filter((conversation) => {
          const conversationId =
            conversation.conversation_id ?? conversation.unleashd_conversation_id;
          return (
            conversation.buddy_project_id === projectId &&
            Boolean(conversationId && availableConversationIds.has(conversationId))
          );
        })
        .sort(
          (left, right) =>
            new Date(right.last_active_at ?? 0).getTime() -
            new Date(left.last_active_at ?? 0).getTime()
        )[0];
      const conversationId = existing?.conversation_id ?? existing?.unleashd_conversation_id;
      if (conversationId) {
        openRef.current(conversationId);
        return;
      }
      talk(targetWorkspace, projectId);
    },
    [availableConversationIds, employee?.conversations, talk]
  );

  return {
    detail,
    employee,
    automationsFetch,
    automations,
    automationError,
    setSelectedWorkspaceId,
    showReviewConversations,
    setShowReviewConversations,
    workspace,
    workspaceProjects,
    legacyWork,
    primaryProject,
    reviewConversationCount,
    automationConversations,
    latestWorkspaceConversation,
    talk,
    openProjectConversation,
  };
}
