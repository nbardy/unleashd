import { type UnifiedAgentEvent, getHarness } from '@nbardy/agent-cli';
import type { Provider } from '@unleashd/shared';
import type { TurnWatchdog } from './watchdog';

type ToolUseEvent = Extract<UnifiedAgentEvent, { type: 'tool.use' }>;
type TaskStartedEvent = Extract<UnifiedAgentEvent, { type: 'task.started' }>;
type TaskFinishedEvent = Extract<UnifiedAgentEvent, { type: 'task.finished' }>;

/**
 * How long a harness may legitimately sit silent after its parent turn goes idle, because it is
 * waiting on background tasks it launched. `claude -p` waits for `run_in_background` agents and
 * shells up to CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS (agent-cli defaults it to 12 h, efe0503),
 * then stops them and exits by itself. The launching tool call widens the watchdog's idle
 * budget; without that, the 60-minute provider-idle watchdog killed every silent Claude wait
 * before agent-cli's 12-hour ceiling could matter
 * (agent_notes/2026-09-26_claude-p-background-agents-ceiling.md). agent-cli's `task.*` events
 * (Claude's task_started / task_notification) then narrow it back once the last background task
 * of the turn finishes, so a turn that hangs after its agents are done stalls on the normal
 * budget, not 13 hours later. Every other harness declares no such wait. Guards:
 * conversation-runtime.test.ts "a Claude turn waiting on a background agent outlives the
 * provider-idle limit" and "a recorded background agent finishing restores the idle limit".
 * One instance per turn: it holds that turn's running background tasks.
 */
export interface BackgroundWait {
  /** A tool call of this turn: tell the watchdog when it launched a background task. */
  toolUse(event: ToolUseEvent, watchdog: TurnWatchdog): void;
  taskStarted(event: TaskStartedEvent): void;
  /** When the last running background task finishes, the watchdog's normal budget returns. */
  taskFinished(event: TaskFinishedEvent, watchdog: TurnWatchdog): void;
}

const NO_WAIT: BackgroundWait = { toolUse() {}, taskStarted() {}, taskFinished() {} };

const CLAUDE_WAIT_ENV = 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS';

/**
 * The wait the spawned `claude` actually gets: the server's own environment wins, else the
 * harness default (agent-cli `commandSpawnEnv`). An unparseable value is an error, not a guess.
 */
function claudeDeclaredWaitMs(env: NodeJS.ProcessEnv): number {
  const raw = env[CLAUDE_WAIT_ENV] || getHarness('claude').envDefaults?.[CLAUDE_WAIT_ENV];
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms <= 0)
    throw new Error(`${CLAUDE_WAIT_ENV} must be a positive integer of milliseconds, got ${raw}`);
  return ms;
}

function claudeBackgroundWait(waitMs: number): BackgroundWait {
  const running = new Set<string>();
  return {
    toolUse(event, watchdog) {
      if (event.input.run_in_background === true) watchdog.allowBackgroundWait(waitMs);
    },
    taskStarted(event) {
      if (event.background) running.add(event.taskId);
    },
    taskFinished(event, watchdog) {
      if (running.delete(event.taskId) && running.size === 0) watchdog.endBackgroundWait();
    },
  };
}

const CLAUDE_WAIT_MS = claudeDeclaredWaitMs(process.env);

// Pattern: table-driven (docs/patterns.md#table-driven)
const BACKGROUND_WAITS: Record<Provider, () => BackgroundWait> = {
  claude: () => claudeBackgroundWait(CLAUDE_WAIT_MS),
  codex: () => NO_WAIT,
  gemini: () => NO_WAIT,
  opencode: () => NO_WAIT,
  cursor: () => NO_WAIT,
  muse: () => NO_WAIT,
};

/** A fresh wait for one turn of `provider`. */
export function backgroundWaitFor(provider: Provider): BackgroundWait {
  return BACKGROUND_WAITS[provider]();
}
