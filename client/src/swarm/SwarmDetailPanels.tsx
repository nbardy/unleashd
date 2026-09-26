import type { SwarmReviewLog, SwarmRun, SwarmRunSummary } from '@unleashd/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { usePolledFetch } from '../hooks/usePolledFetch';
import { formatTimeAgo } from '../utils/time';

// Stable empty fallbacks (AGENTS.md: a fresh [] per render defeats memoisation).
const NO_COMMITS: GitLogEntry[] = [];
const NO_RUNS: SwarmRun[] = [];
const NO_REVIEWS: SwarmReviewLog[] = [];

interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
  author: string;
}

interface OompaConfig {
  workers: {
    model: string;
    prompt?: string | string[];
    iterations?: number;
    count?: number;
    can_plan?: boolean;
  }[];
  reviewer?: { model: string };
}

const sum = (summary: SwarmRunSummary, key: 'merges' | 'rejections' | 'errors') =>
  summary.workers.reduce((total, w) => total + w[key], 0);

/** A titled panel whose body folds away. */
function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="swarm-detail-panel ui-stack ui-card">
      <button
        type="button"
        className="swarm-detail-panel-toggle ui-row"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="ui-muted">{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && <div className="swarm-detail-panel-body">{children}</div>}
    </section>
  );
}

export function GitLogPanel({ projectRoot }: { projectRoot: string }) {
  // intervalMs 0: one fetch per project, keyed on the URL.
  const log = usePolledFetch<GitLogEntry[]>(
    `/api/git-log?dir=${encodeURIComponent(projectRoot)}`,
    0
  );
  const commits = log.data ?? NO_COMMITS;
  return (
    <Collapsible title="Recent Commits">
      {log.kind === 'loading' && <div className="ui-muted">Loading commits...</div>}
      {log.kind !== 'loading' && commits.length === 0 && (
        <div className="ui-muted">No commits found</div>
      )}
      {commits.map((c) => (
        <div key={c.hash} className="swarm-detail-commit ui-row">
          <code className="swarm-detail-commit-hash">{c.hash.substring(0, 7)}</code>
          <span className="swarm-detail-commit-message ui-truncate">{c.message}</span>
          <span className="ui-muted">{c.author}</span>
          <span className="ui-muted">{formatTimeAgo(new Date(c.date))}</span>
        </div>
      ))}
    </Collapsible>
  );
}

export function OompaConfigPanel({ projectRoot }: { projectRoot: string }) {
  const [expandedPrompts, setExpandedPrompts] = useState<Map<string, string>>(new Map());
  const configFetch = usePolledFetch<OompaConfig>(
    `/api/oompa-config?dir=${encodeURIComponent(projectRoot)}`,
    0
  );
  const config = configFetch.data;

  // The fetch sits outside the setState updater: StrictMode double-fires
  // updaters, which would duplicate it.
  const togglePrompt = useCallback(
    (promptPath: string) => {
      if (expandedPrompts.has(promptPath)) {
        setExpandedPrompts((prev) => {
          const next = new Map(prev);
          next.delete(promptPath);
          return next;
        });
        return;
      }
      setExpandedPrompts((prev) => new Map(prev).set(promptPath, 'Loading...'));
      const absolute = promptPath.startsWith('/') ? promptPath : `${projectRoot}/${promptPath}`;
      fetch(`/api/read-file?path=${encodeURIComponent(absolute)}`)
        .then((res) => res.json())
        .then((data: { content: string }) =>
          setExpandedPrompts((p) => new Map(p).set(promptPath, data.content))
        )
        .catch(() => setExpandedPrompts((p) => new Map(p).set(promptPath, '(failed to load)')));
    },
    [projectRoot, expandedPrompts]
  );

  return (
    <Collapsible title="Swarm Config">
      {/* A config that loaded once stays shown if a re-read fails (`stale`). */}
      {configFetch.kind === 'failed' && <div className="swarm-error">No oompa config found</div>}
      {configFetch.kind === 'loading' && <div className="ui-muted">Loading config...</div>}
      {config && (
        <div className="swarm-detail-config ui-stack">
          {config.workers.map((w, i) => {
            const prompts = Array.isArray(w.prompt) ? w.prompt : w.prompt ? [w.prompt] : [];
            return (
              <div key={i} className="ui-stack">
                <div className="swarm-detail-config-row ui-row">
                  <span className="swarm-detail-model">{w.model}</span>
                  <span className="ui-muted">
                    x{w.count ?? 1} · {w.iterations ?? '?'} cycles
                    {w.can_plan === false && ' (executor)'}
                  </span>
                </div>
                {prompts.map((p) => (
                  <div key={p}>
                    <button
                      type="button"
                      className="swarm-detail-prompt-path"
                      onClick={() => togglePrompt(p)}
                    >
                      {expandedPrompts.has(p) ? '▼' : '▶'} {p}
                    </button>
                    {expandedPrompts.has(p) && (
                      <pre className="swarm-detail-pre">{expandedPrompts.get(p)}</pre>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {config.reviewer && (
            <div className="swarm-detail-config-row ui-row">
              <span className="swarm-detail-model">{config.reviewer.model}</span>
              <span className="ui-muted">reviewer</span>
            </div>
          )}
        </div>
      )}
    </Collapsible>
  );
}

/** Structured run history read from runs/{swarm-id}/ files. */
export function SwarmRunsPanel({
  projectRoot,
  selectedRunId,
  onSelectRunId,
}: {
  projectRoot: string;
  selectedRunId: string | null;
  onSelectRunId: (id: string) => void;
}) {
  const [expandedReview, setExpandedReview] = useState<string | null>(null);
  const runsFetch = usePolledFetch<{ runs: SwarmRun[] }>(
    `/api/swarm-runs?dir=${encodeURIComponent(projectRoot)}`,
    0
  );
  const runs = runsFetch.data?.runs ?? NO_RUNS;

  // Seeding the selection is its own effect: inside the runs fetch it re-fetched
  // the whole run list every time the user picked a run.
  useEffect(() => {
    if (runs.length > 0 && !selectedRunId) onSelectRunId(runs[0].swarmId);
  }, [runs, selectedRunId, onSelectRunId]);

  const runScoped = (endpoint: string) =>
    selectedRunId
      ? `${endpoint}?dir=${encodeURIComponent(projectRoot)}&swarmId=${encodeURIComponent(selectedRunId)}`
      : null;
  // A failed re-read keeps the reviews already shown (`stale`); until 2026-09-25
  // any error emptied the list, which read as "no reviews".
  const reviews =
    usePolledFetch<{ reviews: SwarmReviewLog[] }>(runScoped('/api/swarm-reviews'), 0).data
      ?.reviews ?? NO_REVIEWS;
  const newFiles = usePolledFetch<{ count: number }>(runScoped('/api/swarm-new-files'), 0);

  if (runsFetch.kind === 'loading')
    return <div className="swarm-empty ui-muted">Loading run history...</div>;
  if (runs.length === 0) return <div className="swarm-empty ui-muted">No runs recorded yet</div>;

  const selected = runs.find((r) => r.swarmId === selectedRunId);
  const summary = selected?.summary;

  return (
    <div className="swarm-detail-runs ui-stack">
      <div className="swarm-detail-run-picker ui-row">
        {runs.map((r) => (
          <button
            type="button"
            key={r.swarmId}
            className="swarm-detail-run-chip ui-row ui-card"
            data-active={r.swarmId === selectedRunId}
            onClick={() => onSelectRunId(r.swarmId)}
          >
            <span className="swarm-detail-mono">{r.swarmId}</span>
            {r.run && (
              <span className="ui-muted">{new Date(r.run['started-at']).toLocaleDateString()}</span>
            )}
            {r.summary && (
              <span className="ui-muted">
                {r.summary['total-completed']}/{r.summary['total-iterations']}
              </span>
            )}
          </button>
        ))}
      </div>

      {summary && (
        <section className="swarm-detail-card ui-stack ui-card">
          <div className="swarm-detail-card-head ui-row">
            <h4>Summary</h4>
            {selected?.run && (
              <span className="ui-muted">
                Started {new Date(selected.run['started-at']).toLocaleString()}
              </span>
            )}
            {summary['finished-at'] && (
              <span className="ui-muted">
                Finished {new Date(summary['finished-at']).toLocaleString()}
              </span>
            )}
          </div>
          <div className="swarm-detail-run-stats ui-row">
            <RunStat
              label="Pending"
              value={summary.workers.filter((w) => w.status === 'running').length}
            />
            <RunStat
              label="New"
              value={newFiles.data?.count ?? (newFiles.kind === 'failed' ? 0 : '…')}
            />
            <RunStat label="Completed" value={summary['total-completed']} />
            <RunStat
              label="Cycles"
              value={`${summary['total-completed']}/${summary['total-iterations']}`}
            />
            <RunStat label="Merged" value={`+${sum(summary, 'merges')}`} tone="success" />
            <RunStat label="Rejected" value={`-${sum(summary, 'rejections')}`} tone="danger" />
          </div>
          <div className="swarm-detail-table-scroll">
            <table className="swarm-detail-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Harness</th>
                  <th>Status</th>
                  <th>Done</th>
                  <th>Merges</th>
                  <th>Rej</th>
                  <th>Err</th>
                  <th>Reviews</th>
                </tr>
              </thead>
              <tbody>
                {summary.workers.map((w) => (
                  <tr key={w.id}>
                    <td className="swarm-detail-mono">{w.id}</td>
                    <td>
                      {w.harness}:{w.model ?? 'default'}
                    </td>
                    <td>
                      <span
                        className="swarm-detail-status"
                        data-status={w.status}
                        title={w.status}
                      />
                    </td>
                    <td>
                      {w.completed}/{w.iterations}
                    </td>
                    <td>{w.merges}</td>
                    <td>{w.rejections}</td>
                    <td>{w.errors}</td>
                    <td>{w['review-rounds-total']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="swarm-detail-card ui-stack ui-card">
          <h4>Review Log ({reviews.length} reviews)</h4>
          {reviews.map((r) => {
            const key = `${r['worker-id']}-i${r.iteration}-r${r.round}`;
            const open = expandedReview === key;
            return (
              <div key={key} className="swarm-detail-review ui-stack">
                <button
                  type="button"
                  className="swarm-detail-review-head ui-row"
                  onClick={() => setExpandedReview(open ? null : key)}
                  aria-expanded={open}
                >
                  <span className="swarm-detail-mono">{r['worker-id']}</span>
                  <span className="ui-muted">
                    c{r.iteration} r{r.round}
                  </span>
                  <span className="swarm-verdict" data-verdict={r.verdict}>
                    {r.verdict.toUpperCase().replace('-', ' ')}
                  </span>
                  <span className="ui-muted">{r['diff-files']?.length ?? 0} files</span>
                  <span className="ui-muted">{new Date(r.timestamp).toLocaleTimeString()}</span>
                  <span className="ui-muted">{open ? '▼' : '▶'}</span>
                </button>
                {open && <pre className="swarm-detail-pre">{r.output}</pre>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function RunStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return (
    <div className="swarm-detail-run-stat ui-stack" data-tone={tone}>
      <span className="swarm-detail-run-stat-value">{value}</span>
      <span className="ui-muted">{label}</span>
    </div>
  );
}
