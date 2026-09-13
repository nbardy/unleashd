import './buddies/BuddyTeamExecution.css';
import { BuddyTeamExecution } from './buddies/BuddyTeamExecution';
import { newId } from '../utils/ids';
import { archivedBuddyIdsAtom } from '../atoms/buddy-visibility';
import { BuddySettings } from './buddies/BuddySettings';
import './buddies/BuddyMessages.css';
import './buddies/BuddyCoordination.css';
import './buddies/BuddySoulConflict.css';
import { BuddyTeamStateSchema } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { createConversation } from '../atoms/actions';
import { allConversationIdsAtom } from '../atoms/conversations';
import { BuddyAutomationsTab } from './buddies/BuddyAutomationsTab';
import { BuddyBackgroundTasks } from './buddies/BuddyBackgroundTasks';
import './buddies/BuddyBackgroundTasks.css';
import { BuddyCoordination } from './buddies/BuddyCoordination';
import { BuddyDirectory } from './buddies/BuddyDirectory';
import { BuddyExecutionProfile } from './buddies/BuddyExecutionProfile';
import { BuddyMemoryWorkspace } from './buddies/BuddyMemoryWorkspace';
import { BuddyMessages } from './buddies/BuddyMessages';
import { BuddyProjectExecution } from './buddies/BuddyProjectExecution';
import './buddies/BuddyProjectExecution.css';
import { buddyApi as api, asArray } from './buddies/api';
import {
  buildBuddyContextForTalk,
  countReviewConversations,
  filterAutomationConversations,
  filterVisibleConversations,
  getLatestWorkspaceConversation,
  selectLegacyWorkForWorkspace,
  selectPrimaryProject,
  selectWorkspace,
  selectWorkspaceProjects,
} from './buddies/buddies-shaping';
import {
  EMPLOYEE_TABS,
  EMPLOYEE_TAB_LABELS,
  buddyTabPath,
  parseEmployeeTab,
} from './buddies/buddy-tabs';
import { createBuddyViaBuilder } from './buddies/create-buddy-builder';
import {
  type Buddy,
  type BuddyAutomation,
  type BuddyOverview,
  type BuddyProject,
  type ConversationLink,
  type EmployeeRecord,
  type EmployeeTab,
  type LegacyWorkItem,
  type Sprint,
  type WorkStatus,
  type Workspace,
} from './buddies/types';
import { buddyProjectTodoProgress } from './buddies/ui-contract';
import './BuddiesDashboard.css';

const STATUS_LABELS: Record<WorkStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function compactPath(path: string | null): string {
  if (!path) return 'No source linked';
  return path.replace(/^\/Users\/[^/]+\/git\//, '~/git/');
}

export function BuddiesDashboard() {
  const navigate = useNavigate();
  const { buddyId, tab: tabSegment } = useParams();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableConversationIds = useMemo(() => new Set(conversationIds), [conversationIds]);
  const [overview, setOverview] = useState<BuddyOverview | null>(null);
  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [automations, setAutomations] = useState<BuddyAutomation[]>([]);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  // The tab is the URL, not state. `routedTab === null` means the URL is not
  // canonical yet (`/buddies/:id`, or a junk segment); we render the default
  // tab's redirect below rather than showing one tab under another tab's URL.
  const archived = useAtomValue(archivedBuddyIdsAtom);
  const routedTab = parseEmployeeTab(tabSegment);
  const activeTab: EmployeeTab = routedTab ?? (buddyId ? 'conversations' : 'work');
  const [showReviewConversations, setShowReviewConversations] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const loadDirectory = useCallback(
    async (signal?: AbortSignal, generation = loadGenerationRef.current) => {
      const payload = await api<BuddyOverview>('/api/buddies/overview', { signal });
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setOverview(payload);
    },
    []
  );

  const loadEmployee = useCallback(
    async (signal?: AbortSignal, generation = loadGenerationRef.current) => {
      if (!buddyId) return;
      const encoded = encodeURIComponent(buddyId);
      const [detail, contextPayload, projectPayload] = await Promise.all([
        api<Record<string, unknown>>(`/api/buddies/${encoded}`, { signal }),
        api<Record<string, unknown>>(`/api/buddies/${encoded}/context`, { signal }),
        api<unknown>(`/api/buddies/${encoded}/projects?includeClosed=true`, { signal }),
      ]);
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      const buddy = (detail.buddy ?? detail) as unknown as Buddy;
      const workspaces = asArray<Workspace>(detail, 'workspaces');
      const teamState = BuddyTeamStateSchema.parse(detail);
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
        manager: teamState.manager,
        directReports: teamState.team,
        messages: asArray<EmployeeRecord['messages'][number]>(detail, 'messages'),
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
    [buddyId]
  );

  const loadAutomations = useCallback(
    async (signal?: AbortSignal, generation = loadGenerationRef.current) => {
      if (!buddyId) return;
      const encoded = encodeURIComponent(buddyId);
      const automationPayload = await api<unknown>(`/api/buddies/${encoded}/automations`, {
        signal,
      });
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setAutomations(asArray<BuddyAutomation>(automationPayload, 'automations'));
      setAutomationError(null);
    },
    [buddyId]
  );

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const controller = new AbortController();
    setError(null);
    // Deliberately does NOT reset the tab: the tab is the URL now. Slamming it
    // to 'conversations' on every buddy mount is what made Back out of a thread
    // land on the Conversations list instead of the tab you left from.
    if (buddyId) {
      setEmployee(null);
      setAutomations([]);
      setAutomationError(null);
      setSelectedWorkspaceId('');
      setShowReviewConversations(false);
    }
    const loading = buddyId
      ? loadEmployee(controller.signal, generation)
      : loadDirectory(controller.signal, generation);
    void loading.catch((cause: unknown) => {
      if (!controller.signal.aborted && generation === loadGenerationRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => controller.abort();
  }, [buddyId, loadDirectory, loadEmployee, archived]);

  useEffect(() => {
    if (!buddyId || !employee || activeTab === 'work' || activeTab === 'conversations') return;
    const generation = loadGenerationRef.current;
    const controller = new AbortController();
    if (activeTab !== 'automations') return;
    void loadAutomations(controller.signal, generation).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setAutomationError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => controller.abort();
  }, [activeTab, buddyId, employee, loadAutomations]);

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
        availableConversationIds
      ),
    [availableConversationIds, employee?.conversations, showReviewConversations]
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

  const mutate = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await loadEmployee();
      // Automations are a separate route-backed projection, not part of employee detail.
      // Reloading only the employee made successful toggle/run/archive actions look as if
      // they had failed. Keep the UI derived from durable server state; do not patch cards
      // optimistically with a second client lifecycle. Design rationale:
      // agent_notes/2026-08-24_automation-execution-ownership-design.md §6/I1, §14/8.
      if (activeTab === 'automations') await loadAutomations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

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
      navigate(`/chat/${id}`);
    },
    [employee, navigate]
  );

  const openBuddyBuilder = async () => {
    setBusy('buddy-builder');
    setError(null);
    try {
      const conversationId = await createBuddyViaBuilder();
      navigate(`/chat/${conversationId}?helper=buddies`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const openProjectConversation = (targetWorkspace: Workspace, projectId: string) => {
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
      navigate(`/chat/${conversationId}`);
      return;
    }
    talk(targetWorkspace, projectId);
  };

  if (buddyId && archived.has(buddyId)) return <Navigate to="/buddies" replace />;

  // Canonicalise `/buddies/:id` (and any junk tab segment) onto a real tab URL.
  // `replace` keeps Back pointing at whatever linked here, not at a redirect loop.
  if (buddyId && routedTab === null) {
    return <Navigate to={buddyTabPath(buddyId, activeTab)} replace />;
  }

  if (error && !employee) {
    return (
      <div className="buddies-dashboard buddies-dashboard--centered">
        <div className="buddies-error">{error}</div>
      </div>
    );
  }
  if (!buddyId && overview) {
    return (
      <div className="buddies-dashboard">
        {error && <div className="buddies-error">{error}</div>}
        <BuddyDirectory
          overview={overview}
          onOpen={(id) => navigate(`/buddies/${id}`)}
          onNew={() => void openBuddyBuilder()}
          creating={busy === 'buddy-builder'}
        />
      </div>
    );
  }
  if (!employee) {
    return (
      <div className="buddies-dashboard buddies-dashboard--centered">
        <div className="buddies-loading">Loading employee…</div>
      </div>
    );
  }

  return (
    <div className="buddies-dashboard">
      <header className="buddies-hero">
        <div className="buddies-hero-main">
          <div className="buddy-identity">
            <button
              type="button"
              className="buddy-back-button"
              onClick={() => navigate('/buddies')}
              aria-label="Back to all Buddies"
            >
              ←
            </button>
            <div className="buddy-avatar" aria-hidden="true">
              {initials(employee.buddy.name)}
            </div>
            <div className="buddy-identity-copy">
              <div className="buddy-identity-title">
                <h1>{employee.buddy.name}</h1>
                <span>{employee.buddy.status}</span>
              </div>
              <p>{employee.buddy.role}</p>
              <div className="buddy-identity-meta">
                <span>
                  Reports to{' '}
                  {employee.manager ? (
                    <Link to={`/buddies/${encodeURIComponent(employee.manager.id)}`}>
                      {employee.manager.name}
                    </Link>
                  ) : (
                    <strong>Owner</strong>
                  )}
                </span>
                {employee.directReports.length > 0 ? (
                  <details className="buddy-report-menu">
                    <summary>
                      {employee.directReports.length}{' '}
                      {employee.directReports.length === 1 ? 'report' : 'reports'}
                    </summary>
                    <div>
                      {employee.directReports.map((report) => (
                        <Link to={`/buddies/${report.id}`} key={report.id}>
                          <strong>{report.name}</strong>
                          <span>{report.status === 'archived' ? 'Archived' : report.role} →</span>
                        </Link>
                      ))}
                    </div>
                  </details>
                ) : (
                  <span>0 reports</span>
                )}
                <span
                  title={
                    employee.skills.length > 0
                      ? employee.skills.map((skill) => skill.name).join(', ')
                      : 'No structured skills'
                  }
                >
                  {employee.skills.length} {employee.skills.length === 1 ? 'skill' : 'skills'}
                </span>
              </div>
            </div>
          </div>
          <div className="buddy-hero-actions">
            <BuddyExecutionProfile
              key={`${employee.buddy.id}:${employee.buddy.provider}:${employee.buddy.model}:${employee.buddy.reasoning_effort}`}
              buddy={employee.buddy}
              busy={busy !== null}
              onSave={(profile) =>
                mutate('profile', () =>
                  api('/api/buddies/resources/update_profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      workspaceId: workspace?.id,
                      targetBuddyId: employee.buddy.id,
                      baseRevision: employee.buddy.profile_revision,
                      key: newId(),
                      reason: 'Owner edited execution settings',
                      changes: profile,
                    }),
                  })
                )
              }
            />
            {workspace && (
              <button className="buddy-start-button" type="button" onClick={() => talk(workspace)}>
                Start conversation
              </button>
            )}
          </div>
        </div>
        <nav
          className="buddy-section-tabs buddy-section-tabs--header"
          aria-label="Employee sections"
        >
          {EMPLOYEE_TABS.map((tab) => (
            <Link
              key={tab}
              to={buddyTabPath(employee.buddy.id, tab)}
              className={activeTab === tab ? 'active' : ''}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {EMPLOYEE_TAB_LABELS[tab]}
            </Link>
          ))}
        </nav>
      </header>

      <main className="buddies-content">
        {activeTab === 'mailbox' && (
          <BuddyMessages
            key={employee.buddy.id}
            buddyId={employee.buddy.id}
            buddyNames={Object.fromEntries(
              [
                employee.buddy,
                ...employee.directReports,
                ...(employee.manager ? [employee.manager] : []),
              ].map((member) => [member.id, member.name])
            )}
            messages={employee.messages}
            availableConversationIds={availableConversationIds}
            onReply={async (messageId, reply) => {
              await api(`/api/buddies/messages/${encodeURIComponent(messageId)}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reply),
              });
              await loadEmployee();
            }}
          />
        )}
        {activeTab === 'work' && employee.directReports.length > 0 && workspace && (
          <details className="buddy-lead-tools">
            <summary>Send work or request a review</summary>
            <form
              className="buddy-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                setBusy('send');
                void api(`/api/buddies/${encodeURIComponent(employee.buddy.id)}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to: data.get('reportId'),
                    workspaceId: workspace.id,
                    purpose: data.get('purpose'),
                    body: data.get('body'),
                    evidence: String(data.get('evidence') ?? '')
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
                  }),
                })
                  .then(async () => {
                    form.reset();
                    await loadEmployee();
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause))
                  )
                  .finally(() => setBusy(null));
              }}
            >
              <select name="reportId" aria-label="Direct report">
                {employee.directReports.map(
                  (report) =>
                    report.status === 'active' && (
                      <option value={report.id} key={report.id}>
                        {report.name} · {report.role}
                      </option>
                    )
                )}
              </select>
              <input
                name="purpose"
                required
                aria-label="Purpose"
                placeholder="Purpose, such as review or implementation"
              />
              <textarea
                name="body"
                required
                aria-label="Request"
                placeholder="Outcome, context, and expected evidence"
              />
              <textarea
                name="evidence"
                aria-label="Evidence"
                placeholder="Supporting references, one per line"
              />
              <button type="submit" disabled={busy !== null}>
                Send message
              </button>
            </form>
          </details>
        )}

        {activeTab === 'work' && (
          <section className="buddy-section">
            <div className="buddy-toolbar">
              <label>
                Workspace
                <select
                  value={workspace?.id ?? ''}
                  onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                >
                  {employee.workspaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {workspace && <span>{compactPath(workspace.root_path)}</span>}
            </div>

            <div className="buddy-current-summary">
              <div>
                <span>Current sprint</span>
                <strong>
                  {workspaceProjects.find((project) => project.sprint_name)?.sprint_name ??
                    'No active sprint'}
                </strong>
              </div>
              <div>
                <span>Primary next action</span>
                <strong>
                  {primaryProject?.next_action ?? 'Choose a next action in conversation'}
                </strong>
              </div>
              <div>
                <span>Last run</span>
                <strong>
                  {latestWorkspaceConversation?.last_active_at
                    ? new Date(latestWorkspaceConversation.last_active_at).toLocaleString()
                    : 'No run recorded'}
                </strong>
              </div>
            </div>

            <div className="buddy-section-heading">
              <h2>Current tasks</h2>
              <span>
                {
                  workspaceProjects.filter(
                    (project) => !['done', 'cancelled'].includes(project.status)
                  ).length
                }{' '}
                open
              </span>
            </div>
            <div className="buddy-work-list">
              {workspaceProjects.map((project) => {
                const todoProgress = buddyProjectTodoProgress(project);
                const existingConversation = employee.conversations.some((conversation) => {
                  const conversationId =
                    conversation.conversation_id ?? conversation.unleashd_conversation_id;
                  return (
                    conversation.buddy_project_id === project.id &&
                    Boolean(conversationId && availableConversationIds.has(conversationId))
                  );
                });
                return (
                  <article className={`buddy-work-card status-${project.status}`} key={project.id}>
                    <span
                      className="buddy-task-status"
                      role="img"
                      aria-label={STATUS_LABELS[project.status]}
                    >
                      {project.status === 'done' ? '✓' : ''}
                    </span>
                    <div className="buddy-work-card__body">
                      <div className="buddy-work-card__title">
                        <h3>{project.title}</h3>
                        <span className={`buddy-work-status status-${project.status}`}>
                          {STATUS_LABELS[project.status]}
                        </span>
                      </div>
                      <div className="buddy-work-card__operations">
                        <span>
                          <strong>Next action</strong>
                          {project.next_action ?? 'Not set'}
                        </span>
                        {project.blocked_reason && (
                          <span className="buddy-work-blocker">
                            <strong>Blocker</strong>
                            {project.blocked_reason}
                          </span>
                        )}
                        <span className="buddy-work-todos">
                          <strong>Todos</strong>
                          {todoProgress.done}/{todoProgress.total}
                        </span>
                      </div>
                      <BuddyProjectExecution
                        project={project}
                        availableConversationIds={availableConversationIds}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!workspace}
                      onClick={() => workspace && openProjectConversation(workspace, project.id)}
                    >
                      {existingConversation ? 'Open conversation' : 'Start conversation'}
                    </button>
                  </article>
                );
              })}
            </div>

            {legacyWork.length > 0 && (
              <details className="buddy-legacy">
                <summary>Import provenance ({legacyWork.length})</summary>
                {legacyWork.map((item) => (
                  <div key={item.id}>
                    <strong>{item.title}</strong>
                    <span>
                      {STATUS_LABELS[item.status]} · {item.next_action ?? 'No next action'}
                    </span>
                  </div>
                ))}
              </details>
            )}
          </section>
        )}

        {activeTab === 'conversations' && (
          <section className="buddy-section">
            <div className="buddy-section-heading">
              <div>
                <h2>Conversations</h2>
                <span>Direct and project conversations</span>
              </div>
              <div className="buddy-conversation-controls">
                {reviewConversationCount > 0 && (
                  <button
                    type="button"
                    className={showReviewConversations ? 'active' : ''}
                    aria-pressed={showReviewConversations}
                    onClick={() => setShowReviewConversations((current) => !current)}
                  >
                    {showReviewConversations ? 'Hide' : 'Include'} reviews (
                    {reviewConversationCount})
                  </button>
                )}
                {workspace && (
                  <button type="button" onClick={() => talk(workspace)}>
                    Start conversation
                  </button>
                )}
              </div>
            </div>
            <div className="buddy-record-list">
              {visibleConversations.map((link) => {
                const conversationId = link.conversation_id ?? link.unleashd_conversation_id;
                if (!conversationId) return null;
                const isAvailable = availableConversationIds.has(conversationId);
                const cardContents = (
                  <>
                    <div>
                      <strong>
                        {link.kind === 'review'
                          ? 'Employee review'
                          : link.buddy_project_id
                            ? (employee.projects.find(
                                (project) => project.id === link.buddy_project_id
                              )?.title ?? 'Project conversation')
                            : 'General conversation'}
                      </strong>
                      <span>
                        {link.status} ·{' '}
                        {link.last_active_at
                          ? new Date(link.last_active_at).toLocaleString()
                          : 'No activity recorded'}
                      </span>
                    </div>
                    <span className="buddy-conversation-card__action">
                      {isAvailable ? 'Open →' : 'Unavailable'}
                    </span>
                  </>
                );
                if (!isAvailable) {
                  return (
                    <div
                      aria-disabled="true"
                      className="buddy-conversation-card buddy-conversation-card--unavailable"
                      key={link.id ?? conversationId}
                    >
                      {cardContents}
                    </div>
                  );
                }
                return (
                  <Link
                    className="buddy-conversation-card"
                    to={`/chat/${conversationId}`}
                    key={link.id ?? conversationId}
                  >
                    {cardContents}
                  </Link>
                );
              })}
              {visibleConversations.length === 0 && (
                <p className="buddy-empty">No direct conversations yet.</p>
              )}
            </div>
          </section>
        )}

        {activeTab === 'background' && (
          <BuddyBackgroundTasks buddyId={employee.buddy.id} workspaces={employee.workspaces} />
        )}

        {activeTab === 'memory' && (
          <BuddyMemoryWorkspace
            key={`${employee.buddy.id}:${workspace?.id}`}
            buddy={employee.buddy}
            workspaceId={workspace?.id ?? ''}
            variant="desktop"
          />
        )}

        {activeTab === 'team' && workspace && (
          <BuddyTeamExecution
            key={`${employee.buddy.id}:${workspace.id}`}
            buddyId={employee.buddy.id}
            workspaceId={workspace.id}
            availableConversationIds={availableConversationIds}
          />
        )}
        {activeTab === 'settings' && (
          <>
            <BuddyCoordination
              key={employee.buddy.id}
              buddyId={employee.buddy.id}
              availableConversationIds={availableConversationIds}
            />
            <BuddySettings buddyId={employee.buddy.id} name={employee.buddy.name} />
          </>
        )}

        {activeTab === 'automations' && (
          <>
            {automationError && (
              <div className="buddies-error" role="alert">
                Automations are unavailable: {automationError}
              </div>
            )}
            <BuddyAutomationsTab
              automations={automations}
              approvals={employee.approvals ?? []}
              busy={busy !== null}
              mutate={mutate}
              availableConversationIds={availableConversationIds}
              automationConversations={automationConversations}
            />
          </>
        )}
      </main>
      {error && (
        <div className="buddies-toast" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
