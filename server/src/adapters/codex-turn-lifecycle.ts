export type CodexTurnStatus = 'running' | 'completed' | 'aborted';
export type CodexTurnTerminalCause = 'completed' | 'interrupted' | 'restart' | 'error' | 'unknown';

export interface CodexTurnLifecycle {
  turnId: string;
  status: CodexTurnStatus;
  startedAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date;
  durationMs: number | null;
  terminalCause: CodexTurnTerminalCause | null;
  terminalReason: string | null;
}

export interface CodexLifecycleSnapshot {
  turns: CodexTurnLifecycle[];
  latestTurn: CodexTurnLifecycle | null;
  activeTurn: CodexTurnLifecycle | null;
}

export interface CodexTurnInterruptionNotice {
  turnId: string;
  timestamp: Date;
  content: string;
}

interface MutableTurn extends CodexTurnLifecycle {
  order: number;
}

/**
 * Projects native Codex lifecycle rows into stable turn state.
 *
 * Payload epoch fields are authoritative. The JSONL entry timestamp is used as
 * a fallback and as best-effort activity for rows emitted between lifecycle
 * boundaries.
 */
export function extractCodexTurnLifecycle(entries: readonly unknown[]): CodexLifecycleSnapshot {
  const turns = new Map<string, MutableTurn>();
  let activeTurnId: string | null = null;
  let order = 0;

  for (const candidate of entries) {
    const entry = asRecord(candidate);
    if (!entry) continue;
    const payload = asRecord(entry.payload);
    const entryAt = parseInstant(entry.timestamp);
    if (!payload) {
      updateActiveTurnActivity(turns, activeTurnId, entryAt);
      continue;
    }
    const eventType = typeof payload?.type === 'string' ? payload.type : null;
    const turnId = typeof payload?.turn_id === 'string' ? payload.turn_id : null;

    if (eventType === 'task_started' && turnId) {
      const startedAt = parseEpoch(payload.started_at) ?? entryAt;
      if (!startedAt) continue;
      const existing = turns.get(turnId);
      turns.set(turnId, {
        turnId,
        status: existing?.status ?? 'running',
        startedAt,
        completedAt: existing?.completedAt ?? null,
        lastActivityAt: maxDate(existing?.lastActivityAt, entryAt, startedAt),
        durationMs: existing?.durationMs ?? null,
        terminalCause: existing?.terminalCause ?? null,
        terminalReason: existing?.terminalReason ?? null,
        order: existing?.order ?? order++,
      });
      if (!existing?.completedAt) activeTurnId = turnId;
      continue;
    }

    if ((eventType === 'task_complete' || eventType === 'turn_aborted') && turnId) {
      const completedAt = parseEpoch(payload.completed_at) ?? entryAt;
      const startedAt =
        parseEpoch(payload.started_at) ?? turns.get(turnId)?.startedAt ?? completedAt;
      if (!startedAt || !completedAt) continue;
      const explicitDuration = finiteNumber(payload.duration_ms);
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      const terminalCause =
        eventType === 'task_complete' ? 'completed' : classifyAbortReason(reason);
      const existing = turns.get(turnId);
      turns.set(turnId, {
        turnId,
        status: eventType === 'task_complete' ? 'completed' : 'aborted',
        startedAt,
        completedAt,
        lastActivityAt: maxDate(existing?.lastActivityAt, entryAt, completedAt),
        durationMs:
          explicitDuration !== null
            ? Math.max(0, explicitDuration)
            : Math.max(0, completedAt.getTime() - startedAt.getTime()),
        terminalCause,
        terminalReason: reason,
        order: existing?.order ?? order++,
      });
      if (activeTurnId === turnId) activeTurnId = null;
      continue;
    }

    updateActiveTurnActivity(turns, activeTurnId, entryAt);
  }

  const projected = Array.from(turns.values())
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...turn }) => turn);
  const latestTurn = projected.at(-1) ?? null;
  // Reverse scan rather than copy-and-reverse; this runs on every projection.
  let activeTurn: (typeof projected)[number] | null = null;
  for (let i = projected.length - 1; i >= 0 && activeTurn === null; i--) {
    if (projected[i].status === 'running') activeTurn = projected[i];
  }
  return { turns: projected, latestTurn, activeTurn };
}

export function classifyAbortReason(reason: string | null): CodexTurnTerminalCause {
  if (!reason) return 'unknown';
  const normalized = reason.toLowerCase();
  if (/restart|shutdown|hot.?reload|server.?stop/.test(normalized)) return 'restart';
  if (/error|fail|panic|crash/.test(normalized)) return 'error';
  if (/interrupt|cancel|kill|abort|stop/.test(normalized)) return 'interrupted';
  return 'unknown';
}

/**
 * Converts unterminated turns after a confirmed process/server restart into an
 * observable terminal state. Callers decide when recovery is authoritative;
 * extraction alone never guesses that an open native session is dead.
 */
export function recoverOpenCodexTurns(
  snapshot: CodexLifecycleSnapshot,
  recoveredAt: Date,
  reason = 'server restart'
): CodexLifecycleSnapshot {
  const completedAt = new Date(recoveredAt);
  const turns = snapshot.turns.map((turn): CodexTurnLifecycle => {
    if (turn.status !== 'running') return turn;
    return {
      ...turn,
      status: 'aborted',
      completedAt,
      durationMs: Math.max(0, completedAt.getTime() - turn.startedAt.getTime()),
      terminalCause: 'restart',
      terminalReason: reason,
    };
  });
  return {
    turns,
    latestTurn: turns.at(-1) ?? null,
    activeTurn: null,
  };
}

/**
 * Produces visible history markers only for explicit native turn_aborted rows.
 * Open task_started rows are intentionally excluded because an external Codex
 * process may still be running when the disk adapter reads the file.
 */
export function codexTurnInterruptionNotices(
  snapshot: CodexLifecycleSnapshot
): CodexTurnInterruptionNotice[] {
  return snapshot.turns
    .filter(
      (turn): turn is CodexTurnLifecycle & { status: 'aborted'; completedAt: Date } =>
        turn.status === 'aborted' && turn.completedAt !== null
    )
    .map((turn) => ({
      turnId: turn.turnId,
      timestamp: turn.completedAt,
      content: interruptionMessage(turn),
    }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseEpoch(value: unknown): Date | null {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function maxDate(...values: Array<Date | null | undefined>): Date {
  const present = values.filter((value): value is Date => value instanceof Date);
  return new Date(Math.max(...present.map((value) => value.getTime())));
}

function updateActiveTurnActivity(
  turns: Map<string, MutableTurn>,
  activeTurnId: string | null,
  entryAt: Date | null
): void {
  if (!activeTurnId || !entryAt) return;
  const active = turns.get(activeTurnId);
  if (active && entryAt >= active.startedAt) {
    active.lastActivityAt = maxDate(active.lastActivityAt, entryAt);
  }
}

function interruptionMessage(turn: CodexTurnLifecycle): string {
  const reason = turn.terminalReason?.trim();
  if (turn.terminalCause === 'restart') {
    return reason && reason !== 'server restart'
      ? `Turn interrupted by restart: ${reason}`
      : 'Turn interrupted by server restart.';
  }
  if (turn.terminalCause === 'error') {
    return reason ? `Turn failed: ${reason}` : 'Turn failed.';
  }
  if (turn.terminalCause === 'interrupted') {
    return reason && reason !== 'interrupted' ? `Turn interrupted: ${reason}` : 'Turn interrupted.';
  }
  return reason ? `Turn aborted: ${reason}` : 'Turn aborted.';
}
