import type { Message } from '@unleashd/shared';

export interface ShutdownConversation {
  id: string;
  messages: Message[];
  process: { kill(signal?: NodeJS.Signals | number): boolean } | null;
  hasActiveProcess(): boolean;
  stop(reason?: 'user_stop' | 'server_restart'): void;
}

export interface ShutdownPorts {
  conversations(): Iterable<ShutdownConversation>;
  activeSchedulerRuns(): number;
  pauseScheduler(): void;
  stopScheduler(): void;
  flushState(): void | Promise<void>;
  broadcastMessage(conversationId: string, content: string): void;
  exit(code?: number): void;
}

export interface ShutdownOptions {
  /** SIGINT/SIGTERM: how long already-interrupted work may take to release. */
  forceExitGraceMs: number;
  /** Dev reload: how long live provider turns may keep running before force-drain. */
  reloadDrainGraceMs: number;
  /** Hard cap on the final state flush. A hung flush must never strand `exiting`. */
  flushGraceMs: number;
}

const DRAIN_POLL_INTERVAL_MS = 500;

export type ShutdownState = 'starting' | 'idle' | 'reloading' | 'shutting_down' | 'exiting';

export interface ShutdownController {
  readonly state: ShutdownState;
  beginMutation(options?: { allowDuringStartup?: boolean }): (() => void) | null;
  completeStartup(): boolean;
  abortStartup(): void;
  handleReload(): void;
  handleStartupFailure(): void;
  handleSigint(): void;
  handleSigterm(): void;
  dispose(): void;
}

export function createShutdownController(
  options: ShutdownOptions,
  ports: ShutdownPorts
): ShutdownController {
  let drainInterval: NodeJS.Timeout | null = null;
  let forceExitTimeout: NodeJS.Timeout | null = null;
  let flushWatchdog: NodeJS.Timeout | null = null;
  let state: ShutdownState = 'starting';
  let startupPending = true;
  let activeMutations = 0;
  let schedulerPaused = false;
  let schedulerStopped = false;
  let exitPromise: Promise<void> | null = null;

  const activeRuns = () =>
    Array.from(ports.conversations()).filter((item) => item.hasActiveProcess());
  const activeWorkCount = () =>
    activeRuns().length + ports.activeSchedulerRuns() + activeMutations + (startupPending ? 1 : 0);
  const clearTimers = () => {
    if (drainInterval) clearInterval(drainInterval);
    if (forceExitTimeout) clearTimeout(forceExitTimeout);
    if (flushWatchdog) clearTimeout(flushWatchdog);
    drainInterval = null;
    forceExitTimeout = null;
    flushWatchdog = null;
  };
  const pauseScheduler = () => {
    if (schedulerPaused || schedulerStopped) return;
    schedulerPaused = true;
    ports.pauseScheduler();
  };
  const stopScheduler = () => {
    if (schedulerStopped) return;
    schedulerStopped = true;
    ports.stopScheduler();
  };
  const interrupt = (reason: string) => {
    for (const conversation of activeRuns()) {
      const content = `Server is restarting (${reason}); interrupted current turn.`;
      conversation.messages.push({ role: 'system', content, timestamp: new Date() });
      ports.broadcastMessage(conversation.id, content);
      conversation.stop('server_restart');
    }
  };
  const exitOnce = (code = 0): Promise<void> => {
    if (exitPromise) return exitPromise;
    state = 'exiting';
    clearTimers();
    let pendingFlush: void | Promise<void> = undefined;
    try {
      pendingFlush = ports.flushState();
    } catch (error: unknown) {
      console.error('Failed to flush state during shutdown:', error);
    }
    // `exiting` refuses every mutation, and clearTimers() above has just disarmed
    // the drain, so a flush that never settles strands the process forever with no
    // timer left to rescue it: the server stays up answering every request with
    // "Backend reload is draining active turns" (incident 2026-08-20). That is
    // reachable because flushState() awaits turnAttemptJournal.flush(), which
    // queues behind every in-flight journal write. Armed AFTER clearTimers so it
    // cannot be swept away by it, and cleared by dispose().
    flushWatchdog = setTimeout(() => {
      flushWatchdog = null;
      console.error(`State flush did not settle within ${options.flushGraceMs}ms; exiting anyway`);
      ports.exit(code);
    }, options.flushGraceMs);
    exitPromise = Promise.resolve(pendingFlush)
      .catch((error: unknown) => {
        console.error('Failed to flush state during shutdown:', error);
      })
      .then(() => {
        if (flushWatchdog) clearTimeout(flushWatchdog);
        flushWatchdog = null;
        ports.exit(code);
      });
    return exitPromise;
  };
  const forceDrain = (graceMs: number) => {
    console.warn(
      `Backend force-draining after ${graceMs}ms grace (${activeWorkCount()} operation(s) still active)`
    );
    // Drop the stale counts BEFORE interrupting. These assignments cannot throw,
    // so activeWorkCount() is guaranteed to fall even if interrupt() below does.
    stopScheduler();
    startupPending = false;
    activeMutations = 0;
    try {
      interrupt('force-drain after grace');
    } catch (error: unknown) {
      // This timer is one-shot. Letting a broadcast/stop failure escape here would
      // skip exitOnce() and wedge the controller in `reloading` permanently.
      console.error('Failed to interrupt active turns during force-drain:', error);
    }
    clearTimers();
    void exitOnce();
  };
  const waitForDrain = (graceMs: number, onWaiting: () => void) => {
    if (activeWorkCount() === 0) {
      void exitOnce();
      return;
    }
    onWaiting();
    drainInterval = setInterval(() => {
      if (activeWorkCount() === 0) void exitOnce();
    }, DRAIN_POLL_INTERVAL_MS);
    // Grace: a reload must not hang forever if a mutation never released (e.g. an
    // HTTP finish/close that never fired) or a provider turn hangs. exitOnce()
    // clears this timer, so it can only fire while the drain is still open.
    forceExitTimeout = setTimeout(() => forceDrain(graceMs), graceMs);
  };
  const completeStartup = () => {
    startupPending = false;
    if (state !== 'starting') return false;
    state = 'idle';
    return true;
  };
  const abortStartup = () => {
    startupPending = false;
  };
  const beginMutation = (options?: { allowDuringStartup?: boolean }): (() => void) | null => {
    const startupCreation = state === 'starting' && options?.allowDuringStartup === true;
    if (state !== 'idle' && !startupCreation) return null;
    activeMutations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeMutations = Math.max(0, activeMutations - 1);
    };
  };
  const handleReload = () => {
    if (state !== 'starting' && state !== 'idle') return;
    pauseScheduler();
    state = 'reloading';
    // A live provider turn cannot be handed to a replacement server because this
    // process owns its event stream and in-memory buffers. Keep that ownership
    // until the turn completes; the dev watcher coalesces further file changes
    // and starts one replacement process afterward.
    //
    // `reloading` is terminal — there is no path back to `idle`, so every mutation
    // is refused until this process exits. That makes the grace below a liveness
    // requirement, not an optimisation: without it a long provider turn wedges
    // conversation creation indefinitely (incident 2026-08-20).
    waitForDrain(options.reloadDrainGraceMs, () => {
      console.warn(
        `Backend reload queued: waiting for ${activeWorkCount()} active operation(s) to finish`
      );
    });
  };
  const handleShutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    if (state === 'exiting' || state === 'shutting_down') return;
    stopScheduler();
    clearTimers();
    state = 'shutting_down';
    startupPending = false;
    console.log(`${signal} — stopping active turns and shutting down`);
    interrupt('explicit shutdown');
    // waitForDrain already exits immediately when nothing is outstanding, and owns
    // the single force-exit timer. Arming a second one here used to overwrite the
    // handle, leaking a timer that clearTimers()/dispose() could never reach.
    waitForDrain(options.forceExitGraceMs, () => undefined);
  };
  const handleSigint = () => handleShutdown('SIGINT');
  const handleSigterm = () => handleShutdown('SIGTERM');
  const handleStartupFailure = () => {
    if (state === 'exiting') return;
    stopScheduler();
    startupPending = false;
    state = 'shutting_down';
    interrupt('startup failure');
    void exitOnce(1);
  };

  return {
    get state() {
      return state;
    },
    beginMutation,
    completeStartup,
    abortStartup,
    handleReload,
    handleStartupFailure,
    handleSigint,
    handleSigterm,
    dispose: clearTimers,
  };
}

export function registerShutdownHandlers(
  options: ShutdownOptions,
  ports: ShutdownPorts
): ShutdownController {
  const controller = createShutdownController(options, ports);
  process.on('SIGINT', controller.handleSigint);
  process.on('SIGTERM', controller.handleSigterm);
  const handleProcessMessage = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'unleashd:dev-reload'
    ) {
      controller.handleReload();
    }
  };
  process.on('message', handleProcessMessage);
  const disposeController = controller.dispose;
  return {
    get state() {
      return controller.state;
    },
    beginMutation: controller.beginMutation,
    completeStartup: controller.completeStartup,
    abortStartup: controller.abortStartup,
    handleSigint: controller.handleSigint,
    handleSigterm: controller.handleSigterm,
    handleReload: controller.handleReload,
    handleStartupFailure: controller.handleStartupFailure,
    dispose() {
      process.off('SIGINT', controller.handleSigint);
      process.off('SIGTERM', controller.handleSigterm);
      process.off('message', handleProcessMessage);
      disposeController();
    },
  };
}
