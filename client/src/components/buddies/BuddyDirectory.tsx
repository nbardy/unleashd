import type { BuddyOverview } from './types';
import { buddyCardMetrics, selectDirectoryEmployees } from './ui-contract';

const CARD_VISUALS = ['horizon', 'archive', 'orbit', 'ember', 'tide'] as const;

export function BuddyDirectory({
  overview,
  onOpen,
  onNew,
  creating,
}: {
  overview: BuddyOverview;
  onOpen: (id: string) => void;
  onNew: () => void;
  creating: boolean;
}) {
  const visibleBuddies = selectDirectoryEmployees(overview);

  return (
    <main className="buddies-directory-content">
      <header className="buddies-directory-header">
        <div>
          <span className="buddies-directory-eyebrow">Workspace directory</span>
          <h1>Buddies</h1>
          <p>Meet the specialist teammates shaping work across your projects.</p>
        </div>
        <span className="buddies-directory-count">
          {visibleBuddies.length} {visibleBuddies.length === 1 ? 'Buddy' : 'Buddies'}
        </span>
      </header>
      <div className="buddy-card-grid">
        <button
          type="button"
          className="buddy-directory-card buddy-directory-card--new"
          onClick={onNew}
          disabled={creating}
        >
          <span className="buddy-card-visual buddy-card-visual--new" aria-hidden="true">
            <span className="buddy-card-visual__plus">+</span>
          </span>
          <span className="buddy-card-title">{creating ? 'Opening Builder…' : 'Create a new Buddy'}</span>
          <span className="buddy-card-hover-copy">
            <span>Describe a role in chat and the Builder will shape the brief with you.</span>
            <span className="buddy-card-hover-action">{creating ? 'Opening…' : 'Start here →'}</span>
          </span>
        </button>
        {visibleBuddies.map((employeeOverview, index) => {
          const { buddy, workspaces, team } = employeeOverview;
          const metrics = buddyCardMetrics(employeeOverview);
          const visual = CARD_VISUALS[index % CARD_VISUALS.length];
          return (
            <button
              type="button"
              key={buddy.id}
              className={`buddy-directory-card buddy-directory-card--${visual}`}
              onClick={() => onOpen(buddy.id)}
            >
              <span className="buddy-card-visual" aria-hidden="true">
                <span className="buddy-card-visual__orb" />
                <span className="buddy-card-visual__line" />
              </span>
              <span className="buddy-card-title">{buddy.name}</span>
              <span className="buddy-card-hover-copy">
                <span>{buddy.role}</span>
                <span className="buddy-card-hover-meta">
                  <span className={`buddy-presence buddy-presence--${buddy.status}`}>
                    {buddy.status}
                  </span>
                  {workspaces.slice(0, 2).map((workspace) => (
                    <span key={workspace.id} className="buddy-card-workspace">
                      {workspace.name}
                    </span>
                  ))}
                  {team.length > 0 && <span>{metrics.team} reports</span>}
                  <span>{metrics.open} open</span>
                  <span>{metrics.blocked} blocked</span>
                </span>
                <span className="buddy-card-hover-action">Open Buddy →</span>
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
