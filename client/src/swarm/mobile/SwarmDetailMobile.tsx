import type { ConversationRow, OompaRuntimeWorker, SwarmRunSummary } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { createConversation, readConversationMessages } from '../../atoms/actions';
import { rowFamily } from '../../atoms/conversations';
import { useTimeTick } from '../../hooks/useTimeTick';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { isRowRunning, rowWorker } from '../../utils/conversation-row';
import { shortenHomePath } from '../../utils/directories';
import { formatTimeAgo } from '../../utils/time';
import { getWorkerVisibilitySummary } from '../swarmWorkerVisibility';
import { useSwarmRuntimeSnapshots } from '../useSwarmRuntimeSnapshots';
import './mobile-swarm.css';
import { NO_WORKERS, swarmWorkersByProjectAtom } from '../swarm-workers';

// =============================================================================
// Pure helpers — copied as pure logic from SwarmDetail (no component import).
// Rebuilt DOM is mobile-friendly (stacked single-pane, PLANNING §6).
// =============================================================================

function shortModelName(modelName: string | null | undefined): string | null {
  if (!modelName) return null;
  const claudeMatch = modelName.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (claudeMatch) return `${claudeMatch[1]}-${claudeMatch[2]}.${claudeMatch[3]}`;
  if (modelName.includes('codex') || modelName.includes('gpt')) {
    const parts = modelName.split('-');
    return parts.slice(0, 3).join('-');
  }
  return modelName.length > 20 ? modelName.substring(0, 20) : modelName;
}

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
  return 'pending';
}

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
  if (startedAt) lines.push(`- Started: ${new Date(startedAt).toLocaleString()}`);
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
    '- started.json — swarm config, worker definitions',
    '- cycles/<worker>-c<N>.json — per-cycle outcomes',
    '- reviews/<worker>-c<N>-r<round>.json — reviewer verdicts',
    '- stopped.json — final exit status',
    '',
    `To list run artifacts: ls ${runsDir}/`,
    '',
    'Given this context, help the user debug and investigate the swarm run.'
  );
  return lines.join('\n');
}

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

// ExecGroup — exec worker plus time-paired reviews/fixes (same swarmId, closest timestamp)
interface ExecGroup {
  exec: ConversationRow;
  reviews: ConversationRow[];
}

function WorkerRow({
  conversationId,
  routeState,
}: {
  conversationId: string;
  routeState: Record<string, unknown>;
}) {
  const conv = useAtomValue(rowFamily(conversationId));
  if (!conv) return null;
  const model = shortModelName(null);
  const running = isRowRunning(conv);
  return (
    <Link
      className="mobile-worker-row ui-card"
      to={`/chat/${encodeURIComponent(conv.id)}`}
      state={routeState}
    >
      <span className={`mobile-worker-row__dot ${running ? 'running' : 'idle'}`} aria-hidden />
      <span className="mobile-worker-row__id">
        {rowWorker(conv)?.workerId ?? conv.id.slice(0, 8)}
      </span>
      {model && <span className="mobile-worker-row__model">{model}</span>}
      <span className="mobile-worker-row__msgs">{conv.messageCount}m</span>
      {rowWorker(conv)?.role !== 'work' && rowWorker(conv)?.role && (
        <span className={`mobile-worker-row__role role-${rowWorker(conv)?.role}`}>
          {rowWorker(conv)?.role}
        </span>
      )}
      <span className={`mobile-worker-row__state ${running ? 'state-running' : 'state-idle'}`}>
        {running ? 'Running' : 'Idle'}
      </span>
    </Link>
  );
}

export function SwarmDetailMobile() {
  const [searchParams] = useSearchParams();
  const projectRoot = searchParams.get('project') ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const chatRouteState = useMemo(() => mobileConversationRouteState(location), [location]);

  const projectWorkers =
    useAtomValue(swarmWorkersByProjectAtom).get(projectRoot ?? '') ?? NO_WORKERS;

  // Runtime snapshot: the same hook and cache key desktop SwarmDetail uses, so
  // the two shells share one polled entry per project (10s, visibility-aware).
  const runtimeSnapshots = useSwarmRuntimeSnapshots(projectRoot ? [projectRoot] : []);
  const runtimeSnapshot = projectRoot ? (runtimeSnapshots[projectRoot] ?? null) : null;

  const runtimeWorkerStates = useMemo(() => {
    const map = new Map<string, OompaRuntimeWorker>();
    if (!runtimeSnapshot?.available || !runtimeSnapshot.run) return map;
    for (const w of runtimeSnapshot.run.workers) map.set(w.id, w);
    return map;
  }, [runtimeSnapshot]);

  const isWorkerRunningLive = useCallback(
    (w: ConversationRow): boolean => {
      const key = rowWorker(w)?.workerId ?? w.id;
      const state = runtimeWorkerStates.get(key);
      if (!state) return isRowRunning(w);
      return state.status === 'running' || state.status === 'starting';
    },
    [runtimeWorkerStates]
  );

  useTimeTick();

  const [confirmAction, setConfirmAction] = useState<'stop' | 'kill' | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);

  const handleStartDebugConversation = useCallback(async () => {
    const swarmId = runtimeSnapshot?.available
      ? (runtimeSnapshot.run?.swarmId ?? runtimeSnapshot.run?.runId ?? null)
      : null;
    const configPath = runtimeSnapshot?.available
      ? (runtimeSnapshot.run?.configPath ?? null)
      : null;
    let summary: SwarmRunSummary | null = null;
    let startedAt: string | null = null;
    try {
      const res = await fetch(`/api/swarm-runs?dir=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data: {
          runs: {
            swarmId: string;
            summary: SwarmRunSummary;
            run: { 'started-at': string } | null;
          }[];
        } = await res.json();
        const match = swarmId ? data.runs.find((r) => r.swarmId === swarmId) : data.runs[0];
        if (match) {
          summary = match.summary;
          startedAt = match.run?.['started-at'] ?? null;
        }
      }
    } catch {
      // non-critical
    }
    const prefix = buildSwarmDebugPrefix(projectRoot, configPath, swarmId, summary, startedAt);
    const id = createConversation({
      workingDirectory: projectRoot,
      config: { provider: 'claude', model: { mode: 'default' }, reasoning: { mode: 'default' } },
      swarmDebugPrefix: prefix,
      kind: { t: 'chat' },
    });
    navigate(`/chat/${id}`, { state: chatRouteState });
  }, [chatRouteState, projectRoot, runtimeSnapshot, navigate]);

  // Build exec groups — stacked single-pane (no side-by-side)
  const { execGroups, allWorkers } = useMemo(() => {
    const execs: ConversationRow[] = [];
    const reviewsAndFixes: ConversationRow[] = [];
    for (const conv of projectWorkers) {
      if (rowWorker(conv)?.role === 'review' || rowWorker(conv)?.role === 'fix')
        reviewsAndFixes.push(conv);
      else execs.push(conv);
    }
    const sortByActivity = (a: ConversationRow, b: ConversationRow) => {
      const aRun = isWorkerRunningLive(a);
      const bRun = isWorkerRunningLive(b);
      if (aRun && !bRun) return -1;
      if (!aRun && bRun) return 1;
      const aTime = a.activityAt;
      const bTime = b.activityAt;
      return bTime - aTime;
    };
    execs.sort(sortByActivity);
    const groups: ExecGroup[] = execs.map((exec) => ({ exec, reviews: [] }));
    for (const rf of reviewsAndFixes) {
      const rfCreated = new Date(rf.createdAt).getTime();
      let best: ExecGroup | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const g of groups) {
        if ((rowWorker(g.exec)?.swarmId ?? null) !== (rowWorker(rf)?.swarmId ?? null)) continue;
        const execTime = g.exec.activityAt;
        const delta = Math.abs(rfCreated - execTime);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = g;
        }
      }
      if (best) best.reviews.push(rf);
    }
    for (const g of groups) g.reviews.sort(sortByActivity);
    return { execGroups: groups, allWorkers: [...execs, ...reviewsAndFixes] };
  }, [projectWorkers, isWorkerRunningLive]);

  const workerVisibility = useMemo(
    () => getWorkerVisibilitySummary(allWorkers, runtimeSnapshot, isWorkerRunningLive),
    [allWorkers, runtimeSnapshot, isWorkerRunningLive]
  );

  if (!projectRoot) {
    return (
      <div className="mobile-swarm-detail ui-stack">
        <button
          type="button"
          className="mobile-back-btn ui-inline-row ui-card"
          onClick={() => navigate('/workers')}
        >
          ← Swarms
        </button>
        <div className="mobile-swarm-detail__empty ui-muted">No project selected.</div>
      </div>
    );
  }

  const displayPath = shortenHomePath(projectRoot);

  return (
    <div className="mobile-swarm-detail ui-stack">
      <div className="mobile-swarm-detail__header ui-stack">
        <button
          type="button"
          className="mobile-back-btn ui-inline-row ui-card"
          onClick={() => navigate('/workers')}
        >
          ← Swarms
        </button>
        <h2 className="mobile-swarm-detail__title" title={projectRoot}>
          {displayPath}
        </h2>
        <div
          className={`mobile-swarm-detail__badge ui-inline-row ui-card ui-muted ${workerVisibility.runningWorkers > 0 ? 'badge-running' : 'badge-idle'}`}
        >
          {workerVisibility.runningWorkers > 0
            ? `${workerVisibility.runningWorkers} running`
            : 'All idle'}
        </div>
      </div>

      <div className="mobile-swarm-detail__actions">
        <button
          type="button"
          className="mobile-swarm-detail__debug-btn"
          onClick={handleStartDebugConversation}
        >
          Debug Conversation
        </button>
        {workerVisibility.runningWorkers > 0 && confirmAction === null && (
          <div className="mobile-swarm-detail__signals">
            <button
              type="button"
              className="mobile-signal-btn signal-stop"
              onClick={() => {
                setSignalError(null);
                setConfirmAction('stop');
              }}
            >
              Stop
            </button>
            <button
              type="button"
              className="mobile-signal-btn signal-kill"
              onClick={() => {
                setSignalError(null);
                setConfirmAction('kill');
              }}
            >
              Kill
            </button>
          </div>
        )}
        {confirmAction !== null && (
          <div className="mobile-swarm-detail__confirm ui-row">
            <span>
              {confirmAction === 'stop' ? 'Stop swarm gracefully?' : 'Kill swarm immediately?'}
            </span>
            <button
              type="button"
              className="mobile-signal-btn signal-confirm"
              onClick={() => {
                const action = confirmAction;
                setConfirmAction(null);
                sendSwarmSignal(projectRoot, action)
                  .then((r) => {
                    if (!r.ok) setSignalError(`${action} failed: ${r.message}`);
                  })
                  .catch((e: Error) => setSignalError(`${action} failed: ${e.message}`));
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="mobile-signal-btn signal-cancel"
              onClick={() => setConfirmAction(null)}
            >
              Cancel
            </button>
          </div>
        )}
        {signalError && <span className="mobile-swarm-detail__error">{signalError}</span>}
      </div>

      <div className="mobile-swarm-detail__meta ui-muted">
        <span>
          {workerVisibility.totalWorkers} workers · {allWorkers.length} sessions
        </span>
        {allWorkers.length > 0 && (
          <span>
            {' '}
            · longest{' '}
            {formatTimeAgo(
              new Date(Math.min(...allWorkers.map((w) => new Date(w.createdAt).getTime())))
            )}
          </span>
        )}
      </div>

      {/* Stacked worker list — single-pane (no side-by-side), mobile-friendly */}
      <div className="mobile-swarm-detail__list">
        {execGroups.length === 0 ? (
          <div className="mobile-swarm-detail__empty ui-muted">No workers for this project.</div>
        ) : (
          execGroups.map((group) => {
            const verdict =
              group.reviews.length > 0 && rowWorker(group.reviews[0])?.role === 'review'
                ? extractVerdict(group.reviews[0])
                : null;
            const snippet = group.exec.messageCount > 0 ? group.exec.label : '— no messages —';
            return (
              <div key={group.exec.id} className="mobile-exec-group ui-stack ui-card">
                <WorkerRow conversationId={group.exec.id} routeState={chatRouteState} />
                {verdict && verdict !== 'pending' && (
                  <span
                    className={`mobile-exec-group__verdict ui-inline-row ui-card ui-muted verdict-${verdict}`}
                  >
                    {verdict}
                  </span>
                )}
                <div className="mobile-exec-group__snippet">{snippet}</div>
                {group.reviews.length > 0 && (
                  <div className="mobile-exec-group__reviews ui-stack">
                    <div className="mobile-exec-group__reviews-title ui-muted">
                      {group.reviews.length} review{group.reviews.length !== 1 ? 's' : ''} paired
                    </div>
                    {group.reviews.map((r) => (
                      <WorkerRow key={r.id} conversationId={r.id} routeState={chatRouteState} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
