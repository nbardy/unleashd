/**
 * Loader — generic load and poll loop driven by the DiskAdapter registry.
 *
 * No per-provider if/else here. Add a provider to registry.ts only.
 *
 * Two phases: Phase 1 discoverAll() stat + sort by mtime desc, Phase 2
 * parseFile() bounded concurrency + batched onProgress.
 *
 * Why Phase 1 is single-stat: Feb 2026 (1bb9ba9) streamed Phase 2 but Jul
 * 2026 (59da781) added `starting→idle` barrier for authoritative init. Phase 2
 * got fast again (Codex filter 6920s→40s, cache 1.09s), but opencode composite
 * mtime made Phase 1 38s/3099 before any batch (Aug 2026). Now Phase 1 uses
 * one stat per source; composite stays in poll for correctness. Baseline
 * still records all sources so `limit` is hydration cap (eedf239).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoveredConversation } from '@unleashd/shared';
import { shouldIgnoreWorkingDirectory } from '../config';
import type { DiskAdapter, LoadProgressCallback, LoadResult, PollResult } from './disk-adapter';
import { sessionToConversation } from './disk-adapter';
import { extractCodexSessionIdFromFilename, extractMuseSessionIdFromFilePath } from './jsonl';
import { diskAdapters } from './registry';
import { OPENCODE_PART_DIR, getOpenCodeSessionMtime } from './registry';
import type { NormalizedSessionCache } from './session-cache';

// =============================================================================
// DiscoveredFile — adapter-tagged file entry from Phase 1
// =============================================================================

interface DiscoveredFile {
  filePath: string;
  mtimeMs: number;
  sizeBytes: number;
  adapter: DiskAdapter;
}

const DEFAULT_MAX_IN_FLIGHT_PARSE_BYTES = 256 * 1024 * 1024;

// =============================================================================
// Phase 1 — discover all files across all adapters, sorted by mtime desc
// =============================================================================

/**
 * Discover all session paths from all adapters, stat each for mtime, sort by
 * mtime descending so progressive loading serves the most recent sessions first.
 *
 * OpenCode sessions are directories. The accurate mtime is the max across
 * message files + part subdirs (getOpenCodeSessionMtime), but that composite
 * scan is expensive: 3099 sources took 38s in Aug 2026. For startup ordering
 * we use a single `stat(dir)` as a fast proxy — dir mtime correlates with
 * recent activity and is sufficient to get the newest ~500 into the first
 * parse batches. Polling (pollForChanges) still uses the full composite for
 * correctness on dirty detection. If ordering precision ever matters, compute
 * composite only for the top-K after the fast sort.
 */
async function discoverAll(adapters: DiskAdapter[]): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];

  await Promise.all(
    adapters.map(async (adapter) => {
      let paths: string[];
      try {
        paths = await adapter.discoverFiles();
      } catch (err) {
        console.warn(
          `[discover] ${adapter.provider}: discoverFiles() failed: ${err instanceof Error ? err.message : err}`
        );
        return;
      }

      const statResults = await Promise.all(
        paths.map(async (filePath) => {
          try {
            // Single stat for ordering — opencode composite (getOpenCodeSessionMtime)
            // was 38s for 3099 sources in Aug 2026; now only poll uses composite.
            // Opencode dirs get weight 1 (many small files); JSONL weight is exact
            // size for the 256MB in-flight budget.
            const stat = await fs.promises.stat(filePath);
            if (stat.mtimeMs <= 0) return null;
            return {
              filePath,
              mtimeMs: stat.mtimeMs,
              sizeBytes: adapter.provider === 'opencode' ? 1 : stat.size,
              adapter,
            };
          } catch {
            // File may have been deleted between discoverFiles() and stat()
            return null;
          }
        })
      );

      for (const result of statResults) {
        if (result) files.push(result);
      }
    })
  );

  // Sort by mtime descending — most recently modified sessions first.
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

// =============================================================================
// Parallel processing helper
// =============================================================================

/**
 * Process items with bounded concurrency (worker-pool pattern).
 * No external dependencies — just Promise-based throttling.
 * Does not accumulate results — each item is GC-eligible after its callback completes.
 *
 * Shared mutable state in `fn` (batchBuffer, counters) is safe because JS is
 * single-threaded: mutations between awaits run atomically.
 */
async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  maxInFlightWeight: number,
  getWeight: (item: T) => number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  let availableWeight = maxInFlightWeight;
  const waiters: Array<{ weight: number; resolve: () => void }> = [];

  function drainWaiters(): void {
    while (waiters.length > 0 && waiters[0].weight <= availableWeight) {
      const waiter = waiters.shift();
      if (!waiter) return;
      availableWeight -= waiter.weight;
      waiter.resolve();
    }
  }

  async function acquire(weight: number): Promise<void> {
    await new Promise<void>((resolve) => {
      waiters.push({ weight, resolve });
      drainWaiters();
    });
  }

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      const weight = Math.min(maxInFlightWeight, Math.max(1, Math.ceil(getWeight(item))));
      await acquire(weight);
      try {
        await fn(item);
      } finally {
        availableWeight += weight;
        drainWaiters();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
}

// =============================================================================
// Phase 2 helper — parse one discovered file
// =============================================================================

interface ParsedResult {
  filePath: string;
  mtimeMs: number;
  conversation: DiscoveredConversation | null;
  parseTimeMs: number;
  cacheHit: boolean;
}

async function readParsedSession(
  file: DiscoveredFile,
  cache?: NormalizedSessionCache
): Promise<{ session: Awaited<ReturnType<DiskAdapter['parseFile']>>; cacheHit: boolean }> {
  const key = {
    provider: file.adapter.provider,
    filePath: file.filePath,
    mtimeMs: file.mtimeMs,
    sizeBytes: file.sizeBytes,
  };
  const cached = cache ? await cache.read(key) : { hit: false as const };
  if (cached.hit) return { session: cached.session, cacheHit: true };

  const session = await file.adapter.parseFile(file.filePath);
  if (cache) {
    await cache.write(key, session).catch((error: unknown) => {
      console.warn(
        `[session-cache] Could not cache ${path.basename(file.filePath)}: ${
          error instanceof Error ? error.message : error
        }`
      );
    });
  }
  return { session, cacheHit: false };
}

async function parseOneFile(
  file: DiscoveredFile,
  cache?: NormalizedSessionCache
): Promise<ParsedResult> {
  const startTime = performance.now();
  try {
    const { session, cacheHit } = await readParsedSession(file, cache);
    const parseTimeMs = performance.now() - startTime;

    if (!session) {
      return {
        filePath: file.filePath,
        mtimeMs: file.mtimeMs,
        conversation: null,
        parseTimeMs,
        cacheHit,
      };
    }

    // Drop sessions whose workingDirectory matches a user-configured ignore pattern
    // (~/.agent-viewer/config.json — see server/src/config.ts).
    if (shouldIgnoreWorkingDirectory(session.workingDirectory)) {
      return {
        filePath: file.filePath,
        mtimeMs: file.mtimeMs,
        conversation: null,
        parseTimeMs,
        cacheHit,
      };
    }

    const conversation = sessionToConversation(session);

    // null = hidden test conversation ([_HIDE_TEST_]) or empty messages — drop at ingestion.
    if (!conversation || conversation.messages.length === 0) {
      return {
        filePath: file.filePath,
        mtimeMs: file.mtimeMs,
        conversation: null,
        parseTimeMs,
        cacheHit,
      };
    }

    return {
      filePath: file.filePath,
      mtimeMs: file.mtimeMs,
      conversation,
      parseTimeMs,
      cacheHit,
    };
  } catch (error: unknown) {
    const parseTimeMs = performance.now() - startTime;
    console.warn(
      `Failed to parse session: ${path.basename(file.filePath)} (${error instanceof Error ? error.message : error})`
    );
    return {
      filePath: file.filePath,
      mtimeMs: 0,
      conversation: null,
      parseTimeMs,
      cacheHit: false,
    };
  }
}

// =============================================================================
// loadAllConversations — startup load with batched progress callbacks
// =============================================================================

/**
 * Load all conversations from all supported CLI agent session files.
 *
 * Uses the diskAdapters registry — no per-provider if/else here.
 *
 * Phase 1: Discover all file paths + stat for mtime (sorted by mtime descending)
 * Phase 2: Parse files in parallel with bounded concurrency, emitting batches progressively
 *
 * Files are sorted by mtime descending (most recent first). With CONCURRENCY > 1,
 * batch completion order is approximately but not strictly mtime-ordered — a slow-to-parse
 * recent file may land in a later batch than faster older files. This is fine because
 * the UI re-sorts by timestamp on every render (Gallery by createdAt, Sidebar by last message).
 *
 * @param onProgress - Optional callback invoked with batches of parsed conversations
 * @returns conversations + mtime index for subsequent polling
 */
export async function loadAllConversations(
  options: {
    onProgress?: LoadProgressCallback;
    limit?: number;
    offset?: number;
    concurrency?: number;
    batchSize?: number;
    initialBatchSize?: number;
    maxInFlightParseBytes?: number;
    adapters?: readonly DiskAdapter[];
    cache?: NormalizedSessionCache;
  } = {}
): Promise<LoadResult> {
  const {
    onProgress,
    limit,
    offset = 0,
    concurrency = 10,
    batchSize = 50,
    initialBatchSize = Math.min(20, batchSize),
    maxInFlightParseBytes = DEFAULT_MAX_IN_FLIGHT_PARSE_BYTES,
    adapters = diskAdapters,
    cache,
  } = options;

  const normalizedConcurrency =
    Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 10;
  const normalizedBatchSize =
    Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 50;
  const normalizedInitialBatchSize =
    Number.isFinite(initialBatchSize) && initialBatchSize > 0
      ? Math.min(normalizedBatchSize, Math.floor(initialBatchSize))
      : Math.min(20, normalizedBatchSize);
  const normalizedMaxInFlightParseBytes =
    Number.isFinite(maxInFlightParseBytes) && maxInFlightParseBytes > 0
      ? Math.floor(maxInFlightParseBytes)
      : DEFAULT_MAX_IN_FLIGHT_PARSE_BYTES;
  const normalizedOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const normalizedLimit =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : undefined;

  // Phase 1: Discover all files (sorted by mtime descending)
  const discoverStart = performance.now();
  console.log('Discovering persisted conversation files...');
  const files = await discoverAll([...adapters]);
  const discoverTimeMs = performance.now() - discoverStart;

  const startIndex = Math.min(normalizedOffset, files.length);
  const endIndex = normalizedLimit
    ? Math.min(startIndex + normalizedLimit, files.length)
    : files.length;
  const filesToParse = files.slice(startIndex, endIndex);

  console.log(
    `Discovered ${files.length} persisted conversation sources in ${discoverTimeMs.toFixed(0)}ms (sorted by mtime), parsing ${filesToParse.length} with concurrency=${normalizedConcurrency}, in-flight source budget=${Math.ceil(normalizedMaxInFlightParseBytes / 1024 / 1024)}MB...`
  );

  // Phase 2: Parse files in parallel with batched progress callbacks.
  // When onProgress is provided, the caller handles placement (e.g. into the server's
  // conversations Map), so we skip building a redundant conversations Map here —
  // avoids doubling peak memory by holding two copies of every parsed conversation.
  const conversations = onProgress ? null : new Map<string, DiscoveredConversation>();
  // The mtime index is a discovery baseline, not a list of hydrated files.
  // Recording every source is what makes `limit` a real hydration cap: omitted
  // history must not look "new" to the first poll and trigger an accidental
  // full-history parse.
  const mtimes = new Map(files.map((file) => [file.filePath, file.mtimeMs]));

  // Running accumulators for parse timing — avoids allocating a 1500-element array
  // just to compute summary stats that are immediately discarded after logging.
  let parseTimeMin = Number.POSITIVE_INFINITY;
  let parseTimeMax = 0;
  let parseTimeSum = 0;
  let parseTimeCount = 0;
  let cacheHits = 0;
  let batchBuffer: DiscoveredConversation[] = [];
  let filesProcessed = 0;
  let conversationCount = 0;

  const parseStart = performance.now();

  await forEachWithConcurrency(
    filesToParse,
    normalizedConcurrency,
    normalizedMaxInFlightParseBytes,
    (file) => file.sizeBytes,
    async (file) => {
      const result = await parseOneFile(file, cache);

      const t = result.parseTimeMs;
      if (t < parseTimeMin) parseTimeMin = t;
      if (t > parseTimeMax) parseTimeMax = t;
      parseTimeSum += t;
      parseTimeCount++;
      if (result.cacheHit) cacheHits++;

      if (result.conversation) {
        conversations?.set(result.conversation.sessionId, result.conversation);
        batchBuffer.push(result.conversation);
        conversationCount++;
      }

      filesProcessed++;

      const nextBatchSize =
        conversationCount <= batchBuffer.length ? normalizedInitialBatchSize : normalizedBatchSize;
      if (onProgress && batchBuffer.length >= nextBatchSize) {
        // Detach the full batch before awaiting the consumer. Other parser
        // workers may complete while hydration is in progress.
        const batch = batchBuffer;
        batchBuffer = [];
        await onProgress(batch, { loaded: filesProcessed, total: filesToParse.length });
      }
    }
  );

  // Emit any remaining conversations in the final batch
  if (onProgress && batchBuffer.length > 0) {
    await onProgress(batchBuffer, { loaded: filesProcessed, total: filesToParse.length });
  }

  const parseTimeMs = performance.now() - parseStart;

  // Log timing summary
  if (parseTimeCount > 0) {
    const avg = parseTimeSum / parseTimeCount;
    console.log(
      `Parse timing (${parseTimeCount} files): min=${parseTimeMin.toFixed(1)}ms, avg=${avg.toFixed(1)}ms, max=${parseTimeMax.toFixed(1)}ms`
    );
  }
  if (cache) {
    console.log(`[session-cache] ${cacheHits}/${parseTimeCount} startup sources reused`);
  }

  const totalTimeMs = discoverTimeMs + parseTimeMs;
  console.log(
    `Loaded ${conversationCount} conversations from ${filesToParse.length} files in ${totalTimeMs.toFixed(0)}ms (discover: ${discoverTimeMs.toFixed(0)}ms, parse: ${parseTimeMs.toFixed(0)}ms)`
  );

  return { conversations: conversations ?? new Map(), mtimes };
}

// =============================================================================
// pollForChanges — incremental poll comparing mtimes to previous index
//
// NOTE: No dir-level mtime gate. Directory mtime only changes when files are
// added/removed, NOT when existing files are modified. Since we need to detect
// external writes to existing session files, we must stat source files directly.
// Individual stat calls are cheap (microseconds).
// =============================================================================

/**
 * Poll for changes to persisted session sources since the last check.
 *
 * Uses the diskAdapters registry — no per-provider if/else here.
 *
 * @param prevMtimes - Previous mtime index (filepath → mtime ms)
 * @param activeIds - Conversation IDs currently running (skip these)
 * @returns Changed conversations + updated mtime index
 */
export async function pollForChanges(
  prevMtimes: Map<string, number>,
  activeIds: Set<string>,
  options: { cache?: NormalizedSessionCache } = {}
): Promise<PollResult> {
  const updated = new Map<string, DiscoveredConversation>();
  const deferredDirtyPaths = new Set<string>();
  // Start fresh — only populate with currently-discovered files.
  // Any path absent from this poll's discovery is deleted on disk and falls out naturally,
  // preventing the map from accumulating dead paths forever.
  const mtimes = new Map<string, number>();

  for (const adapter of diskAdapters) {
    let paths: string[];
    try {
      paths = await adapter.discoverFiles();
    } catch (err) {
      console.warn(
        `[poll] ${adapter.provider}: discoverFiles() failed: ${err instanceof Error ? err.message : err}`
      );
      continue;
    }

    // For OpenCode, discoverFiles() already rebuilt the session metadata index
    // (stored on opencodeAdapter._sessionIndex). Reuse it instead of re-fetching.
    const openCodeSessionIndex: Map<string, string> | null =
      adapter.provider === 'opencode'
        ? ((adapter as typeof adapter & { _sessionIndex: Map<string, string> | null })
            ._sessionIndex ?? null)
        : null;

    for (const filePath of paths) {
      try {
        // Compute current mtime — for OpenCode sessions (directories) use
        // the composite mtime that covers message files + part subdirs.
        let currentMtime: number;
        let currentSizeBytes: number;
        if (adapter.provider === 'opencode') {
          const sessionId = path.basename(filePath);
          const metadataPath = openCodeSessionIndex?.get(sessionId);
          currentMtime = await getOpenCodeSessionMtime(filePath, OPENCODE_PART_DIR, metadataPath);
          if (currentMtime <= 0) continue;
          currentSizeBytes = 1;
        } else {
          const stat = await fs.promises.stat(filePath);
          currentMtime = stat.mtimeMs;
          currentSizeBytes = stat.size;
        }

        // Always record the current mtime for every discovered file.
        // This is how deleted files get pruned: if a file isn't discovered, it's never set.
        mtimes.set(filePath, currentMtime);

        const prevMtime = prevMtimes.get(filePath);

        // Skip if file mtime unchanged
        if (prevMtime !== undefined && currentMtime <= prevMtime) {
          continue;
        }

        // Fast skip for active sessions — in-memory state is authoritative
        // while a process is running; let the next poll pick up the final state.
        if (adapter.provider === 'claude') {
          const sessionId = path.basename(filePath, '.jsonl');
          if (activeIds.has(sessionId)) {
            deferredDirtyPaths.add(filePath);
            continue;
          }
        } else if (adapter.provider === 'codex') {
          const sessionIdHint = extractCodexSessionIdFromFilename(filePath);
          if (sessionIdHint && activeIds.has(sessionIdHint)) {
            deferredDirtyPaths.add(filePath);
            continue;
          }
        } else if (adapter.provider === 'opencode') {
          const sessionIdHint = path.basename(filePath);
          if (activeIds.has(sessionIdHint)) {
            deferredDirtyPaths.add(filePath);
            continue;
          }
        } else if (adapter.provider === 'gemini') {
          // Gemini session files are named session-{ts}-{uuid}.json
          const sessionId = path.basename(filePath, '.json');
          if (activeIds.has(sessionId)) {
            deferredDirtyPaths.add(filePath);
            continue;
          }
        } else if (adapter.provider === 'cursor') {
          // Cursor transcript files are named {uuid}.jsonl under agent-transcripts/{uuid}/
          const sessionId = path.basename(filePath, '.jsonl');
          if (activeIds.has(sessionId)) {
            deferredDirtyPaths.add(filePath);
            continue;
          }
        } else if (adapter.provider === 'muse') {
          const sessionIdHint = extractMuseSessionIdFromFilePath(filePath);
          if (sessionIdHint && activeIds.has(sessionIdHint)) {
            deferredDirtyPaths.add(filePath);
            continue;
          }
        }

        // Re-parse the changed session
        const { session } = await readParsedSession(
          {
            filePath,
            mtimeMs: currentMtime,
            sizeBytes: currentSizeBytes,
            adapter,
          },
          options.cache
        );
        if (!session) continue;
        if (shouldIgnoreWorkingDirectory(session.workingDirectory)) continue;

        const conversation = sessionToConversation(session);
        // null = hidden test conversation ([_HIDE_TEST_]) — dropped at ingestion.
        if (!conversation) continue;
        if (activeIds.has(conversation.sessionId)) {
          deferredDirtyPaths.add(filePath);
          continue;
        }
        if (conversation.messages.length === 0) continue;

        updated.set(conversation.sessionId, conversation);
      } catch (error: unknown) {
        // A failed parse did not observe an authoritative new state. Preserve
        // the prior baseline so the same dirty file is retried next poll.
        deferredDirtyPaths.add(filePath);
        console.warn(
          `[Poll] Failed to parse ${adapter.provider} session: ${path.basename(filePath)} (${error instanceof Error ? error.message : error})`
        );
      }
    }
  }

  return { updated, mtimes, deferredDirtyPaths };
}
