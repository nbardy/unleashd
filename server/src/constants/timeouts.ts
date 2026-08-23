function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const EXTERNAL_GRACE_MS = 30_000;
export const LOCAL_COMPLETION_SUPPRESS_MS = EXTERNAL_GRACE_MS;
export const HOT_RELOAD_FORCE_EXIT_GRACE_MS = readPositiveIntEnv(
  'CWV_HOT_RELOAD_FORCE_EXIT_GRACE_MS',
  3_000
);
// Hard cap on the final state flush. Without it a journal flush that never
// settles leaves the process alive in `exiting`, refusing every request forever.
export const SHUTDOWN_FLUSH_GRACE_MS = readPositiveIntEnv('CWV_SHUTDOWN_FLUSH_GRACE_MS', 5_000);
// A provider process may legitimately spend a long time reasoning or waiting on a
// tool without emitting user-visible output. The shared agent CLI emits liveness
// heartbeats during those gaps; this watchdog is the fallback for a broken event
// bridge, not a normal turn-duration limit.
export const DEFAULT_TURN_BRIDGE_TIMEOUT_MS = 2 * 60_000;
export const TURN_BRIDGE_TIMEOUT_MS = readPositiveIntEnv(
  'CWV_TURN_BRIDGE_TIMEOUT_MS',
  DEFAULT_TURN_BRIDGE_TIMEOUT_MS
);
export const DEFAULT_TURN_PROVIDER_IDLE_TIMEOUT_MS = 60 * 60_000;
export const TURN_PROVIDER_IDLE_TIMEOUT_MS = readPositiveIntEnv(
  'CWV_TURN_PROVIDER_IDLE_TIMEOUT_MS',
  readPositiveIntEnv('CWV_TURN_IDLE_TIMEOUT_MS', DEFAULT_TURN_PROVIDER_IDLE_TIMEOUT_MS)
);
// Backwards-compatible exports for callers that have not yet adopted the
// bridge/provider distinction. The legacy idle timeout now means provider
// inactivity, never absence of the wrapper's synthetic heartbeat.
export const DEFAULT_TURN_IDLE_TIMEOUT_MS = DEFAULT_TURN_PROVIDER_IDLE_TIMEOUT_MS;
export const TURN_IDLE_TIMEOUT_MS = TURN_PROVIDER_IDLE_TIMEOUT_MS;
export const TURN_MAX_RUNTIME_MS = readPositiveIntEnv('CWV_TURN_MAX_RUNTIME_MS', 24 * 60 * 60_000);
export const TURN_TIMEOUT_KILL_GRACE_MS = readPositiveIntEnv(
  'CWV_TURN_TIMEOUT_KILL_GRACE_MS',
  5_000
);
export const SWARM_POLL_INTERVAL_MS = readPositiveIntEnv('CWV_SWARM_POLL_INTERVAL_MS', 2_000);
export const SWARM_POLL_THROTTLE_MS = readPositiveIntEnv('CWV_SWARM_POLL_THROTTLE_MS', 1_500);
export const SWARM_CONTEXT_COMMAND_TIMEOUT_MS = 8_000;
export const PALETTE_GENERATION_TIMEOUT_MS = 90_000;
export const USAGE_CACHE_TTL_MS = 60_000;
export const FILE_POLL_INTERVAL_MS = 5_000;
