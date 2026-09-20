import { buddyWorkGroupsAtom } from '../atoms/buddy-work';
import { BuddyConversationList } from './buddies/BuddyConversationList';
import { BuddySectionNav } from './buddies/BuddySectionNav';
import './buddies/BuddyTeamExecution.css';
import { archivedBuddyIdsAtom } from '../atoms/buddy-visibility';
import { newId } from '../utils/ids';
import { BuddySettings } from './buddies/BuddySettings';
import { BuddyTeamExecution } from './buddies/BuddyTeamExecution';
import './buddies/BuddyMessages.css';
import './buddies/BuddyCoordination.css';
import './buddies/BuddySoulConflict.css';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { allConversationIdsAtom } from '../atoms/conversations';
import { useBuddyOverview, useBuddyPage } from '../hooks/useBuddyData';
import { BuddyAutomationsTab } from './buddies/BuddyAutomationsTab';
import { BuddyBackgroundTasks } from './buddies/BuddyBackgroundTasks';
import { buddyApi as api } from './buddies/api';
import './buddies/BuddyBackgroundTasks.css';
import { BuddyCoordination } from './buddies/BuddyCoordination';
import { BuddyDirectory } from './buddies/BuddyDirectory';
import { BuddyExecutionProfile } from './buddies/BuddyExecutionProfile';
import { BuddyMemoryWorkspace } from './buddies/BuddyMemoryWorkspace';
import { BuddyMessages } from './buddies/BuddyMessages';
import { BuddyProjectExecution } from './buddies/BuddyProjectExecution';
import './buddies/BuddyProjectExecution.css';
import { buddyTabPath, parseEmployeeTab } from './buddies/buddy-tabs';
import { createBuddyViaBuilder } from './buddies/create-buddy-builder';
import type { BuddyProject, EmployeeTab, WorkStatus } from './buddies/types';
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
  // The tab is the URL, not state. `routedTab === null` means the URL is not
  // canonical yet (`/buddies/:id`, or a junk segment); we render the default
  // tab's redirect below rather than showing one tab under another tab's URL.
  const archived = useAtomValue(archivedBuddyIdsAtom);
  const routedTab = parseEmployeeTab(tabSegment);
  const activeTab: EmployeeTab = routedTab ?? (buddyId ? 'conversations' : 'work');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shared with mobile (hooks/useBuddyData.ts): one cache key per Buddy, so
  // Back onto a Buddy you just left renders from cache with no spinner.
  const overviewFetch = useBuddyOverview(0, !buddyId);
  const overview = overviewFetch.data;
  const openConversation = useCallback((id: string) => navigate(`/chat/${id}`), [navigate]);
  const {
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
  } = useBuddyPage(buddyId, activeTab, availableConversationIds, openConversation);
  const loadError = (buddyId ? detail.error : overviewFetch.error)?.message ?? null;
  const workGroupsAtom = useMemo(() => buddyWorkGroupsAtom(workspaceProjects), [workspaceProjects]);
  const workGroups = useAtomValue(workGroupsAtom);

  const mutate = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await detail.refetch();
      // Automations are a separate route-backed projection, not part of employee detail.
      // Reloading only the employee made successful toggle/run/archive actions look as if
      // they had failed. Keep the UI derived from durable server state; do not patch cards
      // optimistically with a second client lifecycle. Design rationale:
      // agent_notes/2026-08-24_automation-execution-ownership-design.md §6/I1, §14/8.
      if (activeTab === 'automations') await automationsFetch.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

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

  if (buddyId && archived.has(buddyId)) return <Navigate to="/buddies" replace />;

  // Canonicalise `/buddies/:id` (and any junk tab segment) onto a real tab URL.
  // `replace` keeps Back pointing at whatever linked here, not at a redirect loop.
  if (buddyId && routedTab === null) {
    return <Navigate to={buddyTabPath(buddyId, activeTab)} replace />;
  }

  if (loadError && !employee) {
    return (
      <div className="buddies-dashboard buddies-dashboard--centered">
        <div className="buddies-error">{loadError}</div>
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

  const renderWorkProject = (project: BuddyProject) => {
    const todoProgress = buddyProjectTodoProgress(project);
    const existingConversation = employee.conversations.some((conversation) => {
      const conversationId = conversation.conversation_id ?? conversation.unleashd_conversation_id;
      return (
        conversation.buddy_project_id === project.id &&
        Boolean(conversationId && availableConversationIds.has(conversationId))
      );
    });
    return (
      <details className="buddy-work-disclosure" key={project.id}>
        <summary>
          <strong>{project.title}</strong>
          <span>
            {STATUS_LABELS[project.status]} · {todoProgress.done}/{todoProgress.total} todos
          </span>
        </summary>
        <div className={`buddy-work-card status-${project.status}`}>
          <div className="buddy-work-card__body">
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
        </div>
      </details>
    );
  };

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
              <details className="buddy-detail-about">
                <summary>About this Buddy</summary>
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
              </details>
            </div>
          </div>
          <div className="buddy-hero-actions">
            {workspace && activeTab !== 'conversations' && (
              <button className="buddy-start-button" type="button" onClick={() => talk(workspace)}>
                Start conversation
              </button>
            )}
          </div>
        </div>
        <BuddySectionNav buddyId={employee.buddy.id} activeTab={activeTab} />
      </header>

      <main className="buddies-content">
        {activeTab === 'mailbox' && (
          <BuddyMessages
            key={employee.buddy.id}
            buddyId={employee.buddy.id}
            workspaceId={workspace?.id}
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
              await detail.refetch();
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
                    await detail.refetch();
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
              <span>{workGroups.current.length} open</span>
            </div>
            <div className="buddy-work-list">{workGroups.current.map(renderWorkProject)}</div>
            {workGroups.completed.length > 0 && (
              <details className="buddy-work-history">
                <summary>Completed & cancelled · {workGroups.completed.length}</summary>
                <div className="buddy-work-list">{workGroups.completed.map(renderWorkProject)}</div>
              </details>
            )}

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
            <BuddyConversationList
              links={employee.conversations}
              showReviewConversations={showReviewConversations}
            />
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
