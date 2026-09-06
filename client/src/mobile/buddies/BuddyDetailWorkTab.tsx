import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { allConversationIdsAtom } from '../../atoms/conversations';
import type {
  BuddyProject,
  ConversationLink,
  EmployeeRecord,
  LegacyWorkItem,
  Workspace,
} from '../../components/buddies/types';
import { buddyProjectTodoProgress } from '../../components/buddies/ui-contract';
import { EmptyState } from '../components/EmptyState';

// ---------------------------------------------------------------------------
// Work tab (uses shaping helpers, no raw buddyContext)
// ---------------------------------------------------------------------------

export function WorkTab({
  employee,
  workspace,
  workspaces,
  selectedWorkspaceId: _selectedWorkspaceId,
  onSelectWorkspace,
  workspaceProjects,
  legacyWork,
  primaryProject,
  latestWorkspaceConversation,
  onTalk,
  onOpenProjectConversation,
}: {
  employee: EmployeeRecord;
  workspace: Workspace | undefined;
  workspaces: Workspace[];
  selectedWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  workspaceProjects: BuddyProject[];
  legacyWork: LegacyWorkItem[];
  primaryProject: BuddyProject | undefined;
  latestWorkspaceConversation: ConversationLink | undefined;
  onTalk: (workspace: Workspace, buddyProjectId?: string) => void;
  onOpenProjectConversation: (workspace: Workspace, projectId: string) => void;
}) {
  const availableIds = useAtomValue(allConversationIdsAtom);
  const availableSet = useMemo(() => new Set(availableIds), [availableIds]);

  return (
    <section className="mobile-buddy-section" aria-label="Work">
      <label className="mobile-buddy-section__label">
        Workspace
        <select
          value={workspace?.id ?? ''}
          onChange={(event) => onSelectWorkspace(event.target.value)}
          className="mobile-buddy-section__select"
        >
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {workspace && <p className="mobile-muted">{workspace.root_path}</p>}

      <div className="mobile-buddy-summary">
        <div className="mobile-buddy-summary__row">
          <span>Primary next action</span>
          <strong>{primaryProject?.next_action ?? 'Choose a next action in conversation'}</strong>
        </div>
        <div className="mobile-buddy-summary__row">
          <span>Last run</span>
          <strong>
            {latestWorkspaceConversation?.last_active_at
              ? new Date(latestWorkspaceConversation.last_active_at).toLocaleString()
              : 'No run recorded'}
          </strong>
        </div>
      </div>

      <h2 className="mobile-buddy-section__heading">
        Current tasks ·{' '}
        {
          workspaceProjects.filter((project) => !['done', 'cancelled'].includes(project.status))
            .length
        }{' '}
        open
      </h2>

      <div className="mobile-buddy-work-list">
        {workspaceProjects
          .filter((project) => !['done', 'cancelled'].includes(project.status))
          .map((project) => {
            const progress = buddyProjectTodoProgress(project);
            const hasConversation = employee.conversations.some((conversation) => {
              const conversationId =
                conversation.conversation_id ?? conversation.unleashd_conversation_id;
              return (
                conversation.buddy_project_id === project.id &&
                Boolean(conversationId && availableSet.has(conversationId))
              );
            });
            return (
              <article
                key={project.id}
                className={`mobile-buddy-work-card mobile-buddy-work-card--${project.status}`}
              >
                <div className="mobile-buddy-work-card__header">
                  <h3>{project.title}</h3>
                  <span className={`mobile-badge mobile-badge--${project.status}`}>
                    {project.status}
                  </span>
                </div>
                <p className="mobile-muted">Next action: {project.next_action ?? 'Not set'}</p>
                {project.blocked_reason && (
                  <p className="mobile-buddy-work-card__blocker">
                    Blocker: {project.blocked_reason}
                  </p>
                )}
                <p className="mobile-muted">
                  Todos: {progress.done}/{progress.total}
                </p>
                <button
                  type="button"
                  disabled={!workspace}
                  className="mobile-cta"
                  onClick={() => workspace && onOpenProjectConversation(workspace, project.id)}
                >
                  {hasConversation ? 'Open conversation' : 'Start conversation'}
                </button>
              </article>
            );
          })}
        {workspaceProjects.filter((project) => !['done', 'cancelled'].includes(project.status))
          .length === 0 && <EmptyState message="No open tasks for this workspace." />}
      </div>

      {legacyWork.length > 0 && (
        <>
          <h3 className="mobile-buddy-section__heading">Legacy work</h3>
          <div className="mobile-buddy-work-list">
            {legacyWork.map((item) => (
              <article
                key={item.id}
                className={`mobile-buddy-work-card mobile-buddy-work-card--${item.status}`}
              >
                <h4>{item.title}</h4>
                <p className="mobile-muted">Next: {item.next_action ?? '—'}</p>
                <button
                  type="button"
                  disabled={!workspace}
                  className="mobile-cta mobile-cta--secondary"
                  onClick={() => workspace && onTalk(workspace)}
                >
                  Open buddy conversation
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
