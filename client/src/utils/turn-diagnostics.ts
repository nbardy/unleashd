export type TurnStatusKind =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'aborted';
export type TurnTerminalCause =
  | 'completed'
  | 'interrupted'
  | 'restart'
  | 'error'
  | 'unknown'
  | null;

export interface TurnDiagnosticsInput {
  status: TurnStatusKind;
  startedAt?: Date | string | number | null;
  completedAt?: Date | string | number | null;
  lastActivityAt?: Date | string | number | null;
  durationMs?: number | null;
  terminalCause?: TurnTerminalCause;
  reason?: string | null;
  activity?: TurnActivityDiagnostics | null;
}

export type TurnActivityKind =
  | 'runtime'
  | 'visible_output'
  | 'native_progress'
  | 'bridge_heartbeat'
  | 'provider_event'
  | 'legacy_unknown';

export interface TurnActivityDiagnostics {
  kind: TurnActivityKind;
  providerEventType: string;
  providerEventSource?: string;
  unifiedEventSilentSeconds?: number;
  rawStdoutSilentSeconds?: number;
  nativeSessionAvailable?: boolean;
  nativeSessionAdvanced?: boolean;
  nativeSessionSilentSeconds?: number;
  phase?: 'startup' | 'running';
}

export interface TurnDiagnosticsViewModel {
  tone: 'neutral' | 'active' | 'success' | 'warning' | 'danger';
  label: string;
  duration: string | null;
  lastActivity: string | null;
  reason: string | null;
  title: string;
}

export interface TurnAttemptSnapshotLike {
  state:
    | 'queued'
    | 'starting'
    | 'running'
    | 'stopping'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  terminalCause?:
    | 'provider_complete'
    | 'provider_error'
    | 'out_of_tokens'
    | 'user_stop'
    | 'process_killed'
    | 'process_exit'
    | 'spawn_failed'
    | 'idle_timeout'
    | 'bridge_timeout'
    | 'provider_idle_timeout'
    | 'max_runtime_timeout'
    | 'timeout'
    | 'server_restart'
    | 'unknown';
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
  lastActivityAt?: Date | string | number;
  lastActivity?: {
    source:
      | 'runtime'
      | 'provider_event'
      | 'provider_native_activity'
      | 'native_session'
      | 'agent_cli_heartbeat'
      | 'legacy_unknown';
    providerEventType: string;
    providerEventSource?: string;
    heartbeat?: {
      unifiedEventSilentSeconds?: number;
      rawStdoutSilentSeconds?: number;
      nativeSessionAvailable?: boolean;
      nativeSessionAdvanced?: boolean;
      nativeSessionSilentSeconds?: number;
      phase?: 'startup' | 'running';
    };
  };
  startedAt?: Date | string | number;
  terminalAt?: Date | string | number;
}

export function turnDiagnosticsFromAttempt(attempt: TurnAttemptSnapshotLike): TurnDiagnosticsInput {
  const terminalCause = attempt.terminalCause;
  const activity = projectAttemptActivity(attempt.lastActivity);
  const status: TurnStatusKind =
    attempt.state === 'queued' ||
    attempt.state === 'starting' ||
    attempt.state === 'running' ||
    attempt.state === 'stopping'
      ? attempt.state
      : attempt.state === 'succeeded'
        ? 'completed'
        : 'aborted';
  return {
    status,
    startedAt: attempt.startedAt ?? attempt.createdAt,
    completedAt: attempt.terminalAt,
    // Lifecycle timestamps are not provider activity. In particular, falling
    // back to startedAt makes a turn with zero bridge events look active.
    lastActivityAt: activity ? attempt.lastActivityAt : undefined,
    activity,
    terminalCause:
      status === 'completed'
        ? 'completed'
        : terminalCause === 'server_restart'
          ? 'restart'
          : attempt.state === 'failed' ||
              terminalCause === 'provider_error' ||
              terminalCause === 'out_of_tokens' ||
              terminalCause === 'spawn_failed' ||
              terminalCause === 'process_exit' ||
              terminalCause === 'idle_timeout' ||
              terminalCause === 'bridge_timeout' ||
              terminalCause === 'provider_idle_timeout' ||
              terminalCause === 'max_runtime_timeout' ||
              terminalCause === 'timeout'
            ? 'error'
            : status === 'aborted'
              ? 'interrupted'
              : null,
    reason: terminalCause ? TERMINAL_CAUSE_LABELS[terminalCause] : null,
  };
}

const TERMINAL_CAUSE_LABELS: Record<
  NonNullable<TurnAttemptSnapshotLike['terminalCause']>,
  string
> = {
  provider_complete: 'Provider completed',
  provider_error: 'Provider error',
  out_of_tokens: 'Out of tokens',
  user_stop: 'Stopped by user',
  process_killed: 'Provider process killed',
  process_exit: 'Provider process exited',
  spawn_failed: 'Provider failed to start',
  idle_timeout: 'Idle watchdog: no bridge activity',
  bridge_timeout: 'Turn event bridge stalled',
  provider_idle_timeout: 'Provider made no observable progress',
  max_runtime_timeout: 'Maximum turn runtime reached',
  timeout: 'Legacy timeout (watchdog type unavailable)',
  server_restart: 'Server restarted',
  unknown: 'Unknown terminal cause',
};

export function buildTurnDiagnosticsViewModel(
  input: TurnDiagnosticsInput,
  now = Date.now()
): TurnDiagnosticsViewModel {
  const startedAt = timestamp(input.startedAt);
  const completedAt = timestamp(input.completedAt);
  const lastActivityAt = timestamp(input.lastActivityAt);
  const durationEnd = completedAt ?? (isActiveTurnStatus(input.status) ? now : null);
  const measuredDuration =
    finiteDuration(input.durationMs) ??
    (startedAt === null || durationEnd === null ? null : Math.max(0, durationEnd - startedAt));
  const duration = measuredDuration === null ? null : formatCompactDuration(measuredDuration);
  const lastActivity = formatActivity(input.activity, lastActivityAt, now);
  const reason = input.reason?.trim() || null;

  switch (input.status) {
    case 'queued':
      return viewModel('neutral', 'Queued', duration, lastActivity, reason);
    case 'starting':
      return viewModel('active', 'Starting', duration, lastActivity, reason);
    case 'running':
      if (input.activity?.kind === 'bridge_heartbeat' && input.activity.phase === 'startup') {
        return viewModel('warning', 'Waiting for provider output', duration, lastActivity, reason);
      }
      if (input.activity?.kind === 'native_progress') {
        return viewModel('active', 'Working', duration, lastActivity, reason);
      }
      return viewModel('active', 'Running', duration, lastActivity, reason);
    case 'stopping':
      return viewModel('warning', 'Stopping', duration, lastActivity, reason);
    case 'completed':
      return viewModel('success', 'Completed', duration, lastActivity, reason);
    case 'aborted':
      if (input.terminalCause === 'restart') {
        return viewModel('warning', 'Interrupted by restart', duration, lastActivity, reason);
      }
      if (input.terminalCause === 'error') {
        return viewModel('danger', 'Failed', duration, lastActivity, reason);
      }
      return viewModel('warning', 'Interrupted', duration, lastActivity, reason);
    case 'idle':
      return viewModel('neutral', 'Idle', duration, lastActivity, reason);
  }
}

export function shouldShowTypingIndicator(isStreaming: boolean, streamingText: string): boolean {
  return isStreaming && streamingText.length > 0;
}

function projectAttemptActivity(
  activity: TurnAttemptSnapshotLike['lastActivity']
): TurnActivityDiagnostics | null {
  if (!activity) return null;
  const heartbeat = activity.heartbeat;
  const nativeProgress =
    activity.source === 'provider_native_activity' ||
    activity.source === 'native_session' ||
    heartbeat?.nativeSessionAdvanced === true ||
    activity.providerEventSource === 'codex.native_session';
  const kind: TurnActivityKind = nativeProgress
    ? 'native_progress'
    : activity.source === 'runtime'
      ? 'runtime'
      : activity.source === 'agent_cli_heartbeat'
        ? 'bridge_heartbeat'
        : activity.source === 'legacy_unknown'
          ? 'legacy_unknown'
          : activity.providerEventType === 'text.delta' || activity.providerEventType === 'tool.use'
            ? 'visible_output'
            : 'provider_event';
  return {
    kind,
    providerEventType: activity.providerEventType,
    ...(activity.providerEventSource ? { providerEventSource: activity.providerEventSource } : {}),
    ...(heartbeat?.unifiedEventSilentSeconds !== undefined
      ? { unifiedEventSilentSeconds: heartbeat.unifiedEventSilentSeconds }
      : {}),
    ...(heartbeat?.rawStdoutSilentSeconds !== undefined
      ? { rawStdoutSilentSeconds: heartbeat.rawStdoutSilentSeconds }
      : {}),
    ...(heartbeat?.nativeSessionAvailable !== undefined
      ? { nativeSessionAvailable: heartbeat.nativeSessionAvailable }
      : {}),
    ...(heartbeat?.nativeSessionAdvanced !== undefined
      ? { nativeSessionAdvanced: heartbeat.nativeSessionAdvanced }
      : {}),
    ...(heartbeat?.nativeSessionSilentSeconds !== undefined
      ? { nativeSessionSilentSeconds: heartbeat.nativeSessionSilentSeconds }
      : {}),
    ...(heartbeat?.phase ? { phase: heartbeat.phase } : {}),
  };
}

function formatActivity(
  activity: TurnActivityDiagnostics | null | undefined,
  lastActivityAt: number | null,
  now: number
): string | null {
  if (!activity || lastActivityAt === null) return null;
  const age = formatRelativeAge(lastActivityAt, now);
  switch (activity.kind) {
    case 'runtime':
      return `Runtime ${activity.providerEventType.replace('execution.', '')} ${age}`;
    case 'visible_output':
      return `Provider output ${age}`;
    case 'native_progress':
      return appendOutputSilence(`Native Codex progress ${age}`, activity.rawStdoutSilentSeconds);
    case 'bridge_heartbeat': {
      const silentFor = formatSilenceDuration(activity.rawStdoutSilentSeconds);
      return silentFor
        ? `Bridge heartbeat ${age} · provider output silent ${silentFor}`
        : `Bridge heartbeat ${age}`;
    }
    case 'provider_event':
      return `Provider event ${age}`;
    case 'legacy_unknown':
      return `Legacy activity ${age}`;
  }
}

function appendOutputSilence(label: string, seconds: number | undefined): string {
  const silentFor = formatSilenceDuration(seconds);
  return silentFor ? `${label} · UI output silent ${silentFor}` : label;
}

function formatSilenceDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  return formatCompactDuration(seconds * 1_000);
}

export function isActiveTurnStatus(status: TurnStatusKind): boolean {
  return (
    status === 'queued' || status === 'starting' || status === 'running' || status === 'stopping'
  );
}

export function isNonterminalAttemptState(state: TurnAttemptSnapshotLike['state']): boolean {
  return state === 'queued' || state === 'starting' || state === 'running' || state === 'stopping';
}

/**
 * Runtime state is newer than a previously fetched terminal snapshot. Hide
 * that stale terminal result until the diagnostics endpoint exposes the
 * current nonterminal attempt.
 */
export function shouldPresentTurnAttempt(
  attempt: TurnAttemptSnapshotLike,
  runtimeActive: boolean
): boolean {
  return !runtimeActive || isNonterminalAttemptState(attempt.state);
}

export function turnDiagnosticsPollDelay(
  runtimeActive: boolean,
  attemptState: TurnAttemptSnapshotLike['state'] | null,
  consecutiveNotFound: number
): number {
  if (consecutiveNotFound > 0) {
    return Math.min(30_000, 1_000 * 2 ** Math.min(consecutiveNotFound - 1, 5));
  }
  return runtimeActive || (attemptState !== null && isNonterminalAttemptState(attemptState))
    ? 2_000
    : 30_000;
}

function viewModel(
  tone: TurnDiagnosticsViewModel['tone'],
  label: string,
  duration: string | null,
  lastActivity: string | null,
  reason: string | null
): TurnDiagnosticsViewModel {
  return {
    tone,
    label,
    duration,
    lastActivity,
    reason,
    title: [label, duration, lastActivity, reason].filter(Boolean).join(' · '),
  };
}

function timestamp(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteDuration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function formatCompactDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatRelativeAge(timestampMs: number, now = Date.now()): string {
  const seconds = Math.floor(Math.max(0, now - timestampMs) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
