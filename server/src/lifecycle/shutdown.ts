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
  forceExitGraceMs: number;
}

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
    drainInterval = null;
    forceExitTimeout = null;
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
    exitPromise = Promise.resolve(pendingFlush)
      .catch((error: unknown) => {
        console.error('Failed to flush state during shutdown:', error);
      })
      .then(() => {
        ports.exit(code);
      });
    return exitPromise;
  };
  const waitForDrain = (onWaiting: () => void) => {
    if (activeWorkCount() === 0) {
      void exitOnce();
      return;
    }
    onWaiting();
    // Grace: dev reload must not hang forever if a mutation never released
    // (e.g. HTTP finish/close missed) or a provider turn hangs. After 8s
    // force the drain so the watcher can start the replacement process.
    drainInterval = setInterval(() => {
      if (activeWorkCount() === 0) void exitOnce();
    }, 500);
    forceExitTimeout = setTimeout(() => {
      if (state === 'reloading' || state === 'shutting_down') {
        if (activeWorkCount() !== 0) {
          console.warn(
            `Backend reload force-draining ${activeWorkCount()} stale operation(s) after grace`
          );
          // In dev, a hung provider turn or scheduler run should not block
          // the watcher forever. Interrupt live turns and drop stale counts,
          // then exit so the replacement can start.
          interrupt('force-drain after grace');
          stopScheduler();
          startupPending = false;
          activeMutations = 0;
          clearTimers();
          void exitOnce();
        }
      }
    }, 8000);
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
    // A live provider turn cannot be handed to a replacement server because
    // this process owns its event stream and in-memory buffers. Keep that
    // ownership until the turn completes; the dev watcher coalesces further
    // file changes and starts one replacement process afterward.
    waitForDrain(() => {
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
    if (activeWorkCount() === 0) {
      void exitOnce();
    } else {
      waitForDrain(() => undefined);
      forceExitTimeout = setTimeout(() => void exitOnce(), options.forceExitGraceMs);
    }
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
