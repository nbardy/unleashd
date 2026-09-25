import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuddyContext } from '@unleashd/shared';
import { useBuddyDetail, useBuddyOverview } from '../hooks/useBuddyData';
import { findWorkspace } from './buddies/roster';
import { taskStatusView } from './buddies/ui-contract';
import './BuddyConvoHeader.css';

export function BuddyConvoHeader({ context }: { context: BuddyContext }) {
  // Same `/api/buddies/:id` entry the Buddy page reads, so "Open employee →"
  // lands on a page that is already in cache.
  const { data } = useBuddyDetail(context.buddyId);
  const overview = useBuddyOverview().data;
  const [expanded, setExpanded] = useState(false);

  const task = data?.tasks.find((candidate) => candidate.id === context.buddyProjectId);
  const workspace = overview ? findWorkspace(overview, context.workspaceId) : undefined;

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
          <strong>{data?.buddy.name ?? 'Buddy'}</strong>
          <span>·</span>
          <span>{workspace?.name ?? 'Workspace'}</span>
        </span>
        {task && (
          <span className="buddy-convo-header__project">
            {task.title} · {taskStatusView(task.status).label}
          </span>
        )}
        <span className="buddy-convo-header__chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div className="buddy-convo-header__details">
          <span>{data?.buddy.role ?? 'Persistent employee conversation'}</span>
          <Link to={`/buddies/${context.buddyId}`}>Open employee →</Link>
        </div>
      )}
    </aside>
  );
}
