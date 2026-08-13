import type { Conversation, OompaRuntimeWorker, SwarmRunSummary } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createConversation } from '../../atoms/actions';
import { conversationAtomFamily, workersByProjectAtom } from '../../atoms/conversations';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { promotedWorkersAtom } from '../../atoms/ui';
import { getProjectRoot } from '../../utils/swarmUtils';
import { getWorkerVisibilitySummary } from '../../utils/swarmWorkerVisibility';
import { formatTimeAgo, getLastMessageTime } from '../../utils/time';

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

function extractVerdict(conv: Conversation): 'approved' | 'needs-changes' | 'rejected' | 'pending' {
  for (const msg of conv.messages) {
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
  startedAt: string | null,
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
      `- Errors: ${totalErr}`,
    );
    if (summary.workers.length > 0) {
      lines.push(
        '',
        '## Worker Status',
        'Worker | Harness | Status | Done | Merges | Rej | Err | Reviews',
        '-------|---------|--------|------|--------|-----|-----|--------',
      );
      for (const w of summary.workers) {
        lines.push(
          `${w.id} | ${w.harness}:${w.model ?? 'default'} | ${w.status} | ${w.completed}/${w.iterations} | ${w.merges} | ${w.rejections} | ${w.errors} | ${w['review-rounds-total']}`,
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
    'Given this context, help the user debug and investigate the swarm run.',
  );
  return lines.join('\n');
}

async function sendSwarmSignal(
  projectRoot: string,
  signal: 'stop' | 'kill',
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
  exec: Conversation;
  reviews: Conversation[];
}

function WorkerRow({
  conversationId,
  onOpen,
}: {
  conversationId: string;
  onOpen: (id: string) => void;
}) {
  const conv = useAtomValue(conversationAtomFamily(conversationId));
  if (!conv) return null;
  const model = shortModelName(conv.modelName);
  const running = conv.isRunning;
  return (
    <button type="button" className="mobile-worker-row" onClick={() => onOpen(conv.id)}>
      <span className={`mobile-worker-row__dot ${running ? 'running' : 'idle'}`} aria-hidden />
      <span className="mobile-worker-row__id">{conv.workerId ?? conv.id.slice(0, 8)}</span>
      {model && <span className="mobile-worker-row__model">{model}</span>}
      <span className="mobile-worker-row__msgs">{conv.messages.length}m</span>
      {conv.workerRole !== 'work' && conv.workerRole && (
        <span className={`mobile-worker-row__role role-${conv.workerRole}`}>{conv.workerRole}</span>
      )}
      <span className={`mobile-worker-row__state ${running ? 'state-running' : 'state-idle'}`}>
        {running ? 'Running' : 'Idle'}
      </span>
    </button>
  );
}

export function SwarmDetailMobile() {
  const [searchParams] = useSearchParams();
  const projectRoot = searchParams.get('project') ?? '';
  const navigate = useNavigate();

  const rawWorkersByProject = useAtomValue(workersByProjectAtom);
  const promotedWorkers = useAtomValue(promotedWorkersAtom);
  const promotedSet = useMemo(() => new Set(promotedWorkers), [promotedWorkers]);

  // Runtime snapshot polled via usePolledFetch (10s, visibility-aware)
  const { data: runtimeData } = usePolledFetch<{ snapshot: import('@unleashd/shared').OompaRuntimeSnapshot } | import('@unleashd/shared').OompaRuntimeSnapshot>(
    projectRoot ? `/api/swarm-runtime?dir=${encodeURIComponent(projectRoot)}` : null,
    10_000,
    !!projectRoot,
  );
  const runtimeSnapshot = useMemo(() => {
    if (!runtimeData) return null;
    if ('snapshot' in (runtimeData as Record<string, unknown>)) return (runtimeData as { snapshot: import('@unleashd/shared').OompaRuntimeSnapshot }).snapshot;
    return runtimeData as import('@unleashd/shared').OompaRuntimeSnapshot;
  }, [runtimeData]);

  const runtimeWorkerStates = useMemo(() => {
    const map = new Map<string, OompaRuntimeWorker>();
    if (!runtimeSnapshot?.available || !runtimeSnapshot.run) return map;
    for (const w of runtimeSnapshot.run.workers) map.set(w.id, w);
    return map;
  }, [runtimeSnapshot]);

  const isWorkerRunningLive = useCallback(
    (w: Conversation): boolean => {
      const key = w.workerId ?? w.id;
      const state = runtimeWorkerStates.get(key);
      if (!state) return w.isRunning;
      return state.status === 'running' || state.status === 'starting';
    },
    [runtimeWorkerStates],
  );

  // 30s time-ago tick (PLANNING §7 #8)
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [confirmAction, setConfirmAction] = useState<'stop' | 'kill' | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);

  const handleOpenChat = useCallback((id: string) => navigate(`/chat/${id}`), [navigate]);

  const handleStartDebugConversation = useCallback(async () => {
    const swarmId = runtimeSnapshot?.available ? (runtimeSnapshot.run?.swarmId ?? runtimeSnapshot.run?.runId ?? null) : null;
    const configPath = runtimeSnapshot?.available ? (runtimeSnapshot.run?.configPath ?? null) : null;
    let summary: SwarmRunSummary | null = null;
    let startedAt: string | null = null;
    try {
      const res = await fetch(`/api/swarm-runs?dir=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data: { runs: { swarmId: string; summary: SwarmRunSummary; run: { 'started-at': string } | null }[] } = await res.json();
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
    });
    navigate(`/chat/${id}`);
  }, [projectRoot, runtimeSnapshot, navigate]);

  // Build exec groups — stacked single-pane (no side-by-side)
  const { execGroups, allWorkers } = useMemo(() => {
    const execs: Conversation[] = [];
    const reviewsAndFixes: Conversation[] = [];
    for (const workers of rawWorkersByProject.values()) {
      for (const conv of workers) {
        if (promotedSet.has(conv.id)) continue;
        if (getProjectRoot(conv.workingDirectory) !== projectRoot) continue;
        if (conv.workerRole === 'review' || conv.workerRole === 'fix') reviewsAndFixes.push(conv);
        else execs.push(conv);
      }
    }
    const sortByActivity = (a: Conversation, b: Conversation) => {
      const aRun = isWorkerRunningLive(a);
      const bRun = isWorkerRunningLive(b);
      if (aRun && !bRun) return -1;
      if (!aRun && bRun) return 1;
      const aTime = getLastMessageTime(a.messages)?.getTime() ?? 0;
      const bTime = getLastMessageTime(b.messages)?.getTime() ?? 0;
      return bTime - aTime;
    };
    execs.sort(sortByActivity);
    const groups: ExecGroup[] = execs.map((exec) => ({ exec, reviews: [] }));
    for (const rf of reviewsAndFixes) {
      const rfCreated = new Date(rf.createdAt).getTime();
      let best: ExecGroup | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const g of groups) {
        if (g.exec.swarmId !== rf.swarmId) continue;
        const execTime = getLastMessageTime(g.exec.messages)?.getTime() ?? new Date(g.exec.createdAt).getTime();
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
  }, [rawWorkersByProject, promotedSet, projectRoot, isWorkerRunningLive]);

  const workerVisibility = useMemo(
    () => getWorkerVisibilitySummary(allWorkers, runtimeSnapshot, isWorkerRunningLive),
    [allWorkers, runtimeSnapshot, isWorkerRunningLive],
  );

  if (!projectRoot) {
    return (
      <div className="mobile-swarm-detail">
        <button type="button" className="mobile-back-btn" onClick={() => navigate('/workers')}>
          ← Swarms
        </button>
        <div className="mobile-swarm-detail__empty">No project selected.</div>
      </div>
    );
  }

  const displayPath = projectRoot.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div className="mobile-swarm-detail">
      <div className="mobile-swarm-detail__header">
        <button type="button" className="mobile-back-btn" onClick={() => navigate('/workers')}>
          ← Swarms
        </button>
        <h2 className="mobile-swarm-detail__title" title={projectRoot}>
          {displayPath}
        </h2>
        <div className={`mobile-swarm-detail__badge ${workerVisibility.runningWorkers > 0 ? 'badge-running' : 'badge-idle'}`}>
          {workerVisibility.runningWorkers > 0 ? `${workerVisibility.runningWorkers} running` : 'All idle'}
        </div>
      </div>

      <div className="mobile-swarm-detail__actions">
        <button type="button" className="mobile-swarm-detail__debug-btn" onClick={handleStartDebugConversation}>
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
          <div className="mobile-swarm-detail__confirm">
            <span>{confirmAction === 'stop' ? 'Stop swarm gracefully?' : 'Kill swarm immediately?'}</span>
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
            <button type="button" className="mobile-signal-btn signal-cancel" onClick={() => setConfirmAction(null)}>
              Cancel
            </button>
          </div>
        )}
        {signalError && <span className="mobile-swarm-detail__error">{signalError}</span>}
      </div>

      <div className="mobile-swarm-detail__meta">
        <span>
          {workerVisibility.totalWorkers} workers · {allWorkers.length} sessions
        </span>
        {allWorkers.length > 0 && <span> · longest {formatTimeAgo(new Date(Math.min(...allWorkers.map((w) => new Date(w.createdAt).getTime()))))}</span>}
      </div>

      {/* Stacked worker list — single-pane (no side-by-side), mobile-friendly */}
      <div className="mobile-swarm-detail__list">
        {execGroups.length === 0 ? (
          <div className="mobile-swarm-detail__empty">No workers for this project.</div>
        ) : (
          execGroups.map((group) => {
            const verdict =
              group.reviews.length > 0 && group.reviews[0].workerRole === 'review'
                ? extractVerdict(group.reviews[0])
                : null;
            const lastMsg = group.exec.messages[group.exec.messages.length - 1];
            const snippet = lastMsg ? lastMsg.content.slice(0, 140) : '— no messages —';
            return (
              <div key={group.exec.id} className="mobile-exec-group">
                <WorkerRow conversationId={group.exec.id} onOpen={handleOpenChat} />
                {verdict && verdict !== 'pending' && (
                  <span className={`mobile-exec-group__verdict verdict-${verdict}`}>{verdict}</span>
                )}
                <div className="mobile-exec-group__snippet">{snippet}</div>
                {group.reviews.length > 0 && (
                  <div className="mobile-exec-group__reviews">
                    <div className="mobile-exec-group__reviews-title">
                      {group.reviews.length} review{group.reviews.length !== 1 ? 's' : ''} paired
                    </div>
                    {group.reviews.map((r) => (
                      <WorkerRow key={r.id} conversationId={r.id} onOpen={handleOpenChat} />
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
