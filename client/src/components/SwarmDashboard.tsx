import type { Conversation } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workersByProjectAtom } from '../atoms/conversations';
import { useSwarmProjects } from '../hooks/useSwarmProjects';
import { promotedWorkersAtom } from '../atoms/ui';
import { useSwarmRuntimeSnapshots } from '../hooks/useSwarmRuntimeSnapshots';
import { getProjectColor } from '../utils/projectColors';
import { getProjectName, getProjectRoot } from '../utils/swarmUtils';
import { getWorkerVisibilitySummary } from '../utils/swarmWorkerVisibility';
import { formatTimeAgo, getLastMessageTime } from '../utils/time';
import './SwarmDashboard.css';

interface SwarmProject {
  projectRoot: string;
  projectName: string;
  /** Historical JSONL session files (one per worker iteration) */
  sessions: Conversation[];
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
  // Subscribe to workersByProjectAtom — only re-renders when worker conversations
  // change, not on every structural event across all conversations.
  const rawWorkersByProject = useAtomValue(workersByProjectAtom);
  const navigate = useNavigate();
  const promotedWorkers = useAtomValue(promotedWorkersAtom);
  const promotedSet = useMemo(() => new Set(promotedWorkers), [promotedWorkers]);

  // Re-group by project root (workersByProject keys on raw workingDirectory;
  // we need getProjectRoot to strip worktree suffixes) and exclude promoted workers.
  const workerConversationsByProject = useMemo(() => {
    const groups = new Map<string, Conversation[]>();

    for (const workers of rawWorkersByProject.values()) {
      for (const conv of workers) {
        if (promotedSet.has(conv.id)) continue;
        const root = getProjectRoot(conv.workingDirectory);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(conv);
      }
    }

    return groups;
  }, [rawWorkersByProject, promotedSet]);
  const runtimeProjectRoots = useMemo(
    () => Array.from(workerConversationsByProject.keys()).sort(),
    [workerConversationsByProject]
  );
  const runtimeSnapshots = useSwarmRuntimeSnapshots(runtimeProjectRoots);

  // Primary discovery: projects with oompa runs/ directories on disk.
  // This surfaces swarms regardless of worker harness (gemini, codex, etc.).
  const runsDiscoveredProjects = useSwarmProjects();

  // Tick every 30s to keep time-ago displays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Merge conversation-based projects with runs-discovered projects.
  // Conversation data enriches runs-discovered projects; runs-discovered
  // projects ensure visibility even without worker conversation files.
  const swarmProjects = useMemo((): SwarmProject[] => {
    const projectMap = new Map<string, SwarmProject>();

    // First pass: projects with worker conversations (existing behavior)
    for (const [projectRoot, sessions] of workerConversationsByProject.entries()) {
      const runtime = runtimeSnapshots[projectRoot];
      const runtimeRun = runtime?.available ? runtime.run : null;
      const visibility = getWorkerVisibilitySummary(
        sessions,
        runtime,
        (worker) => worker.isRunning
      );

      const distinctSwarmIds = new Set(sessions.map((s) => s.swarmId).filter(Boolean));
      const runCount = runtimeRun?.runCount ?? distinctSwarmIds.size;

      let latestActivity: Date | undefined;
      for (const w of sessions) {
        const lastTime = getLastMessageTime(w.messages);
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
      <div className="swarm-dashboard">
        <div className="swarm-dashboard-header">
          <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/')}>
            &#8592; Gallery
          </button>
          <h2>Swarm Dashboard</h2>
        </div>
        <div className="swarm-dashboard-content">
          <div className="empty-state">
            No worker conversations. Workers are detected by the [oompa] prefix in the first
            message.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-dashboard">
      <div className="swarm-dashboard-header">
        <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/')}>
          &#8592; Gallery
        </button>
        <h2>Swarm Dashboard</h2>
      </div>
      <div className="swarm-dashboard-content">
        {swarmProjects.map((project) => (
          <div
            key={project.projectRoot}
            className={`swarm-project-card ${project.runningCount > 0 ? 'has-running' : ''}`}
            style={{ borderLeftColor: project.accentColor }}
            onClick={() =>
              navigate(`/workers/detail?project=${encodeURIComponent(project.projectRoot)}`)
            }
          >
            <div className="swarm-project-info">
              <div className="swarm-project-name">{project.projectName}</div>
              <div className="swarm-project-path">
                {project.projectRoot.replace(/^\/Users\/[^/]+/, '~')}
              </div>
              <div className="swarm-project-stats">
                <span className="swarm-stat">
                  <span className="swarm-stat-value">{project.sessions.length}</span>
                  session{project.sessions.length !== 1 ? 's' : ''}
                </span>
                <span className="swarm-stat-divider" />
                {project.runningCount > 0 && (
                  <span className="swarm-stat">
                    <span className="swarm-stat-value running">{project.runningCount}</span>
                    running
                  </span>
                )}
                {project.idleCount > 0 && (
                  <span className="swarm-stat">
                    <span className="swarm-stat-value idle">{project.idleCount}</span>
                    idle
                  </span>
                )}
                {project.runCount > 1 && (
                  <>
                    <span className="swarm-stat-divider" />
                    <span className="swarm-stat">
                      <span className="swarm-stat-value">{project.runCount}</span>
                      swarm run{project.runCount !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="swarm-project-right">
              {project.latestActivity && (
                <span className="swarm-time-ago">{formatTimeAgo(project.latestActivity)}</span>
              )}
              <button
                type="button"
                className="swarm-open-btn"
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
