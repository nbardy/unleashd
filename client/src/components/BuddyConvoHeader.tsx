import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuddyContext } from '../atoms/pending-creations';
import { useBuddyDetailData } from '../hooks/useBuddyData';
import './BuddyConvoHeader.css';

export function BuddyConvoHeader({ context }: { context: BuddyContext }) {
  // Same `buddy-detail:` entry the Buddy page reads, so "Open employee →"
  // lands on a page that is already in cache. The local response type this
  // header used to declare was a third shape for the same payload.
  const { data } = useBuddyDetailData(context.buddyId);
  const record = data?.employee;
  const [expanded, setExpanded] = useState(false);

  const project = record?.projects.find((candidate) => candidate.id === context.buddyProjectId);
  const workspace = record?.workspaces.find((candidate) => candidate.id === context.workspaceId);
  const todos = project?.todos ?? [];
  const doneTodos = todos.filter((todo) => todo.status === 'done').length;

  return (
    <aside className="buddy-convo-header" aria-label="Buddy conversation context">
      <button
        type="button"
        className="buddy-convo-header__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="buddy-convo-header__mark">BUDDY</span>
        <span className="buddy-convo-header__identity">
          <strong>{record?.buddy.name ?? 'Buddy'}</strong>
          <span>·</span>
          <span>{workspace?.name ?? 'Workspace'}</span>
        </span>
        {project && (
          <span className="buddy-convo-header__project">
            {project.title}
            {project.status ? ` · ${project.status.replaceAll('_', ' ')}` : ''}
            {todos.length > 0 ? ` · ${doneTodos}/${todos.length} todos` : ''}
          </span>
        )}
        <span className="buddy-convo-header__chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div className="buddy-convo-header__details">
          <span>{record?.buddy.role ?? 'Persistent employee conversation'}</span>
          <Link to={`/buddies/${context.buddyId}`}>Open employee →</Link>
        </div>
      )}
    </aside>
  );
}
