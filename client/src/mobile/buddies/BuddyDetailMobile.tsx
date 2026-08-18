import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { allConversationIdsAtom } from '../../atoms/conversations';
import { createConversation } from '../../atoms/pending-creations';
import { asArray, buddyApi } from '../../components/buddies/api';
import {
  buildBuddyContextForTalk,
  countReviewConversations,
  deriveBuddyHierarchy,
  filterAutomationConversations,
  filterVisibleConversations,
  getLatestWorkspaceConversation,
  selectLegacyWorkForWorkspace,
  selectPrimaryProject,
  selectWorkspace,
  selectWorkspaceProjects,
} from '../../components/buddies/buddies-shaping';
import type {
  Buddy,
  BuddyAutomation,
  BuddyMemory,
  BuddyProject,
  ConversationLink,
  EmployeeRecord,
  EmployeeTab,
  LegacyWorkItem,
  Sprint,
  Workspace,
} from '../../components/buddies/types';
import { EMPTY_MEMORY } from '../../components/buddies/types';
import { EmptyState } from '../components/EmptyState';
import { AutomationsTab } from './BuddyDetailAutomationsTab';
import { ConversationsTab } from './BuddyDetailConversationsTab';
import { MemoryTab } from './BuddyDetailMemoryTab';
import { BuddyProfileEditor } from './BuddyDetailProfileEditor';
import { WorkTab } from './BuddyDetailWorkTab';

/**
 * BuddyDetailMobile — per-buddy detail at /buddies/:buddyId (mobile).
 *
 * Orchestrator: tab components are now sibling files (BuddyDetail*Tab.tsx)
 * to keep this file ~480 lines. Each tab imports only via sanctioned seams
 * (components/buddies/*, atoms, hooks, utils) — never desktop components.
 *
 * Tabs: work / conversations / memory / automations (EmployeeTab).
 * - All data via components/buddies/{api,types,ui-contract,buddies-shaping}
 *   imported verbatim — never desktop components.
 * - Conversation awareness ONLY via getConversationKind/matchConversationKind
 *   inside buddies-shaping helpers. No raw buddyContext field reads in this file
 *   (grep gate, PLANNING §4).
 * - Provider/model/effort are pass-through strings (no translation) using
 *   atoms/config-actions for conversation config and buddyApi PATCH for the
 *   buddy profile. Strings travel verbatim to the upstream CLI.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const TABS: readonly { id: EmployeeTab; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'conversations', label: 'Chats' },
  { id: 'memory', label: 'Memory' },
  { id: 'automations', label: 'Autos' },
] as const;

export function BuddyDetailMobile() {
  const { buddyId } = useParams<{ buddyId: string }>();
  const navigate = useNavigate();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableIds = useMemo(() => new Set(conversationIds), [conversationIds]);

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [memory, setMemory] = useState<BuddyMemory>(EMPTY_MEMORY);
  const [automations, setAutomations] = useState<BuddyAutomation[]>([]);
  const [activeTab, setActiveTab] = useState<EmployeeTab>('work');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [showReviewConversations, setShowReviewConversations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadGenerationRef = useState(() => ({ current: 0 }))[0];

  const loadEmployee = useCallback(
    async (signal?: AbortSignal, generation = loadGenerationRef.current) => {
      if (!buddyId) return;
      const encoded = encodeURIComponent(buddyId);
      const [detail, contextPayload, projectPayload] = await Promise.all([
        buddyApi<Record<string, unknown>>(`/api/buddies/${encoded}`, { signal }),
        buddyApi<Record<string, unknown>>(`/api/buddies/${encoded}/context`, { signal }),
        buddyApi<unknown>(`/api/buddies/${encoded}/projects?includeClosed=true`, { signal }),
      ]);
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      const buddy = (detail.buddy ?? detail) as unknown as Buddy;
      const workspaces = asArray<Workspace>(detail, 'workspaces');
      const relationships = asArray<{
        from_buddy_id: string;
        to_buddy_id: string;
        kind: string;
        from_buddy_name?: string;
        to_buddy_name?: string;
      }>(detail, 'relationships');
      const { manager, directReports } = deriveBuddyHierarchy(relationships, buddy.id);
      const legacyWorkItems = asArray<LegacyWorkItem>(detail, 'legacyWorkItems');
      const record: EmployeeRecord = {
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
        manager,
        directReports,
        reviews: asArray<EmployeeRecord['reviews'][number]>(detail, 'reviews'),
        approvals: asArray<EmployeeRecord['approvals'][number]>(detail, 'approvals'),
      };
      setEmployee(record);
      const preferredWorkspace =
        workspaces.find((candidate) =>
          legacyWorkItems.some((item) => item.project_id === candidate.id)
        ) ??
        workspaces.find((candidate) => candidate.slug !== 'buddies') ??
        workspaces[0];
      setSelectedWorkspaceId(preferredWorkspace?.id ?? '');
    },
    [buddyId, loadGenerationRef]
  );

  const loadMemory = useCallback(
    async (signal?: AbortSignal, generation = loadGenerationRef.current) => {
      if (!buddyId) return;
      const encoded = encodeURIComponent(buddyId);
      const [contextPayload, memoryPayload] = await Promise.all([
        buddyApi<Record<string, unknown>>(`/api/buddies/${encoded}/context`, { signal }),
        buddyApi<BuddyMemory>(`/api/buddies/${encoded}/memory`, { signal }),
      ]);
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setMemory({
        ...(memoryPayload ?? EMPTY_MEMORY),
        soul: typeof contextPayload.soul === 'string' ? contextPayload.soul : undefined,
        soulPath: employee?.buddy.soul_path ?? null,
      });
      setMemoryError(null);
    },
    [buddyId, employee?.buddy.soul_path, loadGenerationRef]
  );

  const loadAutomations = useCallback(
    async (signal?: AbortSignal, generation = loadGenerationRef.current) => {
      if (!buddyId) return;
      const encoded = encodeURIComponent(buddyId);
      const payload = await buddyApi<unknown>(`/api/buddies/${encoded}/automations`, { signal });
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setAutomations(asArray<BuddyAutomation>(payload, 'automations'));
      setAutomationError(null);
    },
    [buddyId, loadGenerationRef]
  );

  useEffect(() => {
    if (!buddyId) return;
    const generation = ++loadGenerationRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setActiveTab('work');
    setShowReviewConversations(false);
    setSelectedWorkspaceId('');
    setEmployee(null);
    setMemory(EMPTY_MEMORY);
    setAutomations([]);
    void loadEmployee(controller.signal, generation)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buddyId, loadEmployee, loadGenerationRef]);

  useEffect(() => {
    if (!buddyId || !employee) return;
    if (activeTab === 'work' || activeTab === 'conversations') return;
    const generation = loadGenerationRef.current;
    const controller = new AbortController();
    if (activeTab === 'memory') {
      void loadMemory(controller.signal, generation).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setMemoryError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    } else {
      void loadAutomations(controller.signal, generation).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setAutomationError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    }
    return () => controller.abort();
  }, [activeTab, buddyId, employee, loadAutomations, loadMemory, loadGenerationRef]);

  const workspace = useMemo(
    () => selectWorkspace(employee?.workspaces ?? [], selectedWorkspaceId),
    [employee?.workspaces, selectedWorkspaceId]
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
  const visibleConversations = useMemo(
    () =>
      filterVisibleConversations(
        employee?.conversations ?? [],
        showReviewConversations,
        availableIds
      ),
    [availableIds, employee?.conversations, showReviewConversations]
  );
  const reviewCount = useMemo(
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
          provider: (employee.buddy.provider || 'codex') as Buddy['provider'] & string as never,
          model: employee.buddy.model
            ? { mode: 'explicit', modelId: employee.buddy.model }
            : { mode: 'default' },
          reasoning: employee.buddy.reasoning_effort
            ? { mode: 'explicit', effort: employee.buddy.reasoning_effort }
            : { mode: 'default' },
        },
        buddyContext: context,
      });
      navigate(`/chat/${id}`);
    },
    [employee, navigate]
  );

  const openProjectConversation = useCallback(
    (targetWorkspace: Workspace, projectId: string) => {
      const existing = [...(employee?.conversations ?? [])]
        .filter((conversation) => {
          const conversationId =
            conversation.conversation_id ?? conversation.unleashd_conversation_id;
          return (
            conversation.buddy_project_id === projectId &&
            Boolean(conversationId && availableIds.has(conversationId))
          );
        })
        .sort(
          (left, right) =>
            new Date(right.last_active_at ?? 0).getTime() -
            new Date(left.last_active_at ?? 0).getTime()
        )[0];
      const conversationId = existing?.conversation_id ?? existing?.unleashd_conversation_id;
      if (conversationId) {
        navigate(`/chat/${conversationId}`);
        return;
      }
      talk(targetWorkspace, projectId);
    },
    [availableIds, employee?.conversations, navigate, talk]
  );

  if (!buddyId) {
    return (
      <div className="mobile-hub">
        <EmptyState icon="◎" message="No buddy selected." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mobile-hub" role="status" aria-live="polite" aria-busy="true">
        <p className="mobile-empty__message">Loading buddy…</p>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="mobile-hub">
        <EmptyState
          icon="⚠"
          title="Could not load buddy"
          message={error ?? 'Buddy not found.'}
          actionLabel="Back to Buddies"
          onAction={() => navigate('/buddies')}
        />
      </div>
    );
  }

  return (
    <div className="mobile-hub mobile-buddy-detail">
      <header className="mobile-buddy-detail__hero">
        <button
          type="button"
          className="mobile-buddy-detail__back"
          onClick={() => navigate('/buddies')}
          aria-label="Back to Buddies"
        >
          ← Buddies
        </button>
        <div className="mobile-buddy-detail__identity">
          <span className="mobile-buddy-card__avatar" aria-hidden="true">
            {initials(employee.buddy.name)}
          </span>
          <div className="mobile-buddy-detail__copy">
            <h1 className="mobile-buddy-detail__name">{employee.buddy.name}</h1>
            <p className="mobile-buddy-detail__role">{employee.buddy.role}</p>
            <span
              className={`mobile-buddy-card__presence mobile-buddy-card__presence--${employee.buddy.status}`}
            >
              {employee.buddy.status}
            </span>
          </div>
        </div>
        <div className="mobile-buddy-detail__meta">
          <span>
            Reports to <strong>{employee.manager?.name ?? 'Owner'}</strong>
          </span>
          <span>
            {employee.skills.length} {employee.skills.length === 1 ? 'skill' : 'skills'}
          </span>
        </div>

        {/* Sub-buddies get their own block rather than inline links in the meta
            row, where they ran together as one unbroken string ("3 reports:
            AliceBobCarol") and read as prose instead of navigation. This is the
            ONLY route to a sub-buddy: the Buddies directory lists `topLevel`
            only, i.e. buddies with no manager. */}
        {employee.directReports.length > 0 && (
          <div className="mobile-buddy-reports">
            <span className="mobile-buddy-reports__title">
              {employee.directReports.length}{' '}
              {employee.directReports.length === 1 ? 'sub-buddy' : 'sub-buddies'}
            </span>
            <div className="mobile-buddy-reports__list">
              {employee.directReports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  className="mobile-buddy-reports__item"
                  onClick={() => navigate(`/buddies/${encodeURIComponent(report.id)}`)}
                >
                  {report.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <BuddyProfileEditor
          buddy={employee.buddy}
          busy={busy === 'profile'}
          error={profileError}
          onBusy={(value) => setBusy(value ? 'profile' : null)}
          onError={setProfileError}
          onSaved={() => void loadEmployee().catch(() => {})}
        />
      </header>

      <nav className="mobile-buddy-detail__tabs" aria-label="Buddy sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={
              activeTab === tab.id
                ? 'mobile-buddy-detail__tab mobile-buddy-detail__tab--active'
                : 'mobile-buddy-detail__tab'
            }
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'work' && (
        <WorkTab
          employee={employee}
          workspace={workspace}
          workspaces={employee.workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={setSelectedWorkspaceId}
          workspaceProjects={workspaceProjects}
          legacyWork={legacyWork}
          primaryProject={primaryProject}
          latestWorkspaceConversation={latestWorkspaceConversation}
          onTalk={talk}
          onOpenProjectConversation={openProjectConversation}
        />
      )}

      {activeTab === 'conversations' && (
        <ConversationsTab
          visibleConversations={visibleConversations}
          reviewCount={reviewCount}
          showReviewConversations={showReviewConversations}
          onToggleReviews={() => setShowReviewConversations((value) => !value)}
          onOpenConversation={(conversationId) => navigate(`/chat/${conversationId}`)}
          workspace={workspace}
          onTalk={() => workspace && talk(workspace)}
          availableIds={availableIds}
          busy={busy}
        />
      )}

      {activeTab === 'memory' && (
        <MemoryTab
          memory={memory}
          error={memoryError}
          buddy={employee.buddy}
          onRetry={() => {
            const controller = new AbortController();
            void loadMemory(controller.signal).catch((cause: unknown) =>
              setMemoryError(cause instanceof Error ? cause.message : String(cause))
            );
          }}
        />
      )}

      {activeTab === 'automations' && (
        <AutomationsTab
          buddyId={employee.buddy.id}
          workspaceId={workspace?.id}
          automations={automations}
          automationConversations={automationConversations}
          busy={busy}
          setBusy={setBusy}
          error={automationError}
          onOpenConversation={(conversationId) => navigate(`/chat/${conversationId}`)}
          onRefresh={() =>
            loadAutomations().catch((cause: unknown) =>
              setAutomationError(cause instanceof Error ? cause.message : String(cause))
            )
          }
        />
      )}
    </div>
  );
}
