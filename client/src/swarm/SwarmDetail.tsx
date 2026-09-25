import type {
  ConversationRow,
  OompaRuntimeWorker,
  SwarmReviewLog,
  SwarmRun,
  SwarmRunSummary,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createConversation, readConversationMessages } from '../atoms/actions';
import { groupsFamily, rowFamily } from '../atoms/conversations';
import { markMessagesSeen } from '../atoms/ui';
import { VirtualizedMessageList } from '../components/VirtualizedMessageList';
import { useConversationBodies } from '../hooks/useConversationBodies';
import { usePolledFetch } from '../hooks/usePolledFetch';
import { isRowRunning, rowWorker } from '../utils/conversation-row';
import { formatTimeAgo } from '../utils/time';
import { getWorkerVisibilitySummary } from './swarmWorkerVisibility';
import { useSwarmRuntimeSnapshots } from './useSwarmRuntimeSnapshots';
import './SwarmDetail.css';
import { useTimeTick } from '../hooks/useTimeTick';
import { shortenHomePath } from '../utils/directories';
import { NO_WORKERS, swarmWorkersByProjectAtom } from './swarm-workers';

// Stable empty fallbacks for usePolledFetch results (AGENTS.md: stable fallbacks
// are module constants — a fresh [] per render defeats downstream memoisation).
const NO_COMMITS: GitLogEntry[] = [];
const NO_RUNS: SwarmRun[] = [];
const NO_REVIEWS: SwarmReviewLog[] = [];

// =============================================================================
// Types for server API responses
// =============================================================================

interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
  author: string;
}

interface OompaWorkerConfig {
  model: string;
  prompt?: string | string[];
  iterations?: number;
  count?: number;
  can_plan?: boolean;
}

interface OompaConfig {
  workers: OompaWorkerConfig[];
  reviewer?: { model: string; prompt?: string | string[] };
  _source?: string;
}

// =============================================================================
// Helpers
// =============================================================================

async function sendSwarmSignal(
  projectRoot: string,
  signal: 'stop' | 'kill'
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/swarm-signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: projectRoot, signal }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Shorten model names for badge display: "claude-sonnet-4-5-20250929" → "sonnet-4.5" */
function shortModelName(modelName: string | null | undefined): string | null {
  if (!modelName) return null;
  // Claude models: claude-{variant}-{major}-{minor}-{date}
  const claudeMatch = modelName.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (claudeMatch) return `${claudeMatch[1]}-${claudeMatch[2]}.${claudeMatch[3]}`;
  // Codex models: gpt-{variant}
  if (modelName.includes('codex') || modelName.includes('gpt')) {
    const parts = modelName.split('-');
    return parts.slice(0, 3).join('-');
  }
  return modelName.length > 20 ? modelName.substring(0, 20) : modelName;
}

const ROLE_LABELS: Record<string, string> = {
  work: 'exec',
  review: 'review',
  fix: 'fix',
};

/** Extract verdict from a review conversation's assistant messages */
function extractVerdict(
  conv: ConversationRow
): 'approved' | 'needs-changes' | 'rejected' | 'pending' {
  // Bodies are loaded only for a review that was opened (protocol v3); an
  // unopened review reads as pending.
  for (const msg of readConversationMessages(conv.id)) {
    if (msg.role !== 'assistant') continue;
    if (msg.content.includes('VERDICT: APPROVED')) return 'approved';
    if (msg.content.includes('VERDICT: NEEDS_CHANGES')) return 'needs-changes';
    if (msg.content.includes('VERDICT: REJECTED')) return 'rejected';
  }
  // No verdict string found in any assistant message.
  // Could be still running, or finished without printing VERDICT.
  return 'pending';
}

/** Build the invisible system-prefix for a swarm debug conversation.
 * This is prepended to the first CLI message so the agent has swarm context,
 * but stripped from the chat UI (SwarmConvoPrefix renders it as a token). */
function buildSwarmDebugPrefix(
  projectRoot: string,
  configPath: string | null,
  swarmId: string | null,
  summary: SwarmRunSummary | null,
  startedAt: string | null
): string {
  const configDisplay = configPath ?? `${projectRoot}/oompa.json`;
  const swarmDisplay = swarmId ?? 'unknown';
  const runsDir = `${projectRoot}/runs/${swarmDisplay}`;

  const lines: string[] = [
    'You are debugging an oompa swarm run. Here is the full context:',
    '',
    '## Swarm Context',
    `- Project: ${projectRoot}`,
    `- Config: ${configDisplay}`,
    `- Swarm ID: ${swarmDisplay}`,
  ];

  if (startedAt) {
    lines.push(`- Started: ${new Date(startedAt).toLocaleString()}`);
  }

  if (summary) {
    const totalMerges = summary.workers.reduce((s, w) => s + w.merges, 0);
    const totalRej = summary.workers.reduce((s, w) => s + w.rejections, 0);
    const totalErr = summary.workers.reduce((s, w) => s + w.errors, 0);

    lines.push(
      '',
      '## Run Summary',
      `- Completed: ${summary['total-completed']}`,
      `- Total Cycles: ${summary['total-iterations']}`,
      `- Merges: ${totalMerges}`,
      `- Rejections: ${totalRej}`,
      `- Errors: ${totalErr}`
    );

    if (summary.workers.length > 0) {
      lines.push(
        '',
        '## Worker Status',
        'Worker | Harness | Status | Done | Merges | Rej | Err | Reviews',
        '-------|---------|--------|------|--------|-----|-----|--------'
      );
      for (const w of summary.workers) {
        lines.push(
          `${w.id} | ${w.harness}:${w.model ?? 'default'} | ${w.status} | ${w.completed}/${w.iterations} | ${w.merges} | ${w.rejections} | ${w.errors} | ${w['review-rounds-total']}`
        );
      }
    }
  }

  lines.push(
    '',
    '## Agent Output Visibility',
    `Oompa run files are saved to: ${runsDir}/`,
    'Key files:',
    '- started.json — swarm config, worker definitions, planner/reviewer setup',
    '- cycles/<worker>-c<N>.json — per-cycle outcomes (merged/rejected/error/done)',
    '- reviews/<worker>-c<N>-r<round>.json — reviewer verdicts with full output',
    '- stopped.json — final exit status and reason',
    '',
    `To list run artifacts: ls ${runsDir}/`,
    `To read a review: cat ${runsDir}/reviews/<file>.json`,
    '',
    'Given this context, help the user debug and investigate the swarm run.'
  );

  return lines.join('\n');
}

type SwarmTab = 'workers' | 'runs';

// =============================================================================
// ExecGroup: An exec worker paired with its temporally-adjacent reviews/fixes.
// Within the same swarmId, reviews/fixes are matched to the exec worker whose
// last message timestamp is closest before the review/fix was created.
// =============================================================================

interface ExecGroup {
  exec: ConversationRow;
  reviews: ConversationRow[]; // review + fix sessions matched to this exec, newest first
}

// =============================================================================
// WorkerChatPane — renders one worker's messages in a mini Chat view
// =============================================================================

const NO_OP_SCROLL = () => {};

function WorkerChatPane({
  conversationId,
  label,
  accentColor,
  runningState,
}: {
  conversationId: string | null;
  label?: string;
  accentColor: 'cyan' | 'magenta';
  runningState: 'running' | 'idle';
}) {
  const conversation = useAtomValue(rowFamily(conversationId ?? ''));
  const isStreaming = conversation?.run === 'streaming';
  useConversationBodies(conversationId);

  // ALL hooks before any early return (React hook ordering rule)
  const messageGroups = useAtomValue(groupsFamily(conversationId ?? ''));

  const lastMessageRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const workingDirectory = conversation?.cwd ?? '';

  if (!conversationId || !conversation) {
    return (
      <div className="worker-chat-pane ui-stack empty">
        <div className="empty-state ui-muted">No {label ? label.toLowerCase() : 'worker'} log</div>
      </div>
    );
  }

  const role = rowWorker(conversation)?.role ?? 'work';
  const model = shortModelName(null);

  return (
    <div className="worker-chat-pane ui-stack">
      <div className={`worker-pane-header ui-row pane-${accentColor}`}>
        {label && <span className={`pane-label ${accentColor}`}>{label}</span>}
        <span className="worker-pane-id ui-muted">{conversationId.substring(0, 8)}</span>
        {role !== 'work' && <span className={`role-badge role-${role}`}>{ROLE_LABELS[role]}</span>}
        {model && (
          <span className={`worker-pane-provider provider-${conversation.provider || 'claude'}`}>
            {model}
          </span>
        )}
        <div className={`state-badge ui-inline-row state-${runningState}`}>
          <div className="state-indicator" />
          <span className="state-label">{runningState === 'running' ? 'Running' : 'Idle'}</span>
        </div>
      </div>
      <div className="worker-pane-messages ui-stack">
        <VirtualizedMessageList
          messageGroups={messageGroups}
          isRunning={isStreaming}
          lastMessageRef={lastMessageRef}
          onScrollStateChange={NO_OP_SCROLL}
          conversationId={conversationId}
          markMessagesSeen={markMessagesSeen}
          totalMessageCount={conversation.messageCount}
          scrollToBottomRef={scrollToBottomRef}
          workingDirectory={workingDirectory}
        />
      </div>
    </div>
  );
}

// =============================================================================
// GitLogPanel — fetches and displays recent commits for a project
// =============================================================================

function GitLogPanel({ projectRoot }: { projectRoot: string }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  // intervalMs 0: one fetch per projectRoot, aborted if projectRoot changes first.
  const log = usePolledFetch<GitLogEntry[]>(
    `/api/git-log?dir=${encodeURIComponent(projectRoot)}`,
    0
  );
  const loading = log.kind === 'loading';
  const commits = log.data ?? NO_COMMITS;

  return (
    <div className={`swarm-bottom-panel ui-stack ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="swarm-panel-header ui-row swarm-panel-toggle"
        onClick={() => setIsCollapsed((c) => !c)}
      >
        <span className="panel-toggle-icon ui-muted">{isCollapsed ? '▶' : '▼'}</span>
        Recent Commits
      </button>
      {!isCollapsed && (
        <div className="swarm-panel-content">
          {loading && <div className="panel-loading">Loading commits...</div>}
          {!loading && commits.length === 0 && <div className="panel-empty">No commits found</div>}
          {commits.map((c) => (
            <div key={c.hash} className="git-log-entry">
              <code className="git-hash">{c.hash.substring(0, 7)}</code>
              <span className="git-message ui-truncate">{c.message}</span>
              <span className="git-author ui-muted">{c.author}</span>
              <span className="git-date ui-muted">{formatTimeAgo(new Date(c.date))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// OompaConfigPanel — reads and displays the oompa.json config for a project
// =============================================================================

function OompaConfigPanel({ projectRoot }: { projectRoot: string }) {
  const [expandedPrompts, setExpandedPrompts] = useState<Map<string, string>>(new Map());
  const [isCollapsed, setIsCollapsed] = useState(false);
  // intervalMs 0: one fetch per projectRoot, aborted if projectRoot changes first.
  const configFetch = usePolledFetch<OompaConfig>(
    `/api/oompa-config?dir=${encodeURIComponent(projectRoot)}`,
    0
  );
  const config = configFetch.data;

  // Move fetch outside setState updater — StrictMode double-fires updater callbacks,
  // which would duplicate the fetch. Instead, read current state and branch outside.
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

      const absolutePath = promptPath.startsWith('/') ? promptPath : `${projectRoot}/${promptPath}`;
      fetch(`/api/read-file?path=${encodeURIComponent(absolutePath)}`)
        .then((res) => res.json())
        .then((data: { content: string }) =>
          setExpandedPrompts((p) => new Map(p).set(promptPath, data.content))
        )
        .catch(() => setExpandedPrompts((p) => new Map(p).set(promptPath, '(failed to load)')));
    },
    [projectRoot, expandedPrompts]
  );

  return (
    <div className={`swarm-bottom-panel ui-stack ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="swarm-panel-header ui-row swarm-panel-toggle"
        onClick={() => setIsCollapsed((c) => !c)}
      >
        <span className="panel-toggle-icon ui-muted">{isCollapsed ? '▶' : '▼'}</span>
        Swarm Config
      </button>
      {!isCollapsed && (
        <div className="swarm-panel-content">
          {/* A config that loaded once stays shown if a re-read fails (`stale`). */}
          {configFetch.kind === 'failed' && (
            <div className="panel-error">No oompa config found</div>
          )}
          {configFetch.kind === 'loading' && <div className="panel-loading">Loading config...</div>}
          {config && (
            <div className="config-summary ui-stack">
              {config.workers.map((w, i) => {
                const prompts = Array.isArray(w.prompt) ? w.prompt : w.prompt ? [w.prompt] : [];
                return (
                  <div key={i}>
                    <div className="config-worker-row ui-row">
                      <span className="config-model-badge">{w.model}</span>
                      <span className="config-count ui-muted">
                        x{w.count ?? 1} &middot; {w.iterations ?? '?'} cycles
                        {w.can_plan === false && ' (executor)'}
                      </span>
                    </div>
                    {prompts.map((p, pIdx) => (
                      <div key={`${i}-${pIdx}`}>
                        <span className="config-prompt-path" onClick={() => togglePrompt(p)}>
                          {expandedPrompts.has(p) ? '▼' : '▶'} {p}
                        </span>
                        {expandedPrompts.has(p) && (
                          <div className="config-prompt-content">{expandedPrompts.get(p)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
              {config.reviewer && (
                <div className="config-worker-row ui-row">
                  <span className="config-model-badge">{config.reviewer.model}</span>
                  <span className="config-count ui-muted">reviewer</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SwarmRunsPanel — shows structured run history from runs/{swarm-id}/ files
// =============================================================================

function SwarmRunsPanel({
  projectRoot,
  selectedRunId,
  onSelectRunId,
}: {
  projectRoot: string;
  selectedRunId: string | null;
  onSelectRunId: (id: string) => void;
}) {
  const setSelectedRunId = onSelectRunId;
  const [expandedReview, setExpandedReview] = useState<string | null>(null);

  // All three loads use intervalMs 0: one fetch per key, aborted if the key
  // changes first. The effects they replace had no such guard, so switching
  // projects or runs quickly let the slowest response win.
  const runsFetch = usePolledFetch<{ runs: SwarmRun[] }>(
    `/api/swarm-runs?dir=${encodeURIComponent(projectRoot)}`,
    0
  );
  const loading = runsFetch.kind === 'loading';
  const runs = runsFetch.data?.runs ?? NO_RUNS;

  // Seeding the selection is its own concern. It used to sit inside the runs
  // fetch with selectedRunId in that effect's deps, which re-fetched the whole
  // run list every time the user picked a run.
  useEffect(() => {
    if (runs.length > 0 && !selectedRunId) setSelectedRunId(runs[0].swarmId);
  }, [runs, selectedRunId, setSelectedRunId]);

  const runScoped = (endpoint: string) =>
    selectedRunId
      ? `${endpoint}?dir=${encodeURIComponent(projectRoot)}&swarmId=${encodeURIComponent(selectedRunId)}`
      : null;

  const reviewsFetch = usePolledFetch<{ reviews: SwarmReviewLog[] }>(
    runScoped('/api/swarm-reviews'),
    0
  );
  // A failed re-read keeps the reviews already shown (`stale`). Until
  // 2026-09-25 any error emptied the list, which read as "no reviews".
  const reviews = reviewsFetch.data?.reviews ?? NO_REVIEWS;

  const newFiles = usePolledFetch<{ count: number }>(runScoped('/api/swarm-new-files'), 0);
  // null while loading (the old effect reset to null on each run change), 0
  // when the count never loaded; a failed re-read keeps the last count.
  const newFilesCount =
    newFiles.kind === 'loading'
      ? null
      : newFiles.kind === 'failed'
        ? 0
        : (newFiles.data?.count ?? null);

  if (loading) return <div className="empty-state ui-muted">Loading run history...</div>;
  if (runs.length === 0) return <div className="empty-state ui-muted">No runs recorded yet</div>;

  const selectedRun = runs.find((r) => r.swarmId === selectedRunId);
  const summary = selectedRun?.summary;
  const runLog = selectedRun?.run;

  return (
    <div className="swarm-runs-panel ui-stack">
      {/* Run selector */}
      <div className="runs-selector">
        {runs.map((r) => (
          <button
            type="button"
            key={r.swarmId}
            className={`run-selector-btn ui-row ui-card ${r.swarmId === selectedRunId ? 'active' : ''}`}
            onClick={() => setSelectedRunId(r.swarmId)}
          >
            <span className="run-id">{r.swarmId}</span>
            {r.run && (
              <span className="run-time ui-muted">
                {new Date(r.run['started-at']).toLocaleDateString()}
              </span>
            )}
            {r.summary && (
              <span
                className={`run-status-badge ui-muted ${r.summary['total-completed'] > 0 ? 'has-completions' : ''}`}
              >
                {r.summary['total-completed']}/{r.summary['total-iterations']}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Selected run details */}
      {summary && (
        <div className="run-summary ui-card">
          <div className="run-summary-header">
            <h4>Summary</h4>
            {runLog && (
              <span className="run-started">
                Started {new Date(runLog['started-at']).toLocaleString()}
              </span>
            )}
            {summary['finished-at'] && (
              <span className="run-finished">
                Finished {new Date(summary['finished-at']).toLocaleString()}
              </span>
            )}
          </div>
          <div className="run-summary-stats">
            {(() => {
              const runningCount = summary.workers.filter((w) => w.status === 'running').length;
              const completed = summary['total-completed'];
              return (
                <div className="run-stat ui-stack run-stat-tasks">
                  <span className="run-stat-label ui-muted">Tasks</span>
                  <div className="run-stat-tasks-breakdown">
                    <div className="task-row ui-stack">
                      <span className="task-count task-pending">{runningCount}</span>
                      <span className="task-sublabel ui-muted">Pending</span>
                    </div>
                    <div className="task-row ui-stack">
                      <span className="task-count task-new">
                        {newFilesCount !== null ? newFilesCount : '…'}
                      </span>
                      <span className="task-sublabel ui-muted">New</span>
                    </div>
                    <div className="task-row ui-stack">
                      <span className="task-count task-completed">{completed}</span>
                      <span className="task-sublabel ui-muted">Completed</span>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="run-stat ui-stack run-stat-cycles">
              <span className="run-stat-label ui-muted">Cycles</span>
              <div className="run-stat-cycles-progress">
                <span className="cycles-done">{summary['total-completed']}</span>
                <span className="cycles-sep ui-muted">/</span>
                <span className="cycles-total ui-muted">{summary['total-iterations']}</span>
              </div>
              <div className="run-stat-cycles-breakdown">
                <span className="cycles-merges">
                  +{summary.workers.reduce((s, w) => s + w.merges, 0)} merged
                </span>
                <span className="cycles-rejected">
                  -{summary.workers.reduce((s, w) => s + w.rejections, 0)} rejected
                </span>
              </div>
            </div>
          </div>

          {/* Per-worker table */}
          <table className="run-workers-table">
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
                <tr key={w.id} data-status={w.status}>
                  <td className="worker-id-cell">{w.id}</td>
                  <td>
                    {w.harness}:{w.model ?? 'default'}
                  </td>
                  <td>
                    <span className={`worker-status-dot status-${w.status}`} title={w.status} />
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
      )}

      {/* Review logs */}
      {reviews.length > 0 && (
        <div className="run-reviews ui-card">
          <h4>Review Log ({reviews.length} reviews)</h4>
          <div className="run-reviews-list ui-stack">
            {reviews.map((r, i) => {
              const key = `${r['worker-id']}-i${r.iteration}-r${r.round}`;
              const isExpanded = expandedReview === key;
              return (
                <div key={i} className="run-review-entry ui-card">
                  <div
                    className="run-review-header ui-row"
                    onClick={() => setExpandedReview(isExpanded ? null : key)}
                  >
                    <span className="run-review-worker">{r['worker-id']}</span>
                    <span className="run-review-iter ui-muted">
                      c{r.iteration} r{r.round}
                    </span>
                    <span className={`verdict-badge verdict-${r.verdict}`}>
                      {r.verdict.toUpperCase().replace('-', ' ')}
                    </span>
                    <span className="run-review-files ui-muted">
                      {r['diff-files']?.length ?? 0} files
                    </span>
                    <span className="run-review-time ui-muted">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="expand-indicator ui-muted">
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="run-review-output">
                      <pre>{r.output}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SwarmDetail — main component for the /workers/detail?project=<path> route
// =============================================================================

export function SwarmDetail() {
  const [searchParams] = useSearchParams();
  const projectRoot = searchParams.get('project') ?? '';
  const navigate = useNavigate();

  // This project's swarm workers; re-renders only when one of them changes.
  const projectWorkers =
    useAtomValue(swarmWorkersByProjectAtom).get(projectRoot ?? '') ?? NO_WORKERS;
  const runtimeSnapshots = useSwarmRuntimeSnapshots(projectRoot ? [projectRoot] : []);
  const runtimeSnapshot = projectRoot ? (runtimeSnapshots[projectRoot] ?? null) : null;

  const runtimeWorkerStates = useMemo(() => {
    const map = new Map<string, OompaRuntimeWorker>();
    if (!runtimeSnapshot?.available || !runtimeSnapshot.run) return map;
    for (const worker of runtimeSnapshot.run.workers) {
      map.set(worker.id, worker);
    }
    return map;
  }, [runtimeSnapshot]);

  const isWorkerRunningLive = useCallback(
    (worker: ConversationRow): boolean => {
      const key = rowWorker(worker)?.workerId ?? worker.id;
      const state = runtimeWorkerStates.get(key);
      if (!state) return isRowRunning(worker);
      return state.status === 'running' || state.status === 'starting';
    },
    [runtimeWorkerStates]
  );

  useTimeTick();

  // Tab state
  const [activeTab, setActiveTab] = useState<SwarmTab>('runs');

  // Selected run ID — lifted here so handleStartDebugConversation uses the correct swarm
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const effectiveRunId =
    selectedRunId ?? runtimeSnapshot?.run?.swarmId ?? runtimeSnapshot?.run?.runId ?? null;

  // Inline confirmation for destructive stop/kill actions (replaces window.confirm/alert)
  const [confirmAction, setConfirmAction] = useState<'stop' | 'kill' | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);

  // Swarm debug conversation: create a new Claude conversation pre-seeded with swarm context.
  // Uses selectedRunId (the run the user has selected in the Runs tab) so the debug context
  // matches what the user is looking at — not always the latest/live swarm.
  const handleStartDebugConversation = useCallback(async () => {
    // selectedRunId is the run currently selected in SwarmRunsPanel; fall back to runtime's
    // swarmId only when no run has been selected yet (e.g. panel not yet loaded).
    const swarmId = effectiveRunId;
    const configPath = runtimeSnapshot?.run?.configPath ?? null;

    // Fetch run summary for the selected swarm.
    let summary: SwarmRunSummary | null = null;
    let startedAt: string | null = null;
    try {
      const res = await fetch(`/api/swarm-runs?dir=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data: { runs: SwarmRun[] } = await res.json();
        // Find matching run by swarmId, or use the most recent
        const match = swarmId ? data.runs.find((r) => r.swarmId === swarmId) : data.runs[0];
        if (match) {
          summary = match.summary;
          startedAt = match.run?.['started-at'] ?? null;
        }
      }
    } catch {
      // Non-critical — prefix still works without summary data
    }

    const prefix = buildSwarmDebugPrefix(projectRoot, configPath, swarmId, summary, startedAt);
    const id = createConversation({
      workingDirectory: projectRoot,
      config: {
        provider: 'claude',
        model: { mode: 'default' },
        reasoning: { mode: 'default' },
      },
      swarmDebugPrefix: prefix,
      kind: { t: 'chat' },
    });
    navigate(`/chat/${id}`);
  }, [projectRoot, effectiveRunId, runtimeSnapshot, navigate]);

  // Filter workers belonging to this project, build exec groups with paired reviews/fixes.
  // Reviews/fixes are matched to exec workers by time proximity within the same swarmId.
  const { execGroups, allWorkers, workCount, reviewCount, fixCount } = useMemo(() => {
    const execs: ConversationRow[] = [];
    const reviewsAndFixes: ConversationRow[] = [];

    for (const conv of projectWorkers) {
      if (effectiveRunId && (rowWorker(conv)?.swarmId ?? null) !== effectiveRunId) continue;

      if (rowWorker(conv)?.role === 'review' || rowWorker(conv)?.role === 'fix') {
        reviewsAndFixes.push(conv);
      } else {
        execs.push(conv);
      }
    }

    // Sort execs: running first, then by most recent activity
    const sortByActivity = (a: ConversationRow, b: ConversationRow) => {
      const aRunning = isWorkerRunningLive(a);
      const bRunning = isWorkerRunningLive(b);
      if (aRunning && !bRunning) return -1;
      if (!aRunning && bRunning) return 1;
      const aTime = a.activityAt;
      const bTime = b.activityAt;
      return bTime - aTime;
    };
    execs.sort(sortByActivity);

    // Pair reviews/fixes to exec workers by time: assign each review/fix to the exec
    // (within the same swarmId) whose last message is closest before the review/fix was created.
    const groups: ExecGroup[] = execs.map((exec) => ({ exec, reviews: [] }));
    for (const rf of reviewsAndFixes) {
      const rfCreated = new Date(rf.createdAt).getTime();
      let bestGroup: ExecGroup | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const g of groups) {
        // Must share swarmId (or both null)
        if ((rowWorker(g.exec)?.swarmId ?? null) !== (rowWorker(rf)?.swarmId ?? null)) continue;
        const execTime = g.exec.activityAt;
        const delta = Math.abs(rfCreated - execTime);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestGroup = g;
        }
      }
      if (bestGroup) {
        bestGroup.reviews.push(rf);
      }
      // Orphan reviews (no matching exec) are dropped — they'd only appear if exec was promoted
    }

    // Sort reviews within each group: newest first
    for (const g of groups) {
      g.reviews.sort(sortByActivity);
    }

    const all = [...execs, ...reviewsAndFixes];

    return {
      execGroups: groups,
      allWorkers: all,
      workCount: execs.length,
      reviewCount: reviewsAndFixes.filter((r) => rowWorker(r)?.role === 'review').length,
      fixCount: reviewsAndFixes.filter((r) => rowWorker(r)?.role === 'fix').length,
    };
  }, [projectWorkers, effectiveRunId, isWorkerRunningLive]);

  // Selected exec group — click a worker to show task log (left) + review (right)
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number>(0);

  const lastScopedRunIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const isFirstSelection = lastScopedRunIdRef.current === undefined;
    const runChanged = lastScopedRunIdRef.current !== effectiveRunId;
    lastScopedRunIdRef.current = effectiveRunId;

    setSelectedGroupIdx((currentIdx) => {
      if (execGroups.length === 0) return 0;
      if (!isFirstSelection && !runChanged && currentIdx < execGroups.length) return currentIdx;

      const runningIdx = execGroups.findIndex((g) => isWorkerRunningLive(g.exec));
      return runningIdx >= 0 ? runningIdx : 0;
    });
  }, [effectiveRunId, execGroups, isWorkerRunningLive]);

  // Derive pane IDs from selected group
  const selectedGroup = execGroups[selectedGroupIdx] ?? null;
  const taskPaneId = selectedGroup?.exec.id ?? null;
  // Show the most recent review for this exec group
  const reviewPaneId = selectedGroup?.reviews[0]?.id ?? null;
  // Derive running state from the exec group directly — no need to scan all conversations.
  const taskPaneRunning = useMemo(() => {
    if (!selectedGroup) return false;
    return isWorkerRunningLive(selectedGroup.exec);
  }, [selectedGroup, isWorkerRunningLive]);
  const reviewPaneRunning = useMemo(() => {
    const reviewConv = selectedGroup?.reviews[0];
    if (!reviewConv) return false;
    return isWorkerRunningLive(reviewConv);
  }, [selectedGroup, isWorkerRunningLive]);

  // Computed stats
  const workerVisibility = useMemo(
    () => getWorkerVisibilitySummary(allWorkers, runtimeSnapshot, isWorkerRunningLive),
    [allWorkers, isWorkerRunningLive, runtimeSnapshot]
  );
  const displayRunning = workerVisibility.runningWorkers;
  const runtimeTotalWorkers = workerVisibility.totalWorkers;
  const displayIdle = Math.max(runtimeTotalWorkers - displayRunning, 0);

  const earliestCreated = useMemo(() => {
    let earliest: Date | undefined;
    for (const w of allWorkers) {
      const d = new Date(w.createdAt);
      if (!earliest || d < earliest) earliest = d;
    }
    return earliest;
  }, [allWorkers]);

  const displayPath = shortenHomePath(projectRoot);

  if (!projectRoot) {
    return (
      <div className="swarm-detail">
        <div className="swarm-detail-header ui-row">
          <button
            type="button"
            className="back-to-gallery-btn ui-control"
            onClick={() => navigate('/workers')}
          >
            &#8592; Swarm Projects Overview
          </button>
          <h2>No project selected</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-detail">
      {/* Header */}
      <div className="swarm-detail-header ui-row">
        <button
          type="button"
          className="back-to-gallery-btn ui-control"
          onClick={() => navigate('/workers')}
        >
          &#8592; Swarm Projects Overview
        </button>
        <div className="swarm-detail-title-block ui-stack">
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 500 }}>
            {displayPath}
          </h2>
        </div>
        <div className="swarm-detail-header-stats ui-row">
          <button
            type="button"
            className="swarm-debug-btn ui-control"
            onClick={handleStartDebugConversation}
            title="Start a debug conversation about this swarm"
          >
            Debug Conversation
          </button>
          <div className="swarm-run-controls ui-row">
            <div
              className={`state-badge ui-inline-row swarm-header-badge state-${displayRunning > 0 ? 'running' : 'idle'}`}
            >
              <div className="state-indicator" />
              <span className="state-label">
                {displayRunning > 0 ? `${displayRunning} running` : 'All idle'}
              </span>
            </div>
            {displayRunning > 0 && confirmAction === null && (
              <div className="swarm-run-actions">
                <button
                  type="button"
                  style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    border: '1px solid var(--warning, #b58900)',
                    background: 'var(--bg-card)',
                    color: 'var(--warning, #b58900)',
                  }}
                  title="Stop swarm gracefully (finish current cycle)"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSignalError(null);
                    setConfirmAction('stop');
                  }}
                >
                  Stop
                </button>
                <button
                  type="button"
                  style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    border: '1px solid var(--danger, #dc322f)',
                    background: 'var(--bg-card)',
                    color: 'var(--danger, #dc322f)',
                  }}
                  title="Kill swarm immediately (SIGKILL)"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSignalError(null);
                    setConfirmAction('kill');
                  }}
                >
                  Kill
                </button>
              </div>
            )}
            {confirmAction !== null && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginLeft: '8px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  {confirmAction === 'stop'
                    ? 'Stop swarm? Workers will finish their current cycle.'
                    : 'Kill swarm immediately? This will forcibly terminate all workers.'}
                </span>
                <button
                  type="button"
                  style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: `1px solid ${confirmAction === 'kill' ? 'var(--danger, #dc322f)' : 'var(--warning, #b58900)'}`,
                    background:
                      confirmAction === 'kill'
                        ? 'var(--danger, #dc322f)'
                        : 'var(--warning, #b58900)',
                    color: 'var(--bg-card)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const action = confirmAction;
                    setConfirmAction(null);
                    sendSwarmSignal(projectRoot, action)
                      .then((r) => {
                        if (!r.ok) setSignalError(`${action} failed: ${r.message}`);
                      })
                      .catch((err: Error) => setSignalError(`${action} failed: ${err.message}`));
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-secondary)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmAction(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {signalError && (
              <span
                style={{ fontSize: '11px', color: 'var(--danger, #dc322f)', marginLeft: '8px' }}
              >
                {signalError}
              </span>
            )}
          </div>
          <div className="swarm-info-btn-wrap ui-inline-row">
            <button type="button" className="swarm-info-btn ui-muted" aria-label="Project stats">
              ⓘ
            </button>
            <div className="swarm-info-tooltip ui-card">
              <span>
                {runtimeTotalWorkers} workers · {allWorkers.length} sessions ({workCount} exec,{' '}
                {reviewCount} review, {fixCount} fix)
              </span>
              {earliestCreated && <span>Started {formatTimeAgo(earliestCreated)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="swarm-tabs">
        <button
          type="button"
          className={`swarm-tab ui-muted ${activeTab === 'workers' ? 'active' : ''}`}
          onClick={() => setActiveTab('workers')}
        >
          Workers ({allWorkers.length})
        </button>
        <button
          type="button"
          className={`swarm-tab ui-muted ${activeTab === 'runs' ? 'active' : ''}`}
          onClick={() => setActiveTab('runs')}
        >
          Run Overview
        </button>
      </div>

      {/* Workers tab: roster (exec groups with nested reviews) + parallel panes */}
      {activeTab === 'workers' && (
        <div className="swarm-detail-body">
          {/* Worker Roster sidebar — exec workers with reviews nested below */}
          <div className="swarm-roster ui-stack">
            <div className="swarm-roster-list">
              {execGroups.map((group, groupIdx) => {
                const w = group.exec;
                const isSelected = groupIdx === selectedGroupIdx;
                const model = shortModelName(null);
                const isRunning = isWorkerRunningLive(w);
                const statusClass = isRunning ? 'running' : 'idle';
                // Aggregate verdict from most recent review
                const latestVerdict =
                  group.reviews.length > 0 && rowWorker(group.reviews[0])?.role === 'review'
                    ? extractVerdict(group.reviews[0])
                    : null;
                return (
                  <div
                    key={w.id}
                    className={`roster-exec-group ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedGroupIdx(groupIdx)}
                  >
                    <div className={`roster-worker ui-row ${isSelected ? 'selected' : ''}`}>
                      <span className={`roster-status-dot ${statusClass}`} />
                      <span className="roster-worker-id ui-truncate">
                        {rowWorker(w)?.workerId ?? w.id.substring(0, 8)}
                      </span>
                      {model && <span className="roster-model ui-muted">{model}</span>}
                      <span className="roster-worker-msgs ui-muted">{w.messageCount}m</span>
                      {group.reviews.length > 0 && (
                        <span className="roster-review-count">{group.reviews.length}r</span>
                      )}
                      {latestVerdict && (
                        <span
                          className={`verdict-pip verdict-${latestVerdict}`}
                          title={latestVerdict}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="roster-stats ui-stack ui-muted">
              <div className="roster-stat-row">
                <span>Running</span>
                <span className="roster-stat-value">{displayRunning}</span>
              </div>
              <div className="roster-stat-row">
                <span>Idle</span>
                <span className="roster-stat-value">{displayIdle}</span>
              </div>
              {earliestCreated && (
                <div className="roster-stat-row">
                  <span>Duration</span>
                  <span className="roster-stat-value">{formatTimeAgo(earliestCreated)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Task log (left) + Review (right) panes for selected worker */}
          <div className="swarm-panes">
            <WorkerChatPane
              conversationId={taskPaneId}
              accentColor="cyan"
              runningState={taskPaneRunning ? 'running' : 'idle'}
            />
            <WorkerChatPane
              conversationId={reviewPaneId}
              accentColor="magenta"
              runningState={reviewPaneRunning ? 'running' : 'idle'}
            />
          </div>
        </div>
      )}

      {/* Runs tab: structured run history with reviews and metrics */}
      {activeTab === 'runs' && (
        <div className="swarm-runs-body">
          <SwarmRunsPanel
            projectRoot={projectRoot}
            selectedRunId={selectedRunId}
            onSelectRunId={setSelectedRunId}
          />
        </div>
      )}

      {/* Bottom panels: git log + config */}
      <div className="swarm-bottom-panels">
        <GitLogPanel projectRoot={projectRoot} />
        <OompaConfigPanel projectRoot={projectRoot} />
      </div>
    </div>
  );
}
