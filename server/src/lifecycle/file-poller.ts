export interface PollCycleResult<TUpdate> {
  updated: Map<string, TUpdate>;
  mtimes: Map<string, number>;
  deferredDirtyPaths?: ReadonlySet<string>;
}

export interface ExternalActivityPort {
  entries(): IterableIterator<[string, number]>;
  has(sessionId: string): boolean;
  set(sessionId: string, lastSeen: number): void;
  delete(sessionId: string): void;
}

export interface FilePollerPorts<TUpdate, TBroadcast> {
  getMtimes(): Map<string, number>;
  setMtimes(mtimes: Map<string, number>): void;
  collectActiveIds(): Set<string>;
  poll(mtimes: Map<string, number>, activeIds: Set<string>): Promise<PollCycleResult<TUpdate>>;
  pruneCompletionSuppressions(now: number): void;
  isCompletionSuppressed(sessionId: string, now: number): boolean;
  externalActivity: ExternalActivityPort;
  findConversationId(sessionId: string): string | undefined;
  broadcastStatus(conversationId: string, isRunning: boolean): void;
  applyUpdate(sessionId: string, update: TUpdate): Promise<TBroadcast | null>;
  broadcastUpdates(updates: TBroadcast[]): void;
  pruneTracking(): void;
}

export interface FilePollerOptions {
  intervalMs: number;
  externalGraceMs: number;
  verbose: boolean;
}

export interface FilePoller {
  runOnce(): Promise<void>;
  start(): NodeJS.Timeout;
}

export function createFilePoller<TUpdate, TBroadcast>(
  options: FilePollerOptions,
  ports: FilePollerPorts<TUpdate, TBroadcast>
): FilePoller {
  let inFlight: Promise<void> | null = null;
  // A runtime may become active after its file was parsed. The mtime has
  // already advanced, so retain that parsed update until an idle application
  // boundary instead of waiting for another disk write that may never happen.
  const pendingUpdates = new Map<string, TUpdate>();

  async function pollOnce(): Promise<void> {
    try {
      const activeIdsAtPollStart = ports.collectActiveIds();
      const previousMtimes = ports.getMtimes();
      const { updated, mtimes, deferredDirtyPaths } = await ports.poll(
        previousMtimes,
        activeIdsAtPollStart
      );
      const nextMtimes = new Map(mtimes);
      for (const dirtyPath of deferredDirtyPaths ?? []) {
        const previousMtime = previousMtimes.get(dirtyPath);
        if (previousMtime === undefined) nextMtimes.delete(dirtyPath);
        else nextMtimes.set(dirtyPath, previousMtime);
      }
      ports.setMtimes(nextMtimes);
      for (const [sessionId, update] of updated) pendingUpdates.set(sessionId, update);

      const activeIds = ports.collectActiveIds();
      for (const activeId of activeIdsAtPollStart) activeIds.add(activeId);

      const now = Date.now();
      ports.pruneCompletionSuppressions(now);
      for (const sessionId of updated.keys()) {
        if (activeIds.has(sessionId) || ports.isCompletionSuppressed(sessionId, now)) continue;
        if (!ports.externalActivity.has(sessionId)) {
          if (options.verbose) {
            console.log(`[Poll] External activity detected: ${sessionId.substring(0, 8)}`);
          }
          const conversationId = ports.findConversationId(sessionId);
          if (conversationId) ports.broadcastStatus(conversationId, true);
        }
        ports.externalActivity.set(sessionId, now);
      }

      for (const [sessionId, lastSeen] of ports.externalActivity.entries()) {
        if (ports.isCompletionSuppressed(sessionId, now)) {
          ports.externalActivity.delete(sessionId);
          continue;
        }
        if (now - lastSeen < options.externalGraceMs) continue;
        ports.externalActivity.delete(sessionId);
        if (options.verbose) {
          console.log(`[Poll] External activity stopped: ${sessionId.substring(0, 8)}`);
        }
        const conversationId = ports.findConversationId(sessionId);
        if (conversationId) ports.broadcastStatus(conversationId, false);
      }

      ports.pruneTracking();
      if (pendingUpdates.size === 0) return;
      if (options.verbose)
        console.log(`[Poll] ${pendingUpdates.size} conversation update(s) pending`);

      const changed: TBroadcast[] = [];
      for (const [sessionId, update] of pendingUpdates) {
        if (activeIds.has(sessionId) || ports.collectActiveIds().has(sessionId)) continue;
        const broadcast = await ports.applyUpdate(sessionId, update);
        // applyUpdate can await durable identity lookup before checking runtime
        // ownership. An active rejection is retryable; an idle null (including
        // a tombstone or deliberately ignored source) is terminal.
        if (ports.collectActiveIds().has(sessionId)) continue;
        pendingUpdates.delete(sessionId);
        if (broadcast) changed.push(broadcast);
      }
      if (changed.length > 0) ports.broadcastUpdates(changed);
    } catch (error) {
      console.error('[Poll] Error during file polling:', error);
    }
  }

  function runOnce(): Promise<void> {
    if (inFlight) return inFlight;

    const cycle = pollOnce();
    const trackedCycle = cycle.finally(() => {
      if (inFlight === trackedCycle) inFlight = null;
    });
    inFlight = trackedCycle;
    return trackedCycle;
  }

  return {
    runOnce,
    start() {
      return setInterval(() => void runOnce(), options.intervalMs);
    },
  };
}
