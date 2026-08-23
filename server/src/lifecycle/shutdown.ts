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
  /** Dev reload: how long to seek an idle boundary before quiescing new mutations. */
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
  let reloadQuiesceTimeout: NodeJS.Timeout | null = null;
  let flushWatchdog: NodeJS.Timeout | null = null;
  let state: ShutdownState = 'starting';
  let reloadRequested = false;
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
    if (reloadQuiesceTimeout) clearTimeout(reloadQuiesceTimeout);
    if (flushWatchdog) clearTimeout(flushWatchdog);
    drainInterval = null;
    forceExitTimeout = null;
    reloadQuiesceTimeout = null;
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
    reloadRequested = false;
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
  const forceShutdownDrain = (graceMs: number) => {
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
  const waitForShutdownDrain = (graceMs: number) => {
    if (activeWorkCount() === 0) {
      void exitOnce();
      return;
    }
    drainInterval = setInterval(() => {
      if (activeWorkCount() === 0) void exitOnce();
    }, DRAIN_POLL_INTERVAL_MS);
    forceExitTimeout = setTimeout(() => forceShutdownDrain(graceMs), graceMs);
  };
  const waitForReloadDrain = () => {
    const remaining = activeWorkCount();
    if (remaining === 0) {
      void exitOnce();
      return;
    }
    console.warn(
      `Backend reload quiesced; preserving ${remaining} active operation(s) until completion`
    );
    drainInterval = setInterval(() => {
      if (activeWorkCount() === 0) void exitOnce();
    }, DRAIN_POLL_INTERVAL_MS);
  };
  const enterReloading = (quiesce: boolean) => {
    if (!reloadRequested || (state !== 'starting' && state !== 'idle')) return;
    reloadRequested = false;
    state = 'reloading';
    clearTimers();
    if (quiesce) {
      // The fully-available deferral window elapsed. Close admission so a busy
      // backend eventually reaches a restart boundary, but NEVER convert a live
      // provider turn into `server_restart`. Provider watchdogs remain the
      // authority for genuinely hung turns; hot reload is not a kill policy.
      //
      // Keep every existing counter honest. In particular, stopScheduler()
      // cancels active automation conversations, while clearing activeMutations
      // or startupPending lets the process exit in the middle of durable writes
      // or hydration. The scheduler was already paused by handleReload(), so no
      // new scheduled work can appear; wait for all admitted work to release.
      waitForReloadDrain();
      return;
    }
    void exitOnce();
  };
  const enterReloadingAtIdleBoundary = () => {
    if (!reloadRequested || activeWorkCount() !== 0) return;
    enterReloading(false);
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
    if ((state !== 'starting' && state !== 'idle') || reloadRequested) return;
    reloadRequested = true;
    pauseScheduler();
    if (activeWorkCount() === 0) {
      enterReloading(false);
      return;
    }
    // Stay in `idle` while the current backend owns live streams. This keeps the
    // app usable and lets turns finish naturally. The watcher already coalesces
    // later source changes and will start exactly one replacement after exit.
    console.warn(
      `Backend reload queued: keeping current backend available for ${activeWorkCount()} active operation(s)`
    );
    drainInterval = setInterval(enterReloadingAtIdleBoundary, DRAIN_POLL_INTERVAL_MS);
    // A continuously busy backend may never expose a fully idle poll. After the
    // grace, stop admitting new mutations but preserve every provider process
    // until it completes. This bounds reload deferral without killing the work
    // that triggered the reload (incident 2026-08-22).
    reloadQuiesceTimeout = setTimeout(() => {
      console.warn(
        `Backend did not reach an idle reload boundary within ${options.reloadDrainGraceMs}ms; quiescing new mutations`
      );
      enterReloading(true);
    }, options.reloadDrainGraceMs);
  };
  const handleShutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    if (state === 'exiting' || state === 'shutting_down') return;
    reloadRequested = false;
    stopScheduler();
    clearTimers();
    state = 'shutting_down';
    startupPending = false;
    console.log(`${signal} — stopping active turns and shutting down`);
    interrupt('explicit shutdown');
    // waitForShutdownDrain exits immediately when nothing is outstanding, and owns
    // the single force-exit timer. Arming a second one here used to overwrite the
    // handle, leaking a timer that clearTimers()/dispose() could never reach.
    waitForShutdownDrain(options.forceExitGraceMs);
  };
  const handleSigint = () => handleShutdown('SIGINT');
  const handleSigterm = () => handleShutdown('SIGTERM');
  const handleStartupFailure = () => {
    if (state === 'exiting') return;
    reloadRequested = false;
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
