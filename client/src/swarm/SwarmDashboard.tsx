import type { ConversationRow } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isRowRunning, rowWorker } from '../utils/conversation-row';
import { getProjectColor } from '../utils/projectColors';
import { formatTimeAgo } from '../utils/time';
import { getProjectName } from './swarmUtils';
import { getWorkerVisibilitySummary } from './swarmWorkerVisibility';
import { useSwarmProjects } from './useSwarmProjects';
import { useSwarmRuntimeSnapshots } from './useSwarmRuntimeSnapshots';
import './SwarmDashboard.css';
import { useTimeTick } from '../hooks/useTimeTick';
import { shortenHomePath } from '../utils/directories';
import { swarmWorkersByProjectAtom } from './swarm-workers';

interface SwarmProject {
  projectRoot: string;
  projectName: string;
  /** Historical JSONL session files (one per worker iteration) */
  sessions: readonly ConversationRow[];
  /** Configured worker slots (from runtime or distinct workerIds) */
  workerCount: number;
  runningCount: number;
  idleCount: number;
  /** Recorded swarm runs (from runtime runCount or distinct swarmIds) */
  runCount: number;
  latestActivity: Date | undefined;
  accentColor: string;
}

export function SwarmDashboard() {
  // Swarm workers by project root; re-renders only when a worker changes.
  const workerConversationsByProject = useAtomValue(swarmWorkersByProjectAtom);
  const navigate = useNavigate();
  const runtimeProjectRoots = useMemo(
    () => Array.from(workerConversationsByProject.keys()).sort(),
    [workerConversationsByProject]
  );
  const runtimeSnapshots = useSwarmRuntimeSnapshots(runtimeProjectRoots);

  // Primary discovery: projects with oompa runs/ directories on disk.
  // This surfaces swarms regardless of worker harness (gemini, codex, etc.).
  const runsDiscoveredProjects = useSwarmProjects();

  useTimeTick();

  // Merge conversation-based projects with runs-discovered projects.
  // Conversation data enriches runs-discovered projects; runs-discovered
  // projects ensure visibility even without worker conversation files.
  const swarmProjects = useMemo((): SwarmProject[] => {
    const projectMap = new Map<string, SwarmProject>();

    // First pass: projects with worker conversations (existing behavior)
    for (const [projectRoot, sessions] of workerConversationsByProject.entries()) {
      const runtime = runtimeSnapshots[projectRoot];
      const runtimeRun = runtime?.available ? runtime.run : null;
      const visibility = getWorkerVisibilitySummary(sessions, runtime, (worker) =>
        isRowRunning(worker)
      );

      const distinctSwarmIds = new Set(
        sessions.map((s) => rowWorker(s)?.swarmId ?? null).filter(Boolean)
      );
      const runCount = runtimeRun?.runCount ?? distinctSwarmIds.size;

      let latestActivity: Date | undefined;
      for (const w of sessions) {
        const lastTime = new Date(w.activityAt);
        if (lastTime && (!latestActivity || lastTime > latestActivity)) {
          latestActivity = lastTime;
        }
      }

      projectMap.set(projectRoot, {
        projectRoot,
        projectName: getProjectName(projectRoot),
        sessions,
        workerCount: visibility.totalWorkers,
        runningCount: visibility.runningWorkers,
        idleCount: Math.max(visibility.totalWorkers - visibility.runningWorkers, 0),
        runCount,
        latestActivity,
        accentColor: getProjectColor(projectRoot),
      });
    }

    // Second pass: add runs-discovered projects that have no worker conversations.
    // These are projects where workers use non-Claude harnesses (gemini, codex).
    for (const discovered of runsDiscoveredProjects) {
      if (projectMap.has(discovered.projectRoot)) continue; // already covered
      const runtimeRun = discovered.runtime?.available ? discovered.runtime.run : null;

      projectMap.set(discovered.projectRoot, {
        projectRoot: discovered.projectRoot,
        projectName: discovered.projectName,
        sessions: [],
        workerCount: runtimeRun?.totalWorkers ?? 0,
        runningCount: runtimeRun?.activeWorkers ?? 0,
        idleCount: Math.max((runtimeRun?.totalWorkers ?? 0) - (runtimeRun?.activeWorkers ?? 0), 0),
        runCount: runtimeRun?.runCount ?? 1,
        latestActivity: undefined,
        accentColor: getProjectColor(discovered.projectRoot),
      });
    }

    return Array.from(projectMap.values()).sort((a, b) => {
      // Running projects first, then by latest activity
      if (a.runningCount > 0 && b.runningCount === 0) return -1;
      if (b.runningCount > 0 && a.runningCount === 0) return 1;
      const aTime = a.latestActivity?.getTime() ?? 0;
      const bTime = b.latestActivity?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [runtimeSnapshots, workerConversationsByProject, runsDiscoveredProjects]);

  if (swarmProjects.length === 0) {
    return (
      <div className="swarm-dashboard ui-stack">
        <div className="swarm-dashboard-header ui-row">
          <button
            type="button"
            className="back-to-gallery-btn ui-control"
            onClick={() => navigate('/chats')}
          >
            &#8592; Gallery
          </button>
          <h2>Swarm Dashboard</h2>
        </div>
        <div className="swarm-dashboard-content ui-stack">
          <div className="empty-state ui-muted">
            No worker conversations. Workers are detected by the [oompa] prefix in the first
            message.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-dashboard ui-stack">
      <div className="swarm-dashboard-header ui-row">
        <button
          type="button"
          className="back-to-gallery-btn ui-control"
          onClick={() => navigate('/chats')}
        >
          &#8592; Gallery
        </button>
        <h2>Swarm Dashboard</h2>
      </div>
      <div className="swarm-dashboard-content ui-stack">
        {swarmProjects.map((project) => (
          <div
            key={project.projectRoot}
            className={`swarm-project-card ${project.runningCount > 0 ? 'has-running' : ''}`}
            style={{ borderLeftColor: project.accentColor }}
            onClick={() =>
              navigate(`/workers/detail?project=${encodeURIComponent(project.projectRoot)}`)
            }
          >
            <div className="swarm-project-info ui-stack">
              <div className="swarm-project-name">{project.projectName}</div>
              <div className="swarm-project-path ui-truncate ui-muted">
                {shortenHomePath(project.projectRoot)}
              </div>
              <div className="swarm-project-stats ui-row">
                <span className="swarm-stat ui-inline-row">
                  <span className="swarm-stat-value">{project.sessions.length}</span>
                  session{project.sessions.length !== 1 ? 's' : ''}
                </span>
                <span className="swarm-stat-divider" />
                {project.runningCount > 0 && (
                  <span className="swarm-stat ui-inline-row">
                    <span className="swarm-stat-value running">{project.runningCount}</span>
                    running
                  </span>
                )}
                {project.idleCount > 0 && (
                  <span className="swarm-stat ui-inline-row">
                    <span className="swarm-stat-value idle">{project.idleCount}</span>
                    idle
                  </span>
                )}
                {project.runCount > 1 && (
                  <>
                    <span className="swarm-stat-divider" />
                    <span className="swarm-stat ui-inline-row">
                      <span className="swarm-stat-value">{project.runCount}</span>
                      swarm run{project.runCount !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="swarm-project-right ui-stack">
              {project.latestActivity && (
                <span className="swarm-time-ago ui-muted">
                  {formatTimeAgo(project.latestActivity)}
                </span>
              )}
              <button
                type="button"
                className="swarm-open-btn ui-control"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/workers/detail?project=${encodeURIComponent(project.projectRoot)}`);
                }}
              >
                Open Swarm &#8594;
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
