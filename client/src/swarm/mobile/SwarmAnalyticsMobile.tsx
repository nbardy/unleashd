import type { ConversationRow } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { swarmWorkersByProjectAtom } from '../../atoms/conversations';
import { EmptyState } from '../../mobile/components/EmptyState';
import { rowWorker } from '../../utils/conversation-row';
import { getProjectColor } from '../../utils/projectColors';
import { formatDuration, formatTimeAgo } from '../../utils/time';
import {
  type IterationSpan,
  type RunData,
  buildTimelineData,
  computeSwarmStats,
} from '../swarmAnalyticsParsers';
import { getProjectName } from '../swarmUtils';
import './mobile-swarm.css';

/**
 * SwarmAnalyticsMobile — mobile analytics at /workers/analytics.
 *
 * - Stats aggregation + timeline span builder via utils/swarmAnalyticsParsers.ts
 *   (Agent 4 extraction). buildTimelineData returns { timelines, timeRange, isEstimated }
 *   and computeSwarmStats aggregates merges/rejections/errors/review-rounds.
 *   isEstimated is surfaced as a disclaimer (estimated per-iteration timing).
 * - Tap-to-inspect replaces hover: tapping a span opens a bottom sheet with
 *   verdict/merges/reviewRounds/diffFiles/output; hover tooltip is desktop-only.
 * - Imports parsers from utils/, never from components/*.tsx (CSS side-effect import).
 */

interface SwarmProject {
  projectRoot: string;
  projectName: string;
  workers: readonly ConversationRow[];
  swarmIds: Set<string>;
  accentColor: string;
}

function shortWorkerId(id: string): string {
  if (id.includes('-')) return id.split('-').slice(-2).join('-');
  return id.length > 12 ? id.slice(-12) : id;
}

export function SwarmAnalyticsMobile() {
  const navigate = useNavigate();
  const workersByProject = useAtomValue(swarmWorkersByProjectAtom);

  const projects = useMemo((): SwarmProject[] => {
    return Array.from(workersByProject.entries())
      .map(([projectRoot, workers]) => {
        const swarmIds = new Set<string>();
        for (const worker of workers) {
          const swarmId = rowWorker(worker)?.swarmId;
          if (swarmId) swarmIds.add(swarmId);
        }
        return {
          projectRoot,
          projectName: getProjectName(projectRoot),
          workers,
          swarmIds,
          accentColor: getProjectColor(projectRoot),
        };
      })
      .sort((a, b) => b.workers.length - a.workers.length);
  }, [workersByProject]);

  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSwarmId, setSelectedSwarmId] = useState<string | null>(null);
  const [runsData, setRunsData] = useState<Map<string, RunData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ span: IterationSpan; workerId: string } | null>(
    null
  );

  const hasAutoSelected = useRef(false);

  useEffect(() => {
    hasAutoSelected.current = false;
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].projectRoot);
    }
  }, [projects, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/swarm-runs?dir=${encodeURIComponent(selectedProject)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load swarm runs (HTTP ${res.status})`);
        return res.json();
      })
      .then(
        async (data: {
          runs: Array<{
            swarmId: string;
            run: RunData['run'];
            summary: RunData['summary'];
          }>;
        }) => {
          if (controller.signal.aborted) return;
          const map = new Map<string, RunData>();
          for (const run of data.runs) {
            if (controller.signal.aborted) break;
            try {
              const reviewsRes = await fetch(
                `/api/swarm-reviews?dir=${encodeURIComponent(selectedProject)}&swarmId=${encodeURIComponent(run.swarmId)}`,
                { signal: controller.signal }
              );
              const reviewsData = await reviewsRes.json();
              map.set(run.swarmId, {
                swarmId: run.swarmId,
                run: run.run,
                summary: run.summary,
                reviews: reviewsData.reviews || [],
              });
            } catch {
              if (controller.signal.aborted) break;
              map.set(run.swarmId, {
                swarmId: run.swarmId,
                run: run.run,
                summary: run.summary,
                reviews: [],
              });
            }
          }
          if (controller.signal.aborted) return;
          setRunsData(map);
          setLoading(false);
          if (!hasAutoSelected.current && data.runs.length > 0) {
            hasAutoSelected.current = true;
            setSelectedSwarmId(data.runs[0].swarmId);
          }
        }
      )
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });

    return () => controller.abort();
  }, [selectedProject]);

  const selectedRun = selectedSwarmId ? (runsData.get(selectedSwarmId) ?? null) : null;

  // Timeline derived via pure parser (utils is canonical)
  const timeline = useMemo(() => {
    if (!selectedRun) return null;
    return buildTimelineData(selectedRun);
  }, [selectedRun]);

  const stats = useMemo(() => {
    if (!selectedRun) return null;
    return computeSwarmStats(selectedRun);
  }, [selectedRun]);

  if (projects.length === 0 && !loading) {
    return (
      <div className="mobile-hub">
        <EmptyState
          icon="⬡"
          title="No swarms"
          message="No worker conversations found for analytics."
        />
      </div>
    );
  }

  return (
    <div className="mobile-hub mobile-analytics ui-stack">
      <header className="mobile-hub__header">
        <button
          type="button"
          className="mobile-link ui-inline-row"
          onClick={() => navigate('/workers')}
        >
          ← Swarms
        </button>
        <h1 className="mobile-hub__title">Swarm Analytics</h1>
      </header>

      <div className="mobile-analytics__controls ui-row">
        <label className="mobile-field ui-stack ui-muted">
          <span>Project</span>
          <select
            value={selectedProject ?? ''}
            onChange={(event) => {
              setSelectedProject(event.target.value || null);
              setSelectedSwarmId(null);
            }}
          >
            {projects.map((project) => (
              <option key={project.projectRoot} value={project.projectRoot}>
                {project.projectName} · {project.workers.length} workers
              </option>
            ))}
          </select>
        </label>

        {runsData.size > 0 && (
          <label className="mobile-field ui-stack ui-muted">
            <span>Swarm run</span>
            <select
              value={selectedSwarmId ?? ''}
              onChange={(event) => setSelectedSwarmId(event.target.value || null)}
            >
              {Array.from(runsData.keys()).map((swarmId) => (
                <option key={swarmId} value={swarmId}>
                  {shortWorkerId(swarmId)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && (
        <div role="status" aria-live="polite" className="mobile-muted ui-muted">
          Loading analytics…
        </div>
      )}

      {error && <p className="mobile-error">{error}</p>}

      {!loading && !selectedRun && runsData.size === 0 && !error && (
        <EmptyState message="No swarm runs found for this project." />
      )}

      {stats && (
        <section className="mobile-analytics__stats" aria-label="Swarm stats">
          <div className="mobile-stats-grid">
            <div className="mobile-stat-card ui-stack ui-card">
              <span className="mobile-stat-card__value">
                {stats.completedIterations}/{stats.totalIterations}
              </span>
              <span className="mobile-stat-card__label ui-muted">Cycles done</span>
              <div className="mobile-stat-card__bar">
                <div
                  className="mobile-stat-card__fill"
                  style={{
                    width: `${stats.totalIterations > 0 ? Math.round((stats.completedIterations / stats.totalIterations) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
            <div className="mobile-stat-card ui-stack ui-card">
              <span className="mobile-stat-card__value">{stats.totalMerges}</span>
              <span className="mobile-stat-card__label ui-muted">Total merges</span>
            </div>
            <div className="mobile-stat-card ui-stack ui-card">
              <span className="mobile-stat-card__value">{stats.totalRejections}</span>
              <span className="mobile-stat-card__label ui-muted">Rejections</span>
            </div>
            <div className="mobile-stat-card ui-stack ui-card">
              <span className="mobile-stat-card__value">{stats.totalReviewRounds}</span>
              <span className="mobile-stat-card__label ui-muted">Review rounds</span>
            </div>
            <div className="mobile-stat-card ui-stack ui-card">
              <span className="mobile-stat-card__value">{stats.totalWorkers}</span>
              <span className="mobile-stat-card__label ui-muted">Workers</span>
              <span className="mobile-muted ui-muted">
                {[
                  stats.runningWorkers > 0 ? `${stats.runningWorkers} running` : null,
                  stats.completedWorkers > 0 ? `${stats.completedWorkers} done` : null,
                  stats.errorWorkers > 0 ? `${stats.errorWorkers} error` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            </div>
            <div className="mobile-stat-card ui-stack ui-card">
              <span className="mobile-stat-card__value">{stats.totalErrors}</span>
              <span className="mobile-stat-card__label ui-muted">Errors</span>
            </div>
          </div>
          {stats.finishedAt && (
            <p className="mobile-muted ui-muted">
              Finished {formatTimeAgo(new Date(stats.finishedAt))} ·{' '}
              {formatDuration(timeline?.timeRange.duration ?? 0)}
            </p>
          )}
        </section>
      )}

      {timeline && timeline.timelines.length > 0 && (
        <section className="mobile-analytics__timeline" aria-label="Worker timelines">
          <h2 className="mobile-buddy-section__heading">Timelines</h2>
          <div className="mobile-timeline">
            {timeline.timelines.map((worker) => (
              <div key={worker.workerId} className="mobile-timeline__row ui-stack">
                <div className="mobile-timeline__worker">
                  <strong>{shortWorkerId(worker.workerId)}</strong>
                  <span className="mobile-muted ui-muted">
                    {worker.model} · {worker.harness}
                  </span>
                </div>
                <div className="mobile-timeline__spans" role="list">
                  {worker.spans.map((span) => (
                    <button
                      key={span.id}
                      type="button"
                      role="listitem"
                      className={`mobile-timeline__span mobile-timeline__span--${span.status}`}
                      onClick={() => setInspected({ span, workerId: worker.workerId })}
                      aria-label={`Cycle ${span.iteration} ${span.status}${span.verdict ? ` verdict ${span.verdict}` : ''} — tap to inspect`}
                    >
                      <span className="mobile-timeline__span-label ui-muted">
                        #{span.iteration}
                      </span>
                      {span.verdict && (
                        <span
                          className={`mobile-badge ui-inline-row ui-card ui-muted mobile-badge--${span.verdict}`}
                        >
                          {span.verdict}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {timeline.isEstimated && (
            <p className="mobile-analytics__disclaimer ui-muted" role="note">
              Timing estimated — per-iteration timestamps not available
            </p>
          )}
        </section>
      )}

      {timeline && timeline.timelines.length === 0 && !loading && (
        <EmptyState message="No cycle data available." />
      )}

      {inspected && (
        <div
          className="mobile-bottom-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Cycle detail"
          onClick={() => setInspected(null)}
        >
          <div
            className="mobile-bottom-sheet__content ui-stack"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-bottom-sheet__header ui-row">
              <strong>
                {shortWorkerId(inspected.workerId)} · Cycle {inspected.span.iteration}
              </strong>
              <button
                type="button"
                className="mobile-link ui-inline-row"
                onClick={() => setInspected(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mobile-bottom-sheet__body">
              <p>
                <span className="mobile-muted ui-muted">Status:</span> {inspected.span.status}
              </p>
              {inspected.span.verdict && (
                <p>
                  <span className="mobile-muted ui-muted">Verdict:</span> {inspected.span.verdict}
                </p>
              )}
              <p>
                <span className="mobile-muted ui-muted">Review rounds:</span>{' '}
                {inspected.span.reviewRounds}
              </p>
              <p>
                <span className="mobile-muted ui-muted">Files changed:</span>{' '}
                {inspected.span.diffFiles}
              </p>
              <p>
                <span className="mobile-muted ui-muted">Merges:</span>{' '}
                {Math.round(inspected.span.merges)}
              </p>
              {inspected.span.startTime && inspected.span.endTime && (
                <p className="mobile-muted ui-muted">
                  {new Date(inspected.span.startTime).toLocaleString()} →{' '}
                  {new Date(inspected.span.endTime).toLocaleString()}
                </p>
              )}
              {inspected.span.output && (
                <pre className="mobile-pre ui-card">{inspected.span.output.slice(0, 800)}</pre>
              )}
            </div>
            <button
              type="button"
              className="mobile-cta ui-control ui-inline-row"
              onClick={() => setInspected(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
