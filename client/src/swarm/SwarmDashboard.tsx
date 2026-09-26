import { useAtomValue } from 'jotai';
import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTimeTick } from '../hooks/useTimeTick';
import { NewConversationSheet } from '../mobile/components/NewConversationSheet';
import { shortenHomePath } from '../utils/directories';
import { getProjectColor } from '../utils/projectColors';
import { formatTimeAgo } from '../utils/time';
import { type SwarmBack, type SwarmLayout, SwarmPage } from './SwarmPage';
import { type SwarmProjectCard, buildProjectCards } from './swarm-groups';
import { swarmWorkersByProjectAtom } from './swarm-workers';
import { useSwarmProjects } from './useSwarmProjects';
import { useSwarmRuntimeSnapshots } from './useSwarmRuntimeSnapshots';
import './SwarmDashboard.css';

/** Desktop reaches the dashboard from the gallery; on mobile it is a tab root. */
const BACK: Record<SwarmLayout, SwarmBack | null> = {
  wide: { to: '/chats', label: 'Gallery' },
  narrow: null,
};

/** "+ New" opens the mobile creation sheet; desktop starts swarms from its sidebar. */
const NEW_SWARM: Record<SwarmLayout, () => ReactNode> = {
  wide: () => null,
  narrow: NewSwarmAction,
};

function NewSwarmAction() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="swarm-btn ui-control" onClick={() => setOpen(true)}>
        + New
      </button>
      {open && <NewConversationSheet kind="swarm" onClose={() => setOpen(false)} />}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function SwarmDashboard({ layout }: { layout: SwarmLayout }) {
  const workersByProject = useAtomValue(swarmWorkersByProjectAtom);
  const roots = useMemo(() => [...workersByProject.keys()].sort(), [workersByProject]);
  const runtimeSnapshots = useSwarmRuntimeSnapshots(roots);
  const discovered = useSwarmProjects();
  useTimeTick();

  const cards = useMemo(
    () => buildProjectCards(workersByProject, runtimeSnapshots, discovered),
    [workersByProject, runtimeSnapshots, discovered]
  );
  const NewSwarm = NEW_SWARM[layout];

  return (
    <SwarmPage
      layout={layout}
      className="swarm-dashboard"
      back={BACK[layout]}
      title="Swarms"
      subtitle={plural(cards.length, 'project')}
      actions={<NewSwarm />}
    >
      {cards.length === 0 ? (
        <div className="swarm-empty ui-muted">
          No swarms yet. Workers appear here when an oompa swarm starts (detected by the [oompa]
          prefix in their first message).
        </div>
      ) : (
        <div className="swarm-dashboard-list ui-stack">
          {cards.map((card) => (
            <ProjectCard key={card.projectRoot} card={card} />
          ))}
        </div>
      )}
    </SwarmPage>
  );
}

function ProjectCard({ card }: { card: SwarmProjectCard }) {
  const running = card.runningCount > 0;
  return (
    <Link
      className="swarm-dashboard-card ui-stack ui-card"
      data-running={running}
      style={{ borderLeftColor: getProjectColor(card.projectRoot) }}
      to={`/workers/detail?project=${encodeURIComponent(card.projectRoot)}`}
    >
      <div className="swarm-dashboard-card-top ui-row">
        <span className="swarm-dashboard-card-name ui-truncate">{card.projectName}</span>
        <span className="swarm-badge ui-inline-row" data-running={running}>
          {running ? `${card.runningCount} running` : 'idle'}
        </span>
      </div>
      <span className="swarm-dashboard-card-path ui-truncate ui-muted" title={card.projectRoot}>
        {shortenHomePath(card.projectRoot)}
      </span>
      <div className="swarm-dashboard-card-stats ui-row ui-muted">
        <span>{plural(card.workerCount, 'worker')}</span>
        <span>{plural(card.sessionCount, 'session')}</span>
        {card.idleCount > 0 && <span>{card.idleCount} idle</span>}
        {card.runCount > 1 && <span>{plural(card.runCount, 'swarm run')}</span>}
        {card.latestActivity !== null && (
          <span>{formatTimeAgo(new Date(card.latestActivity))}</span>
        )}
        <span className="swarm-dashboard-card-open">Open →</span>
      </div>
    </Link>
  );
}
