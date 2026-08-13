import type {
  Conversation,
  Message,
  OompaRuntimeWorker,
  SwarmReviewLog,
  SwarmRun,
  SwarmRunSummary,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createConversation } from '../atoms/actions';
import { conversationAtomFamily, workersByProjectAtom } from '../atoms/conversations';
import { markMessagesSeen, promotedWorkersAtom } from '../atoms/ui';
import { useSwarmRuntimeSnapshots } from '../hooks/useSwarmRuntimeSnapshots';
import { getProjectRoot } from '../utils/swarmUtils';
import { getWorkerVisibilitySummary } from '../utils/swarmWorkerVisibility';
import { formatTimeAgo, getLastMessageTime } from '../utils/time';
import { VirtualizedMessageList } from './VirtualizedMessageList';
import type { MessageGroup } from './VirtualizedMessageList';
import './SwarmDetail.css';

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
function extractVerdict(conv: Conversation): 'approved' | 'needs-changes' | 'rejected' | 'pending' {
  for (const msg of conv.messages) {
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
  exec: Conversation;
  reviews: Conversation[]; // review + fix sessions matched to this exec, newest first
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
  const conversation = useAtomValue(conversationAtomFamily(conversationId ?? ''));
  const isStreaming = conversation?.isStreaming ?? false;

  // ALL hooks before any early return (React hook ordering rule)
  const messageGroups = useMemo((): MessageGroup[] => {
    if (!conversation) return [];
    return conversation.messages.map((msg: Message) => ({
      type: 'single' as const,
      messages: [msg],
    }));
  }, [conversation]);

  const lastMessageRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const workingDirectory = conversation?.workingDirectory ?? '';

  if (!conversationId || !conversation) {
    return (
      <div className="worker-chat-pane empty">
        <div className="empty-state">No {label ? label.toLowerCase() : 'worker'} log</div>
      </div>
    );
  }

  const role = conversation.workerRole ?? 'work';
  const model = shortModelName(conversation.modelName);

  return (
    <div className="worker-chat-pane">
      <div className={`worker-pane-header pane-${accentColor}`}>
        {label && <span className={`pane-label ${accentColor}`}>{label}</span>}
        <span className="worker-pane-id">{conversationId.substring(0, 8)}</span>
        {role !== 'work' && <span className={`role-badge role-${role}`}>{ROLE_LABELS[role]}</span>}
        {model && (
          <span className={`worker-pane-provider provider-${conversation.provider || 'claude'}`}>
            {model}
          </span>
        )}
        <div className={`state-badge state-${runningState}`}>
          <div className="state-indicator" />
          <span className="state-label">{runningState === 'running' ? 'Running' : 'Idle'}</span>
        </div>
      </div>
      <div className="worker-pane-messages">
        <VirtualizedMessageList
          messageGroups={messageGroups}
          isRunning={isStreaming}
          lastMessageRef={lastMessageRef}
          onScrollStateChange={NO_OP_SCROLL}
          conversationId={conversationId}
          markMessagesSeen={markMessagesSeen}
          totalMessageCount={conversation.messages.length}
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
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    fetch(`/api/git-log?dir=${encodeURIComponent(projectRoot)}`)
      .then((res) => res.json())
      .then((data: GitLogEntry[]) => {
        setCommits(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectRoot]);

  return (
    <div className={`swarm-bottom-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="swarm-panel-header swarm-panel-toggle"
        onClick={() => setIsCollapsed((c) => !c)}
      >
        <span className="panel-toggle-icon">{isCollapsed ? '▶' : '▼'}</span>
        Recent Commits
      </button>
      {!isCollapsed && (
        <div className="swarm-panel-content">
          {loading && <div className="panel-loading">Loading commits...</div>}
          {!loading && commits.length === 0 && <div className="panel-empty">No commits found</div>}
          {commits.map((c) => (
            <div key={c.hash} className="git-log-entry">
              <code className="git-hash">{c.hash.substring(0, 7)}</code>
              <span className="git-message">{c.message}</span>
              <span className="git-author">{c.author}</span>
              <span className="git-date">{formatTimeAgo(new Date(c.date))}</span>
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
  const [config, setConfig] = useState<OompaConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPrompts, setExpandedPrompts] = useState<Map<string, string>>(new Map());
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    fetch(`/api/oompa-config?dir=${encodeURIComponent(projectRoot)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: OompaConfig) => setConfig(data))
      .catch((e: Error) => setError(e.message));
  }, [projectRoot]);

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
    <div className={`swarm-bottom-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="swarm-panel-header swarm-panel-toggle"
        onClick={() => setIsCollapsed((c) => !c)}
      >
        <span className="panel-toggle-icon">{isCollapsed ? '▶' : '▼'}</span>
        Swarm Config
      </button>
      {!isCollapsed && (
        <div className="swarm-panel-content">
          {error && <div className="panel-error">No oompa config found</div>}
          {!config && !error && <div className="panel-loading">Loading config...</div>}
          {config && (
            <div className="config-summary">
              {config.workers.map((w, i) => {
                const prompts = Array.isArray(w.prompt) ? w.prompt : w.prompt ? [w.prompt] : [];
                return (
                  <div key={i}>
                    <div className="config-worker-row">
                      <span className="config-model-badge">{w.model}</span>
                      <span className="config-count">
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
                <div className="config-worker-row">
                  <span className="config-model-badge">{config.reviewer.model}</span>
                  <span className="config-count">reviewer</span>
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
  const [runs, setRuns] = useState<SwarmRun[]>([]);
  const [reviews, setReviews] = useState<SwarmReviewLog[]>([]);
  const setSelectedRunId = onSelectRunId;
  const [expandedReview, setExpandedReview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newFilesCount, setNewFilesCount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/swarm-runs?dir=${encodeURIComponent(projectRoot)}`)
      .then((res) => res.json())
      .then((data: { runs: SwarmRun[] }) => {
        setRuns(data.runs);
        if (data.runs.length > 0 && !selectedRunId) {
          setSelectedRunId(data.runs[0].swarmId);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectRoot, selectedRunId, setSelectedRunId]);

  // Fetch reviews when a run is selected
  useEffect(() => {
    if (!selectedRunId) return;
    fetch(
      `/api/swarm-reviews?dir=${encodeURIComponent(projectRoot)}&swarmId=${encodeURIComponent(selectedRunId)}`
    )
      .then((res) => res.json())
      .then((data: { reviews: SwarmReviewLog[] }) => setReviews(data.reviews))
      .catch(() => setReviews([]));
  }, [projectRoot, selectedRunId]);

  // Fetch count of .json files added in merge commits during this run's time window
  useEffect(() => {
    if (!selectedRunId) return;
    setNewFilesCount(null);
    fetch(
      `/api/swarm-new-files?dir=${encodeURIComponent(projectRoot)}&swarmId=${encodeURIComponent(selectedRunId)}`
    )
      .then((res) => res.json())
      .then((data: { count: number }) => setNewFilesCount(data.count))
      .catch(() => setNewFilesCount(0));
  }, [projectRoot, selectedRunId]);

  if (loading) return <div className="empty-state">Loading run history...</div>;
  if (runs.length === 0) return <div className="empty-state">No runs recorded yet</div>;

  const selectedRun = runs.find((r) => r.swarmId === selectedRunId);
  const summary = selectedRun?.summary;
  const runLog = selectedRun?.run;

  return (
    <div className="swarm-runs-panel">
      {/* Run selector */}
      <div className="runs-selector">
        {runs.map((r) => (
          <button
            type="button"
            key={r.swarmId}
            className={`run-selector-btn ${r.swarmId === selectedRunId ? 'active' : ''}`}
            onClick={() => setSelectedRunId(r.swarmId)}
          >
            <span className="run-id">{r.swarmId}</span>
            {r.run && (
              <span className="run-time">{new Date(r.run['started-at']).toLocaleDateString()}</span>
            )}
            {r.summary && (
              <span
                className={`run-status-badge ${r.summary['total-completed'] > 0 ? 'has-completions' : ''}`}
              >
                {r.summary['total-completed']}/{r.summary['total-iterations']}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Selected run details */}
      {summary && (
        <div className="run-summary">
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
                <div className="run-stat run-stat-tasks">
                  <span className="run-stat-label">Tasks</span>
                  <div className="run-stat-tasks-breakdown">
                    <div className="task-row">
                      <span className="task-count task-pending">{runningCount}</span>
                      <span className="task-sublabel">Pending</span>
                    </div>
                    <div className="task-row">
                      <span className="task-count task-new">
                        {newFilesCount !== null ? newFilesCount : '…'}
                      </span>
                      <span className="task-sublabel">New</span>
                    </div>
                    <div className="task-row">
                      <span className="task-count task-completed">{completed}</span>
                      <span className="task-sublabel">Completed</span>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="run-stat run-stat-cycles">
              <span className="run-stat-label">Cycles</span>
              <div className="run-stat-cycles-progress">
                <span className="cycles-done">{summary['total-completed']}</span>
                <span className="cycles-sep">/</span>
                <span className="cycles-total">{summary['total-iterations']}</span>
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
        <div className="run-reviews">
          <h4>Review Log ({reviews.length} reviews)</h4>
          <div className="run-reviews-list">
            {reviews.map((r, i) => {
              const key = `${r['worker-id']}-i${r.iteration}-r${r.round}`;
              const isExpanded = expandedReview === key;
              return (
                <div key={i} className="run-review-entry">
                  <div
                    className="run-review-header"
                    onClick={() => setExpandedReview(isExpanded ? null : key)}
                  >
                    <span className="run-review-worker">{r['worker-id']}</span>
                    <span className="run-review-iter">
                      c{r.iteration} r{r.round}
                    </span>
                    <span className={`verdict-badge verdict-${r.verdict}`}>
                      {r.verdict.toUpperCase().replace('-', ' ')}
                    </span>
                    <span className="run-review-files">{r['diff-files']?.length ?? 0} files</span>
                    <span className="run-review-time">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="expand-indicator">{isExpanded ? '\u25BC' : '\u25B6'}</span>
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

  // Subscribe to workersByProjectAtom — only re-renders when worker conversations
  // change, not on every structural event across all conversations.
  const rawWorkersByProject = useAtomValue(workersByProjectAtom);
  const promotedWorkers = useAtomValue(promotedWorkersAtom);
  const promotedSet = useMemo(() => new Set(promotedWorkers), [promotedWorkers]);
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
    (worker: Conversation): boolean => {
      const key = worker.workerId ?? worker.id;
      const state = runtimeWorkerStates.get(key);
      if (!state) return worker.isRunning;
      return state.status === 'running' || state.status === 'starting';
    },
    [runtimeWorkerStates]
  );

  // Tick every 30s for time-ago
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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
    });
    navigate(`/chat/${id}`);
  }, [projectRoot, effectiveRunId, runtimeSnapshot, navigate]);

  // Filter workers belonging to this project, build exec groups with paired reviews/fixes.
  // Reviews/fixes are matched to exec workers by time proximity within the same swarmId.
  // Uses workersByProjectAtom (pre-filtered to isWorker) so we skip non-worker conversations.
  const { execGroups, allWorkers, workCount, reviewCount, fixCount } = useMemo(() => {
    const execs: Conversation[] = [];
    const reviewsAndFixes: Conversation[] = [];

    for (const workers of rawWorkersByProject.values()) {
      for (const conv of workers) {
        if (promotedSet.has(conv.id)) continue;
        if (getProjectRoot(conv.workingDirectory) !== projectRoot) continue;
        if (effectiveRunId && conv.swarmId !== effectiveRunId) continue;

        if (conv.workerRole === 'review' || conv.workerRole === 'fix') {
          reviewsAndFixes.push(conv);
        } else {
          execs.push(conv);
        }
      }
    }

    // Sort execs: running first, then by most recent activity
    const sortByActivity = (a: Conversation, b: Conversation) => {
      const aRunning = isWorkerRunningLive(a);
      const bRunning = isWorkerRunningLive(b);
      if (aRunning && !bRunning) return -1;
      if (!aRunning && bRunning) return 1;
      const aTime = getLastMessageTime(a.messages)?.getTime() ?? 0;
      const bTime = getLastMessageTime(b.messages)?.getTime() ?? 0;
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
        if (g.exec.swarmId !== rf.swarmId) continue;
        const execTime =
          getLastMessageTime(g.exec.messages)?.getTime() ?? new Date(g.exec.createdAt).getTime();
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
      reviewCount: reviewsAndFixes.filter((r) => r.workerRole === 'review').length,
      fixCount: reviewsAndFixes.filter((r) => r.workerRole === 'fix').length,
    };
  }, [rawWorkersByProject, promotedSet, projectRoot, effectiveRunId, isWorkerRunningLive]);

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

  const displayPath = projectRoot.replace(/^\/Users\/[^/]+/, '~');

  if (!projectRoot) {
    return (
      <div className="swarm-detail">
        <div className="swarm-detail-header">
          <button
            type="button"
            className="back-to-gallery-btn"
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
      <div className="swarm-detail-header">
        <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/workers')}>
          &#8592; Swarm Projects Overview
        </button>
        <div className="swarm-detail-title-block">
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 500 }}>
            {displayPath}
          </h2>
        </div>
        <div className="swarm-detail-header-stats">
          <button
            type="button"
            className="swarm-debug-btn"
            onClick={handleStartDebugConversation}
            title="Start a debug conversation about this swarm"
          >
            Debug Conversation
          </button>
          <div className="swarm-run-controls">
            <div
              className={`state-badge swarm-header-badge state-${displayRunning > 0 ? 'running' : 'idle'}`}
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
          <div className="swarm-info-btn-wrap">
            <button type="button" className="swarm-info-btn" aria-label="Project stats">
              ⓘ
            </button>
            <div className="swarm-info-tooltip">
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
          className={`swarm-tab ${activeTab === 'workers' ? 'active' : ''}`}
          onClick={() => setActiveTab('workers')}
        >
          Workers ({allWorkers.length})
        </button>
        <button
          type="button"
          className={`swarm-tab ${activeTab === 'runs' ? 'active' : ''}`}
          onClick={() => setActiveTab('runs')}
        >
          Run Overview
        </button>
      </div>

      {/* Workers tab: roster (exec groups with nested reviews) + parallel panes */}
      {activeTab === 'workers' && (
        <div className="swarm-detail-body">
          {/* Worker Roster sidebar — exec workers with reviews nested below */}
          <div className="swarm-roster">
            <div className="swarm-roster-list">
              {execGroups.map((group, groupIdx) => {
                const w = group.exec;
                const isSelected = groupIdx === selectedGroupIdx;
                const model = shortModelName(w.modelName);
                const isRunning = isWorkerRunningLive(w);
                const statusClass = isRunning ? 'running' : 'idle';
                // Aggregate verdict from most recent review
                const latestVerdict =
                  group.reviews.length > 0 && group.reviews[0].workerRole === 'review'
                    ? extractVerdict(group.reviews[0])
                    : null;
                return (
                  <div
                    key={w.id}
                    className={`roster-exec-group ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedGroupIdx(groupIdx)}
                  >
                    <div className={`roster-worker ${isSelected ? 'selected' : ''}`}>
                      <span className={`roster-status-dot ${statusClass}`} />
                      <span className="roster-worker-id">{w.workerId ?? w.id.substring(0, 8)}</span>
                      {model && <span className="roster-model">{model}</span>}
                      <span className="roster-worker-msgs">{w.messages.length}m</span>
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
            <div className="roster-stats">
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
