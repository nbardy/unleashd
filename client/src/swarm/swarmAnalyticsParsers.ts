/**
 * client/src/utils/swarmAnalyticsParsers.ts
 *
 * Pure timeline + stats parsers extracted from SwarmAnalytics.tsx:128-222
 * (timeline) and 421-447 (stats). No React, no CSS side-effect imports.
 *
 * Desktop SwarmAnalytics and mobile SwarmAnalyticsMobile import from here.
 */

import type { SwarmReviewLog, SwarmRunLog, SwarmRunSummary } from '@unleashd/shared';

// ---------------------------------------------------------------------------
// Types (mirrors SwarmAnalytics.tsx:24-50)
// ---------------------------------------------------------------------------

export interface RunData {
  swarmId: string;
  run: SwarmRunLog | null;
  summary: SwarmRunSummary | null;
  reviews: SwarmReviewLog[];
}

export interface IterationSpan {
  id: string;
  workerId: string;
  iteration: number;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'completed' | 'error' | 'pending';
  verdict: 'approved' | 'rejected' | 'needs-changes' | null;
  merges: number;
  reviewRounds: number;
  diffFiles: number;
  output?: string;
}

export interface WorkerTimeline {
  workerId: string;
  model: string;
  harness: string;
  spans: IterationSpan[];
}

export interface TimeRange {
  start: number;
  end: number;
  duration: number;
}

export interface TimelineData {
  timelines: WorkerTimeline[];
  timeRange: TimeRange;
  isEstimated: boolean;
}

export interface SwarmStats {
  totalWorkers: number;
  completedIterations: number;
  totalIterations: number;
  totalMerges: number;
  totalRejections: number;
  totalErrors: number;
  totalReviewRounds: number;
  completedWorkers: number;
  runningWorkers: number;
  errorWorkers: number;
  finishedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTimestamp(ts: string): number {
  return new Date(ts).getTime();
}

// ---------------------------------------------------------------------------
// Timeline builder (SwarmAnalytics.tsx:128-222)
// ---------------------------------------------------------------------------

/**
 * Build worker iteration timelines from run + summary + reviews.
 *
 * Timing is estimated: per-iteration timestamps are not available from the
 * run data, so iterations are distributed evenly across the run duration.
 * The returned `isEstimated` flag must be surfaced in the UI disclaimer.
 */
export function buildTimelineData(runData: RunData): TimelineData {
  if (!runData.summary) {
    return { timelines: [], timeRange: { start: 0, end: 0, duration: 0 }, isEstimated: false };
  }

  const summary = runData.summary;
  const reviews = runData.reviews || [];
  const run = runData.run;

  const startTime = run?.['started-at'] ? parseTimestamp(run['started-at']) : Date.now();
  const endTime = summary['finished-at'] ? parseTimestamp(summary['finished-at']) : Date.now();
  const duration = Math.max(endTime - startTime, 60000);

  const workerMap = new Map<string, WorkerTimeline>();
  for (const worker of summary.workers) {
    workerMap.set(worker.id, {
      workerId: worker.id,
      model: worker.model || 'unknown',
      harness: worker.harness || 'default',
      spans: [],
    });
  }

  const reviewsByWorkerIter = new Map<string, Map<number, SwarmReviewLog[]>>();
  for (const review of reviews) {
    if (!reviewsByWorkerIter.has(review['worker-id'])) {
      reviewsByWorkerIter.set(review['worker-id'], new Map());
    }
    const workerReviews = reviewsByWorkerIter.get(review['worker-id'])!;
    if (!workerReviews.has(review.iteration)) {
      workerReviews.set(review.iteration, []);
    }
    workerReviews.get(review.iteration)!.push(review);
  }

  let isEstimated = false;

  for (const worker of summary.workers) {
    const timeline = workerMap.get(worker.id);
    if (!timeline) continue;

    const workerReviews = reviewsByWorkerIter.get(worker.id);
    const iterations = Math.max(worker.iterations, worker.completed);

    for (let i = 1; i <= iterations; i++) {
      const iterationReviews = workerReviews?.get(i) || [];
      const latestReview = iterationReviews[iterationReviews.length - 1];

      isEstimated = true;
      const iterDuration = duration / iterations;
      const iterStart = startTime + (i - 1) * iterDuration;
      const iterEnd = i <= worker.completed ? iterStart + iterDuration * 0.9 : null;

      const span: IterationSpan = {
        id: `${worker.id}-i${i}`,
        workerId: worker.id,
        iteration: i,
        startTime: iterStart,
        endTime: iterEnd,
        status:
          i <= worker.completed
            ? 'completed'
            : i === worker.completed + 1 && !summary['finished-at']
              ? 'running'
              : 'pending',
        verdict: (latestReview?.verdict as IterationSpan['verdict']) || null,
        merges: i <= worker.completed ? worker.merges / worker.completed : 0,
        reviewRounds: iterationReviews.length,
        diffFiles: latestReview?.['diff-files']?.length || 0,
        output: latestReview?.output,
      };

      timeline.spans.push(span);
    }
  }

  return {
    timelines: Array.from(workerMap.values()),
    timeRange: {
      start: startTime,
      end: endTime || Date.now(),
      duration: endTime - startTime || 60000,
    },
    isEstimated,
  };
}

// ---------------------------------------------------------------------------
// Stats aggregation (SwarmAnalytics.tsx:421-447)
// ---------------------------------------------------------------------------

export function computeSwarmStats(runData: RunData): SwarmStats | null {
  if (!runData.summary) return null;

  const summary = runData.summary;
  const totalMerges = summary.workers.reduce((s, w) => s + w.merges, 0);
  const totalRejections = summary.workers.reduce((s, w) => s + w.rejections, 0);
  const totalErrors = summary.workers.reduce((s, w) => s + w.errors, 0);
  const totalReviewRounds = summary.workers.reduce((s, w) => s + w['review-rounds-total'], 0);

  const completedWorkers = summary.workers.filter((w) => w.status === 'completed').length;
  const runningWorkers = summary.workers.filter((w) => w.status === 'running').length;
  const errorWorkers = summary.workers.filter((w) => w.status === 'error').length;

  return {
    totalWorkers: summary['total-workers'],
    completedIterations: summary['total-completed'],
    totalIterations: summary['total-iterations'],
    totalMerges,
    totalRejections,
    totalErrors,
    totalReviewRounds,
    completedWorkers,
    runningWorkers,
    errorWorkers,
    finishedAt: summary['finished-at'],
  };
}
