import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { buddyWorkGroupsAtom } from '../../atoms/buddy-work';
import { availableConversationIdSetAtom } from '../../atoms/conversations';
import { BuddyProjectExecution } from '../../components/buddies/BuddyProjectExecution';
import { projectConversation } from '../../components/buddies/buddies-shaping';
import type {
  BuddyProject,
  ConversationLink,
  EmployeeRecord,
  LegacyWorkItem,
  Workspace,
} from '../../components/buddies/types';
import { TASK_STATUS, buddyProjectTodoProgress } from '../../components/buddies/ui-contract';
import { EmptyState } from '../components/EmptyState';

// ---------------------------------------------------------------------------
// Work tab (uses shaping helpers, no raw buddyContext)
// ---------------------------------------------------------------------------

export function WorkTab({
  employee,
  workspace,
  workspaces,
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
  onSelectWorkspace: (id: string) => void;
  workspaceProjects: BuddyProject[];
  legacyWork: LegacyWorkItem[];
  primaryProject: BuddyProject | undefined;
  latestWorkspaceConversation: ConversationLink | undefined;
  onTalk: (workspace: Workspace, buddyProjectId?: string) => void;
  onOpenProjectConversation: (workspace: Workspace, projectId: string) => void;
}) {
  const availableSet = useAtomValue(availableConversationIdSetAtom);

  const groupsAtom = useMemo(() => buddyWorkGroupsAtom(workspaceProjects), [workspaceProjects]);
  const groups = useAtomValue(groupsAtom);

  const renderProject = (project: BuddyProject) => {
    const progress = buddyProjectTodoProgress(project);
    const hasConversation =
      projectConversation(employee.conversations, project.id, availableSet) !== null;
    return (
      <details key={project.id} className="mobile-buddy-work-item">
        <summary className="mobile-buddy-work-item__summary">
          <strong>{project.title}</strong>
          <span>
            {TASK_STATUS[project.status].label} · {progress.done}/{progress.total} todos
          </span>
        </summary>
        <div className="mobile-buddy-work-item__body">
          <p className="mobile-muted">Next action: {project.next_action ?? 'Not set'}</p>
          {project.blocked_reason && (
            <p className="mobile-buddy-work-card__blocker">Blocker: {project.blocked_reason}</p>
          )}
          <BuddyProjectExecution project={project} availableConversationIds={availableSet} />
          <button
            type="button"
            disabled={!workspace}
            className="mobile-cta"
            onClick={() => workspace && onOpenProjectConversation(workspace, project.id)}
          >
            {hasConversation ? 'Open conversation' : 'Start conversation'}
          </button>
        </div>
      </details>
    );
  };

  return (
    <section className="mobile-buddy-section" aria-label="Work">
      <label className="mobile-buddy-section__label">
        Project
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

      <h2 className="mobile-buddy-section__heading">Current tasks · {groups.current.length}</h2>
      <div className="mobile-buddy-work-list">
        {groups.current.map(renderProject)}
        {groups.current.length === 0 && <EmptyState message="No open tasks for this workspace." />}
      </div>
      {groups.completed.length > 0 && (
        <details className="mobile-buddy-history">
          <summary>Completed & cancelled · {groups.completed.length}</summary>
          <div className="mobile-buddy-work-list">{groups.completed.map(renderProject)}</div>
        </details>
      )}

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
