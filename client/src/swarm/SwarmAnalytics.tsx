import type { SwarmRunLog, SwarmRunSummary } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { resource, usePolledFetch } from '../hooks/usePolledFetch';
import { formatDuration, formatTimeAgo } from '../utils/time';
import { type SwarmLayout, SwarmPage } from './SwarmPage';
import { listAnalyticsProjects } from './swarm-groups';
import { swarmWorkersByProjectAtom } from './swarm-workers';
import {
  type IterationSpan,
  type RunData,
  type TimelineData,
  buildTimelineData,
  computeSwarmStats,
} from './swarmAnalyticsParsers';
import './SwarmAnalytics.css';

// Stable empty fallback (AGENTS.md: stable fallbacks are module constants).
const NO_RUNS_DATA = new Map<string, RunData>();

/**
 * Timeline of one run. Wide: a time-axis chart, hover a span for its detail.
 * Narrow: a list of cycle chips per worker, tap one for a bottom sheet (no hover on touch).
 */
const TIMELINES: Record<SwarmLayout, (props: { timeline: TimelineData }) => ReactNode> = {
  wide: TimelineChart,
  narrow: TimelineList,
};

/** How much of a cycle's output the detail shows: a hover tooltip vs a scrollable sheet. */
const OUTPUT_CHARS: Record<SwarmLayout, number> = { wide: 200, narrow: 800 };

interface Inspected {
  span: IterationSpan;
  workerId: string;
}

function shortWorkerId(id: string): string {
  if (id.includes('-')) return id.split('-').slice(-2).join('-');
  return id.length > 12 ? id.slice(-12) : id;
}

const VERDICT_ICON: Record<NonNullable<IterationSpan['verdict']>, string> = {
  approved: '✓',
  rejected: '✗',
  'needs-changes': '~',
};

/** Every run of a project with its reviews: one keyed resource, cached per project. */
function projectRunsResource(project: string) {
  return resource(
    `swarm-analytics-runs:${project}`,
    async (signal: AbortSignal): Promise<Map<string, RunData>> => {
      const response = await fetch(`/api/swarm-runs?dir=${encodeURIComponent(project)}`, {
        signal,
      });
      if (!response.ok) throw new Error(`Failed to load swarm runs (HTTP ${response.status})`);
      const body = (await response.json()) as {
        runs: { swarmId: string; run: SwarmRunLog | null; summary: SwarmRunSummary | null }[];
      };
      // Reviews for every run in parallel; an abort propagates so the hook drops
      // the whole cycle, any other per-run failure reads as "no reviews".
      const entries = await Promise.all(
        body.runs.map(async (run): Promise<RunData> => {
          const reviews = await fetch(
            `/api/swarm-reviews?dir=${encodeURIComponent(project)}&swarmId=${encodeURIComponent(run.swarmId)}`,
            { signal }
          )
            .then((r) => r.json() as Promise<{ reviews?: RunData['reviews'] }>)
            .then((json) => json.reviews ?? [])
            .catch((error: unknown) => {
              if ((error as Error).name === 'AbortError') throw error;
              return [];
            });
          return { ...run, reviews };
        })
      );
      return new Map(entries.map((entry) => [entry.swarmId, entry]));
    }
  );
}

export function SwarmAnalytics({ layout }: { layout: SwarmLayout }) {
  const workersByProject = useAtomValue(swarmWorkersByProjectAtom);
  const projects = useMemo(() => listAnalyticsProjects(workersByProject), [workersByProject]);
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const project = pickedProject ?? projects[0]?.projectRoot ?? null;

  const source = useMemo(() => (project ? projectRunsResource(project) : null), [project]);
  const runsFetch = usePolledFetch<Map<string, RunData>>(source, 0);
  const runsData = runsFetch.data ?? NO_RUNS_DATA;
  // Newest run first; with no pick, the newest run is shown.
  const runs = useMemo(
    () =>
      [...runsData.values()].sort((a, b) =>
        (b.run?.['started-at'] ?? '').localeCompare(a.run?.['started-at'] ?? '')
      ),
    [runsData]
  );
  // The run picked per project, so switching back restores it.
  const [pickedRuns, setPickedRuns] = useState<ReadonlyMap<string, string>>(new Map());
  const selectedRun = runsData.get(pickedRuns.get(project ?? '') ?? '') ?? runs[0] ?? null;

  const Timeline = TIMELINES[layout];
  const timeline = useMemo(() => selectedRun && buildTimelineData(selectedRun), [selectedRun]);

  return (
    <SwarmPage
      layout={layout}
      className="swarm-analytics"
      back={{ to: '/workers', label: 'Swarms' }}
      title="Swarm Analytics"
      subtitle={null}
      actions={
        projects.length > 0 && (
          <label className="swarm-analytics-field ui-row ui-muted">
            Project
            <select value={project ?? ''} onChange={(e) => setPickedProject(e.target.value)}>
              {projects.map((p) => (
                <option key={p.projectRoot} value={p.projectRoot}>
                  {p.projectName} ({p.sessionCount} sessions)
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      {projects.length === 0 ? (
        <div className="swarm-empty ui-muted">
          No worker conversations found. Workers are detected by the [oompa] prefix in the first
          message.
        </div>
      ) : runsFetch.kind === 'loading' ? (
        <div className="swarm-empty ui-muted">Loading swarm data...</div>
      ) : (
        <>
          {runsFetch.kind === 'failed' && (
            <div className="swarm-error">{runsFetch.error.message}</div>
          )}
          {runs.length > 0 && (
            <div className="swarm-analytics-runs ui-row">
              {runs.map((run) => (
                <button
                  type="button"
                  key={run.swarmId}
                  className="swarm-analytics-run ui-row ui-card"
                  data-active={run === selectedRun}
                  onClick={() => setPickedRuns((m) => new Map(m).set(project ?? '', run.swarmId))}
                >
                  <span className="swarm-analytics-mono">{run.swarmId}</span>
                  {run.summary && (
                    <span>
                      {run.summary['total-completed']}/{run.summary['total-iterations']}
                    </span>
                  )}
                  {run.run?.['started-at'] && (
                    <span className="ui-muted">
                      {formatTimeAgo(new Date(run.run['started-at']))}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {selectedRun && timeline ? (
            <>
              <StatsPanel runData={selectedRun} duration={timeline.timeRange.duration} />
              <section className="swarm-analytics-section ui-stack ui-card">
                <h3>Worker Cycle Timeline</h3>
                {timeline.timelines.length === 0 ? (
                  <div className="swarm-empty ui-muted">No cycle data available</div>
                ) : (
                  <Timeline timeline={timeline} />
                )}
                {timeline.isEstimated && (
                  <p className="swarm-analytics-note ui-muted" role="note">
                    Timing estimated — per-iteration timestamps not available
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="swarm-empty ui-muted">
              No recorded runs for this project. Runs are recorded when oompa swarm data is
              available in the runs/ directory.
            </div>
          )}
          <Legend />
        </>
      )}
    </SwarmPage>
  );
}

function StatsPanel({ runData, duration }: { runData: RunData; duration: number }) {
  const stats = useMemo(() => computeSwarmStats(runData), [runData]);
  if (!stats) return null;
  const pct =
    stats.totalIterations > 0
      ? Math.round((stats.completedIterations / stats.totalIterations) * 100)
      : 0;
  const workerBreakdown = [
    stats.runningWorkers > 0 && `${stats.runningWorkers} running`,
    stats.completedWorkers > 0 && `${stats.completedWorkers} done`,
    stats.errorWorkers > 0 && `${stats.errorWorkers} error`,
  ].filter(Boolean);
  return (
    <section className="swarm-analytics-stats ui-stack" aria-label="Swarm stats">
      <div className="swarm-analytics-grid">
        <StatCard
          value={`${stats.completedIterations}/${stats.totalIterations}`}
          label="Cycles Done"
        >
          <div className="swarm-analytics-bar">
            <div className="swarm-analytics-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </StatCard>
        <StatCard value={stats.totalMerges} label="Total Merges" tone="success" />
        <StatCard value={stats.totalRejections} label="Rejections" tone="danger" />
        <StatCard value={stats.totalReviewRounds} label="Review Rounds" />
        <StatCard value={stats.totalWorkers} label="Workers">
          <span className="ui-muted">{workerBreakdown.join(' · ') || '—'}</span>
        </StatCard>
        <StatCard value={stats.totalErrors} label="Errors" />
      </div>
      {stats.finishedAt && (
        <p className="swarm-analytics-note ui-muted">
          Finished {formatTimeAgo(new Date(stats.finishedAt))} · {formatDuration(duration)}
        </p>
      )}
    </section>
  );
}

function StatCard({
  value,
  label,
  tone = 'neutral',
  children,
}: {
  value: ReactNode;
  label: string;
  tone?: 'neutral' | 'success' | 'danger';
  children?: ReactNode;
}) {
  return (
    <div className="swarm-analytics-card ui-stack ui-card" data-tone={tone}>
      <span className="swarm-analytics-card-value">{value}</span>
      <span className="swarm-analytics-card-label ui-muted">{label}</span>
      {children}
    </div>
  );
}

/** One cycle's facts: inside the wide tooltip and the narrow sheet. */
function SpanDetail({ inspected, outputChars }: { inspected: Inspected; outputChars: number }) {
  const { span } = inspected;
  return (
    <div className="swarm-analytics-detail ui-stack">
      <strong>
        {shortWorkerId(inspected.workerId)} · Cycle {span.iteration}
      </strong>
      <span>
        <span className="ui-muted">Status:</span> {span.status}
      </span>
      {span.verdict && (
        <span>
          <span className="ui-muted">Verdict:</span> {span.verdict}
        </span>
      )}
      <span>
        <span className="ui-muted">Files changed:</span> {span.diffFiles} ·{' '}
        <span className="ui-muted">Review rounds:</span> {span.reviewRounds} ·{' '}
        <span className="ui-muted">Merges:</span> +{Math.round(span.merges)}
      </span>
      {span.endTime !== null && (
        <span className="ui-muted">
          {new Date(span.startTime).toLocaleString()} → {new Date(span.endTime).toLocaleString()}
        </span>
      )}
      {span.output && (
        <pre className="swarm-analytics-pre">
          {span.output.slice(0, outputChars)}
          {span.output.length > outputChars ? '...' : ''}
        </pre>
      )}
    </div>
  );
}

const ROW_HEIGHT = 40;
const AXIS_HEIGHT = 30;

function TimelineChart({ timeline }: { timeline: TimelineData }) {
  const [hover, setHover] = useState<(Inspected & { x: number; y: number }) | null>(null);
  const { timelines, timeRange } = timeline;
  const pctOf = (t: number) => ((t - timeRange.start) / timeRange.duration) * 100;
  return (
    <div className="swarm-analytics-chart ui-row">
      <div className="swarm-analytics-chart-labels ui-stack" style={{ paddingTop: AXIS_HEIGHT }}>
        {timelines.map((t) => (
          <div key={t.workerId} className="ui-stack" style={{ height: ROW_HEIGHT }}>
            <span className="swarm-analytics-mono">{shortWorkerId(t.workerId)}</span>
            <span className="ui-muted">{t.model}</span>
          </div>
        ))}
      </div>
      <div
        className="swarm-analytics-chart-area"
        style={{ height: AXIS_HEIGHT + timelines.length * ROW_HEIGHT }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="swarm-analytics-tick ui-muted" style={{ left: `${i * 20}%` }}>
            {formatDuration((timeRange.duration * i) / 5)}
          </span>
        ))}
        {timelines.map((t, row) =>
          t.spans.map((span) => {
            const start = pctOf(span.startTime);
            const width = Math.max(pctOf(span.endTime ?? Date.now()) - start, 0.5);
            const show = (e: React.MouseEvent) =>
              setHover({ span, workerId: t.workerId, x: e.clientX + 10, y: e.clientY - 10 });
            return (
              <div
                key={span.id}
                className="swarm-analytics-span ui-row"
                data-status={span.status}
                data-verdict={span.verdict ?? 'none'}
                style={{
                  left: `${start}%`,
                  width: `${width}%`,
                  top: AXIS_HEIGHT + row * ROW_HEIGHT + 8,
                }}
                onMouseEnter={show}
                onMouseMove={show}
                onMouseLeave={() => setHover(null)}
              >
                {span.verdict && VERDICT_ICON[span.verdict]}
                {span.reviewRounds > 1 && ` r${span.reviewRounds}`}
              </div>
            );
          })
        )}
      </div>
      {hover && (
        <div className="swarm-analytics-tooltip ui-card" style={{ left: hover.x, top: hover.y }}>
          <SpanDetail inspected={hover} outputChars={OUTPUT_CHARS.wide} />
        </div>
      )}
    </div>
  );
}

function TimelineList({ timeline }: { timeline: TimelineData }) {
  const [inspected, setInspected] = useState<Inspected | null>(null);
  return (
    <div className="swarm-analytics-list ui-stack">
      {timeline.timelines.map((t) => (
        <div key={t.workerId} className="ui-stack">
          <span>
            <strong className="swarm-analytics-mono">{shortWorkerId(t.workerId)}</strong>{' '}
            <span className="ui-muted">
              {t.model} · {t.harness}
            </span>
          </span>
          <div className="swarm-analytics-chips ui-row">
            {t.spans.map((span) => (
              <button
                key={span.id}
                type="button"
                className="swarm-analytics-chip ui-row"
                data-status={span.status}
                onClick={() => setInspected({ span, workerId: t.workerId })}
                aria-label={`Cycle ${span.iteration} ${span.status}${span.verdict ? ` verdict ${span.verdict}` : ''}, tap to inspect`}
              >
                #{span.iteration}
                {span.verdict && ` ${VERDICT_ICON[span.verdict]}`}
              </button>
            ))}
          </div>
        </div>
      ))}
      {inspected && <CycleSheet inspected={inspected} onClose={() => setInspected(null)} />}
    </div>
  );
}

/** Native <dialog>: showModal() gives the top layer, focus trap and Escape (as `cancel`). */
function CycleSheet({ inspected, onClose }: { inspected: Inspected; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);
  // A click on ::backdrop reaches the dialog itself; one inside the sheet reaches a child.
  return (
    <dialog
      ref={ref}
      className="swarm-analytics-sheet ui-stack"
      aria-label="Cycle detail"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <SpanDetail inspected={inspected} outputChars={OUTPUT_CHARS.narrow} />
      <button type="button" className="swarm-btn ui-control" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}

function Legend() {
  return (
    <section className="swarm-analytics-legend ui-row ui-card ui-muted">
      {(['running', 'completed', 'error', 'pending'] as const).map((status) => (
        <span key={status} className="ui-inline-row">
          <span className="swarm-analytics-swatch" data-status={status} /> {status}
        </span>
      ))}
      {Object.entries(VERDICT_ICON).map(([verdict, icon]) => (
        <span key={verdict} className="ui-inline-row">
          <span className="swarm-analytics-span-verdict" data-verdict={verdict}>
            {icon}
          </span>{' '}
          {verdict.replace('-', ' ')}
        </span>
      ))}
    </section>
  );
}
