/**
 * The ONE regroup of swarm worker rows (pure, no React). Before T20 each of the
 * six swarm views (three desktop, three mobile) re-derived these from
 * `swarmWorkersByProjectAtom` in its own useMemo, and the copies had drifted:
 * the mobile dashboard ignored runtime snapshots, the mobile detail ignored the
 * selected run. Every view now calls these.
 * Guard: client/test/swarm-groups.test.ts
 */
import type { ConversationRow, OompaRuntimeSnapshot } from '@unleashd/shared';
import { isRowRunning, rowWorker } from '../utils/conversation-row';

export type WorkersByProject = ReadonlyMap<string, readonly ConversationRow[]>;
export type RunningOf = (worker: ConversationRow) => boolean;

/** One `/api/swarm-projects` entry: a project with an oompa runs/ directory. */
export interface SwarmProjectEntry {
  projectRoot: string;
  projectName: string;
  runtime: OompaRuntimeSnapshot;
}

export function getProjectName(root: string): string {
  return root.split('/').filter(Boolean).pop() ?? root;
}

export interface WorkerVisibilitySummary {
  totalWorkers: number;
  runningWorkers: number;
}

/** Worker counts: the runtime snapshot when oompa reports one, else distinct worker ids in the rows. */
export function getWorkerVisibilitySummary(
  workers: readonly ConversationRow[],
  runtime: OompaRuntimeSnapshot | null | undefined,
  isRunning: RunningOf
): WorkerVisibilitySummary {
  if (runtime?.available && runtime.run) {
    const total = runtime.run.totalWorkers;
    return { totalWorkers: total, runningWorkers: Math.min(runtime.run.activeWorkers, total) };
  }
  const idOf = (w: ConversationRow) => rowWorker(w)?.workerId || w.id;
  return {
    totalWorkers: new Set(workers.map(idOf)).size,
    runningWorkers: new Set(workers.filter(isRunning).map(idOf)).size,
  };
}

// =============================================================================
// Dashboard: one card per project
// =============================================================================

export interface SwarmProjectCard {
  projectRoot: string;
  projectName: string;
  sessionCount: number;
  workerCount: number;
  runningCount: number;
  idleCount: number;
  runCount: number;
  /** Epoch ms of the newest worker message; null = no worker rows (runs-only project). */
  latestActivity: number | null;
}

/**
 * Worker rows first (enriched by the project's runtime snapshot), then projects
 * found only on disk via /api/swarm-projects (non-Claude harnesses leave no
 * rows). Running projects first, then newest activity.
 */
export function buildProjectCards(
  workersByProject: WorkersByProject,
  runtimeSnapshots: Readonly<Record<string, OompaRuntimeSnapshot>>,
  discovered: readonly SwarmProjectEntry[]
): SwarmProjectCard[] {
  const cards = new Map<string, SwarmProjectCard>();
  for (const [projectRoot, sessions] of workersByProject) {
    const runtime = runtimeSnapshots[projectRoot];
    const visibility = getWorkerVisibilitySummary(sessions, runtime, isRowRunning);
    const swarmIds = new Set(sessions.map((s) => rowWorker(s)?.swarmId).filter(Boolean));
    cards.set(projectRoot, {
      projectRoot,
      projectName: getProjectName(projectRoot),
      sessionCount: sessions.length,
      workerCount: visibility.totalWorkers,
      runningCount: visibility.runningWorkers,
      idleCount: Math.max(visibility.totalWorkers - visibility.runningWorkers, 0),
      runCount: (runtime?.available ? runtime.run?.runCount : undefined) ?? swarmIds.size,
      latestActivity: sessions.length > 0 ? Math.max(...sessions.map((s) => s.activityAt)) : null,
    });
  }
  for (const entry of discovered) {
    if (cards.has(entry.projectRoot)) continue;
    const run = entry.runtime.available ? entry.runtime.run : null;
    const total = run?.totalWorkers ?? 0;
    const active = run?.activeWorkers ?? 0;
    cards.set(entry.projectRoot, {
      projectRoot: entry.projectRoot,
      projectName: entry.projectName,
      sessionCount: 0,
      workerCount: total,
      runningCount: active,
      idleCount: Math.max(total - active, 0),
      runCount: run?.runCount ?? 1,
      latestActivity: null,
    });
  }
  return [...cards.values()].sort(
    (a, b) =>
      Number(b.runningCount > 0) - Number(a.runningCount > 0) ||
      (b.latestActivity ?? 0) - (a.latestActivity ?? 0)
  );
}

// =============================================================================
// Detail: exec workers with their reviews/fixes
// =============================================================================

/** Live running state: the runtime snapshot's worker status wins over the row. */
export function runningFromSnapshot(snapshot: OompaRuntimeSnapshot | null): RunningOf {
  const states = new Map(
    (snapshot?.available ? (snapshot.run?.workers ?? []) : []).map((w) => [w.id, w])
  );
  return (worker) => {
    const state = states.get(rowWorker(worker)?.workerId ?? worker.id);
    return state ? state.status === 'running' || state.status === 'starting' : isRowRunning(worker);
  };
}

export interface ExecGroup {
  exec: ConversationRow;
  /** Review + fix sessions paired to this exec, running first then newest. */
  reviews: ConversationRow[];
}

export interface ExecGrouping {
  groups: ExecGroup[];
  all: ConversationRow[];
  workCount: number;
  reviewCount: number;
  fixCount: number;
}

/**
 * Split a project's workers into exec groups. `runId` (when set) keeps only that
 * swarm run's rows. Each review/fix pairs with the exec of the same swarmId whose
 * last activity is closest to the review's creation; a review with no such exec
 * is dropped (it only happens when the exec was promoted to a chat).
 */
export function groupExecWorkers(
  workers: readonly ConversationRow[],
  isRunning: RunningOf,
  runId: string | null
): ExecGrouping {
  const inRun = runId ? workers.filter((w) => rowWorker(w)?.swarmId === runId) : workers;
  const isReviewOrFix = (w: ConversationRow) =>
    rowWorker(w)?.role === 'review' || rowWorker(w)?.role === 'fix';
  const byActivity = (a: ConversationRow, b: ConversationRow) =>
    Number(isRunning(b)) - Number(isRunning(a)) || b.activityAt - a.activityAt;
  const execs = inRun.filter((w) => !isReviewOrFix(w)).sort(byActivity);
  const reviewsAndFixes = inRun.filter(isReviewOrFix);

  const groups: ExecGroup[] = execs.map((exec) => ({ exec, reviews: [] }));
  for (const rf of reviewsAndFixes) {
    const swarmId = rowWorker(rf)?.swarmId ?? null;
    let best: ExecGroup | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const g of groups) {
      if ((rowWorker(g.exec)?.swarmId ?? null) !== swarmId) continue;
      const delta = Math.abs(rf.createdAt - g.exec.activityAt);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = g;
      }
    }
    best?.reviews.push(rf);
  }
  for (const g of groups) g.reviews.sort(byActivity);

  return {
    groups,
    all: [...execs, ...reviewsAndFixes],
    workCount: execs.length,
    reviewCount: reviewsAndFixes.filter((r) => rowWorker(r)?.role === 'review').length,
    fixCount: reviewsAndFixes.filter((r) => rowWorker(r)?.role === 'fix').length,
  };
}

// =============================================================================
// Analytics: the project picker
// =============================================================================

export interface AnalyticsProject {
  projectRoot: string;
  projectName: string;
  sessionCount: number;
}

/** Projects with worker rows, most sessions first. */
export function listAnalyticsProjects(workersByProject: WorkersByProject): AnalyticsProject[] {
  return [...workersByProject]
    .map(([projectRoot, workers]) => ({
      projectRoot,
      projectName: getProjectName(projectRoot),
      sessionCount: workers.length,
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount);
}
