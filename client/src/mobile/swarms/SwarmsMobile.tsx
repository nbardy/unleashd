import type { OompaRuntimeSnapshot } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workersByProjectAtom } from '../../atoms/conversations';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { promotedWorkersAtom } from '../../atoms/ui';
import { getProjectName, getProjectRoot } from '../../utils/swarmUtils';
import { getWorkerVisibilitySummary } from '../../utils/swarmWorkerVisibility';
import { formatTimeAgo, getLastMessageTime } from '../../utils/time';
import {
  MobileBadge,
  MobileCardButton,
  MobileEmptyPanel,
  MobilePage,
  MobilePath,
} from '../components/MobileUI';

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
  const rawWorkersByProject = useAtomValue(workersByProjectAtom);
  const navigate = useNavigate();
  const promotedWorkers = useAtomValue(promotedWorkersAtom);
  const promotedSet = useMemo(() => new Set(promotedWorkers), [promotedWorkers]);

  // Discovery via /api/swarm-projects (poll 15s, visibility-aware, reconnect-refetch)
  const { data: discovered } = usePolledFetch<{ projects: SwarmProjectEntry[] }>(
    '/api/swarm-projects',
    15_000,
    true
  );
  const runsDiscoveredProjects = discovered?.projects ?? [];

  // Tick every 30s to keep time-ago current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Re-group workersByProject by project root (strip worktree suffix) and exclude promoted
  const workerConversationsByProject = useMemo(() => {
    const groups = new Map<string, import('@unleashd/shared').Conversation[]>();
    for (const workers of rawWorkersByProject.values()) {
      for (const conv of workers) {
        if (promotedSet.has(conv.id)) continue;
        const root = getProjectRoot(conv.workingDirectory);
        const arr = groups.get(root);
        if (!arr) groups.set(root, [conv]);
        else arr.push(conv);
      }
    }
    return groups;
  }, [rawWorkersByProject, promotedSet]);

  // Build cards merging conversation-based + runs-discovered projects
  const projectCards = useMemo((): ProjectCard[] => {
    const map = new Map<string, ProjectCard>();

    for (const [projectRoot, sessions] of workerConversationsByProject.entries()) {
      const visibility = getWorkerVisibilitySummary(sessions, null, (w) => w.isRunning);
      let latestActivity: Date | undefined;
      for (const w of sessions) {
        const lastTime = getLastMessageTime(w.messages);
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

  if (projectCards.length === 0) {
    return (
      <MobilePage title="Swarms" subtitle="Worker groups by project" className="mobile-swarms">
        <MobileEmptyPanel>
          No swarms running. Workers appear when an oompa swarm starts.
        </MobileEmptyPanel>
      </MobilePage>
    );
  }

  return (
    <MobilePage
      title="Swarms"
      subtitle={`${projectCards.length} project${projectCards.length !== 1 ? 's' : ''}`}
      className="mobile-swarms"
    >
      <div className="mobile-ui-stack mobile-swarms__list">
        {projectCards.map((p) => (
          <MobileCardButton
            key={p.projectRoot}
            className={`mobile-swarm-card ${p.runningCount > 0 ? 'mobile-swarm-card--running' : ''}`}
            onClick={() => navigate(`/workers/detail?project=${encodeURIComponent(p.projectRoot)}`)}
          >
            <div className="mobile-swarm-card__top">
              <span className="mobile-swarm-card__name">{p.projectName}</span>
              <MobileBadge tone={p.runningCount > 0 ? 'active' : 'neutral'}>
                {p.runningCount > 0 ? `${p.runningCount} running` : 'idle'}
              </MobileBadge>
            </div>
            <MobilePath title={p.projectRoot}>
              {p.projectRoot.replace(/^\/Users\/[^/]+/, '~')}
            </MobilePath>
            <div className="mobile-swarm-card__stats">
              <span>
                {p.workerCount} worker{p.workerCount !== 1 ? 's' : ''}
              </span>
              {p.runningCount > 0 && (
                <span className="stat-running"> · {p.runningCount} running</span>
              )}
              {p.idleCount > 0 && <span className="stat-idle"> · {p.idleCount} idle</span>}
              {p.latestActivity && (
                <span className="stat-time"> · {formatTimeAgo(p.latestActivity)}</span>
              )}
            </div>
          </MobileCardButton>
        ))}
      </div>
    </MobilePage>
  );
}
