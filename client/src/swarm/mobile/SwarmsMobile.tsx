import type { OompaRuntimeSnapshot } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { swarmWorkersByProjectAtom } from '../../atoms/conversations';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { useTimeTick } from '../../hooks/useTimeTick';
import { isRowRunning } from '../../utils/conversation-row';
import { shortenHomePath } from '../../utils/directories';
import { getProjectName } from '../swarmUtils';
import { getWorkerVisibilitySummary } from '../swarmWorkerVisibility';
import { formatTimeAgo } from '../../utils/time';
import {
  MobileBadge,
  MobileCardButton,
  MobileEmptyPanel,
  MobileHeaderAction,
  MobilePage,
  MobilePath,
} from '../../mobile/components/MobileUI';
import { NewConversationSheet } from '../../mobile/components/NewConversationSheet';
import './mobile-swarm.css';

interface SwarmProjectEntry {
  projectRoot: string;
  projectName: string;
  runtime: OompaRuntimeSnapshot;
}

interface ProjectCard {
  projectRoot: string;
  projectName: string;
  workerCount: number;
  runningCount: number;
  idleCount: number;
  latestActivity: Date | undefined;
}

export function SwarmsMobile() {
  const workerConversationsByProject = useAtomValue(swarmWorkersByProjectAtom);
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  // Discovery via /api/swarm-projects (poll 15s, visibility-aware, reconnect-refetch)
  const { data: discovered } = usePolledFetch<{ projects: SwarmProjectEntry[] }>(
    '/api/swarm-projects',
    15_000,
    true
  );
  const runsDiscoveredProjects = discovered?.projects ?? [];

  useTimeTick();

  // Build cards merging conversation-based + runs-discovered projects
  const projectCards = useMemo((): ProjectCard[] => {
    const map = new Map<string, ProjectCard>();

    for (const [projectRoot, sessions] of workerConversationsByProject.entries()) {
      const visibility = getWorkerVisibilitySummary(sessions, null, (w) => isRowRunning(w));
      let latestActivity: Date | undefined;
      for (const w of sessions) {
        const lastTime = new Date(w.activityAt);
        if (lastTime && (!latestActivity || lastTime > latestActivity)) latestActivity = lastTime;
      }
      map.set(projectRoot, {
        projectRoot,
        projectName: getProjectName(projectRoot),
        workerCount: visibility.totalWorkers,
        runningCount: visibility.runningWorkers,
        idleCount: Math.max(visibility.totalWorkers - visibility.runningWorkers, 0),
        latestActivity,
      });
    }

    for (const d of runsDiscoveredProjects) {
      if (map.has(d.projectRoot)) continue;
      const runtimeRun = d.runtime?.available ? d.runtime.run : null;
      map.set(d.projectRoot, {
        projectRoot: d.projectRoot,
        projectName: d.projectName,
        workerCount: runtimeRun?.totalWorkers ?? 0,
        runningCount: runtimeRun?.activeWorkers ?? 0,
        idleCount: Math.max((runtimeRun?.totalWorkers ?? 0) - (runtimeRun?.activeWorkers ?? 0), 0),
        latestActivity: undefined,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.runningCount > 0 && b.runningCount === 0) return -1;
      if (b.runningCount > 0 && a.runningCount === 0) return 1;
      const aTime = a.latestActivity?.getTime() ?? 0;
      const bTime = b.latestActivity?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [workerConversationsByProject, runsDiscoveredProjects]);

  // One header action for both the empty and populated states — an empty Swarms
  // page is exactly where a user most wants to start one.
  const headerAside = (
    <MobileHeaderAction onClick={() => setShowCreate(true)} aria-label="New swarm">
      + New
    </MobileHeaderAction>
  );
  const sheet = showCreate ? (
    <NewConversationSheet kind="swarm" onClose={() => setShowCreate(false)} />
  ) : null;

  if (projectCards.length === 0) {
    return (
      <>
        <MobilePage
          title="Swarms"
          subtitle="Worker groups by project"
          className="mobile-swarms"
          headerAside={headerAside}
        >
          <MobileEmptyPanel>
            No swarms running. Tap <strong>+ New</strong> to start one, or workers appear here when
            an oompa swarm starts.
          </MobileEmptyPanel>
        </MobilePage>
        {sheet}
      </>
    );
  }

  return (
    <>
      <MobilePage
        title="Swarms"
        subtitle={`${projectCards.length} project${projectCards.length !== 1 ? 's' : ''}`}
        className="mobile-swarms"
        headerAside={headerAside}
      >
        <div className="mobile-ui-stack mobile-swarms__list">
          {projectCards.map((p) => (
            <MobileCardButton
              key={p.projectRoot}
              className={`mobile-swarm-card ui-stack ${p.runningCount > 0 ? 'mobile-swarm-card--running' : ''}`}
              onClick={() =>
                navigate(`/workers/detail?project=${encodeURIComponent(p.projectRoot)}`)
              }
            >
              <div className="mobile-swarm-card__top">
                <span className="mobile-swarm-card__name">{p.projectName}</span>
                <MobileBadge tone={p.runningCount > 0 ? 'active' : 'neutral'}>
                  {p.runningCount > 0 ? `${p.runningCount} running` : 'idle'}
                </MobileBadge>
              </div>
              <MobilePath title={p.projectRoot}>{shortenHomePath(p.projectRoot)}</MobilePath>
              <div className="mobile-swarm-card__stats ui-muted">
                <span>
                  {p.workerCount} worker{p.workerCount !== 1 ? 's' : ''}
                </span>
                {p.runningCount > 0 && (
                  <span className="stat-running"> · {p.runningCount} running</span>
                )}
                {p.idleCount > 0 && <span className="ui-muted"> · {p.idleCount} idle</span>}
                {p.latestActivity && (
                  <span className="ui-muted"> · {formatTimeAgo(p.latestActivity)}</span>
                )}
              </div>
            </MobileCardButton>
          ))}
        </div>
      </MobilePage>
      {sheet}
    </>
  );
}
