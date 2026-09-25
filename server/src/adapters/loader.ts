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
import { shouldIgnoreWorkingDirectory } from '../config';
import type {
  DiscoveredSession,
  DiskAdapter,
  LoadProgressCallback,
  LoadResult,
  ParsedSession,
  PollResult,
  SessionHistoryOptions,
  SessionHistorySource,
  SourceGrowth,
} from './disk-adapter';
import { sessionLookupKeys, sessionToConversation } from './disk-adapter';
import { extractCodexSessionIdFromFilename, extractMuseSessionIdFromFilePath } from './jsonl';
import { diskAdapters } from './registry';
import { OPENCODE_PART_DIR, getOpenCodeSessionMtime } from './registry';
import type { NormalizedSessionCache } from './session-cache';
import type { TranscriptTails } from './transcript-tails';

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
/** Every source found, plus the providers whose discovery threw (their sources are unknown). */
interface Discovery {
  files: DiscoveredFile[];
  failed: DiskAdapter['provider'][];
}

async function discoverAll(adapters: DiskAdapter[]): Promise<Discovery> {
  const files: DiscoveredFile[] = [];
  const failed: DiskAdapter['provider'][] = [];

  await Promise.all(
    adapters.map(async (adapter) => {
      let paths: string[];
      try {
        paths = await adapter.discoverFiles();
      } catch (err) {
        console.warn(
          `[discover] ${adapter.provider}: discoverFiles() failed: ${err instanceof Error ? err.message : err}`
        );
        failed.push(adapter.provider);
        return;
      }
      let statFailed = false;

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
          } catch (error: unknown) {
            // Deleted between discoverFiles() and stat(): simply gone. Any other
            // error leaves the source unknown, so the discovery is incomplete.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') statFailed = true;
            return null;
          }
        })
      );
      if (statFailed) {
        console.warn(`[discover] ${adapter.provider}: some sources could not be stat'ed`);
        failed.push(adapter.provider);
      }

      for (const result of statResults) {
        if (result) files.push(result);
      }
    })
  );

  // Sort by mtime descending — most recently modified sessions first.
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { files, failed };
}

function sessionFileIndexKey(provider: string, key: string): string {
  return `${provider}\0${key}`;
}

/** One pass over discovery; each binding lookup is then a map hit. */
function indexSessionFiles(files: readonly DiscoveredFile[]): Map<string, DiscoveredFile[]> {
  const index = new Map<string, DiscoveredFile[]>();
  for (const file of files) {
    for (const key of file.adapter.sessionFileKeys(file.filePath)) {
      const indexKey = sessionFileIndexKey(file.adapter.provider, key);
      const entries = index.get(indexKey);
      if (entries) entries.push(file);
      else index.set(indexKey, [file]);
    }
  }
  return index;
}

function createHistoryReader(
  options: SessionHistoryOptions & { cache?: NormalizedSessionCache },
  discover: () => Promise<DiscoveredFile[]>,
  readSource = (file: DiscoveredFile) => parseOneFile(file, options.cache)
): (source: DiscoveredSession) => Promise<SessionHistorySource> {
  let byKey: Promise<Map<string, DiscoveredFile[]>> | undefined;
  return async (source) => {
    const bindings = await options.resolveSessionBindings?.(source);
    const related = bindings?.filter(
      (binding) => binding.provider !== source.provider || binding.sessionId !== source.sessionId
    );
    if (!related?.length) return source;
    // Startup's limit selects conversations. Older files bound to a selected
    // conversation still belong to its history, without importing unrelated rows.
    byKey ??= discover().then(indexSessionFiles);
    const index = await byKey;
    const boundSessionSources: DiscoveredSession[] = [];
    for (const binding of related) {
      // Native path layouts belong to adapters. Gemini uses shortened ids and
      // Muse uses a parent directory; hints never establish conversation identity.
      const candidates = new Set(
        sessionLookupKeys(binding.sessionId).flatMap(
          (key) => index.get(sessionFileIndexKey(binding.provider, key)) ?? []
        )
      );
      for (const candidate of candidates) {
        const parsed = await readSource(candidate);
        if (
          parsed.conversation?.provider === binding.provider &&
          parsed.conversation.sessionId === binding.sessionId
        ) {
          boundSessionSources.push(parsed.conversation);
          break;
        }
      }
    }
    return { ...source, boundSessionSources };
  };
}

/** Share the byte budget between selected sources and their older bound sources. */
function createBoundedSourceReader(
  maxInFlightWeight: number,
  cache?: NormalizedSessionCache
): (file: DiscoveredFile) => Promise<ParsedResult> {
  let availableWeight = maxInFlightWeight;
  const waiters: Array<{ weight: number; resolve: () => void }> = [];
  const inFlight = new Map<string, Promise<ParsedResult>>();

  function drainWaiters(): void {
    while (waiters.length > 0 && waiters[0].weight <= availableWeight) {
      const waiter = waiters.shift();
      if (!waiter) return;
      availableWeight -= waiter.weight;
      waiter.resolve();
    }
  }

  return (file) => {
    const key = `${file.adapter.provider}\0${file.filePath}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const weight = Math.min(maxInFlightWeight, Math.max(1, Math.ceil(file.sizeBytes)));
    const result = (async () => {
      await new Promise<void>((resolve) => {
        waiters.push({ weight, resolve });
        drainWaiters();
      });
      try {
        return await parseOneFile(file, cache);
      } finally {
        availableWeight += weight;
        inFlight.delete(key);
        drainWaiters();
      }
    })();
    inFlight.set(key, result);
    return result;
  };
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
export async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await fn(items[index]);
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
  conversation: DiscoveredSession | null;
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
  options: SessionHistoryOptions & {
    onProgress?: LoadProgressCallback;
    limit?: number;
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
    concurrency = 10,
    batchSize = 50,
    initialBatchSize = Math.min(20, batchSize),
    maxInFlightParseBytes = DEFAULT_MAX_IN_FLIGHT_PARSE_BYTES,
    adapters = diskAdapters,
    cache,
  } = options;

  // Callers pass validated positive integers (server.ts readPositiveIntEnv);
  // `limit` absent means every discovered source.
  // Phase 1: Discover all files (sorted by mtime descending)
  const discoverStart = performance.now();
  console.log('Discovering persisted conversation files...');
  const { files, failed } = await discoverAll([...adapters]);
  const readSource = createBoundedSourceReader(maxInFlightParseBytes, cache);
  const readHistory = createHistoryReader(options, async () => files, readSource);
  const discoverTimeMs = performance.now() - discoverStart;

  const filesToParse = files.slice(0, limit ?? files.length);

  console.log(
    `Discovered ${files.length} persisted conversation sources in ${discoverTimeMs.toFixed(0)}ms (sorted by mtime), parsing ${filesToParse.length} with concurrency=${concurrency}, in-flight source budget=${Math.ceil(maxInFlightParseBytes / 1024 / 1024)}MB...`
  );

  // Phase 2: Parse files in parallel with batched progress callbacks.
  // When onProgress is provided, the caller handles placement (e.g. into the server's
  // conversations Map), so we skip building a redundant conversations Map here —
  // avoids doubling peak memory by holding two copies of every parsed conversation.
  const conversations = onProgress ? null : new Map<string, DiscoveredSession>();
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
  let batchBuffer: DiscoveredSession[] = [];
  let filesProcessed = 0;
  let conversationCount = 0;

  const parseStart = performance.now();

  await forEachWithConcurrency(filesToParse, concurrency, async (file) => {
    // Release the source-byte budget before loading its siblings; retaining
    // that reservation while waiting on an older source can deadlock startup.
    const result = await readSource(file);

    const t = result.parseTimeMs;
    if (t < parseTimeMin) parseTimeMin = t;
    if (t > parseTimeMax) parseTimeMax = t;
    parseTimeSum += t;
    parseTimeCount++;
    if (result.cacheHit) cacheHits++;

    if (result.conversation) {
      const conversation = await readHistory(result.conversation);
      conversations?.set(conversation.sessionId, conversation);
      batchBuffer.push(conversation);
      conversationCount++;
    }

    filesProcessed++;

    const nextBatchSize = conversationCount <= batchBuffer.length ? initialBatchSize : batchSize;
    if (onProgress && batchBuffer.length >= nextBatchSize) {
      // Detach the full batch before awaiting the consumer. Other parser
      // workers may complete while hydration is in progress.
      const batch = batchBuffer;
      batchBuffer = [];
      await onProgress(batch, { loaded: filesProcessed, total: filesToParse.length });
    }
  });

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
    // Records for deleted sources were never removed: 13,361 records (787MB)
    // for ~7,700 sources on 2026-09-25. Only a discovery that failed for no
    // provider is the complete source set; pruning after a failed one would
    // delete that provider's whole cache on one transient error.
    if (failed.length === 0) {
      // The cache only accelerates startup; a failed prune must not fail it.
      await cache
        .retainOnly(
          files.map((file) => ({ provider: file.adapter.provider, filePath: file.filePath }))
        )
        .then((pruned) => {
          if (pruned > 0) {
            console.log(`[session-cache] Removed ${pruned} records for deleted sources`);
          }
        })
        .catch((error: unknown) => console.warn('[session-cache] Prune failed:', error));
    }
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

export type PollOptions = SessionHistoryOptions & {
  cache?: NormalizedSessionCache;
  adapters?: readonly DiskAdapter[];
  /** Resume points that make re-reading a still-growing transcript cost only its new bytes. */
  tails: TranscriptTails;
};

/** Re-read one changed source; δ over how its adapter's format grows. */
async function readChangedSession(
  file: DiscoveredFile,
  options: PollOptions
): Promise<ParsedSession | null> {
  const growth = file.adapter.growth;
  switch (growth.kind) {
    case 'rewritten':
      return (await readParsedSession(file, options.cache)).session;
    case 'appended':
      return readAppendedSession(file, growth, options);
  }
}

async function readAppendedSession(
  file: DiscoveredFile,
  growth: Extract<SourceGrowth, { kind: 'appended' }>,
  options: PollOptions
): Promise<ParsedSession | null> {
  const session = await options.tails.read(file.filePath, growth);
  // Still written so the next startup reuses this parse. Not read first: the
  // source just changed, so a record for its new mtime cannot exist yet.
  await options.cache
    ?.write(
      {
        provider: file.adapter.provider,
        filePath: file.filePath,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
      },
      session
    )
    .catch((error: unknown) => {
      console.warn(
        `[session-cache] Could not cache ${path.basename(file.filePath)}: ${
          error instanceof Error ? error.message : error
        }`
      );
    });
  return session;
}

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
  options: PollOptions
): Promise<PollResult> {
  const updated = new Map<string, DiscoveredSession>();
  const deferredDirtyPaths = new Set<string>();
  // Start fresh — only populate with currently-discovered files.
  // Any path absent from this poll's discovery is deleted on disk and falls out naturally,
  // preventing the map from accumulating dead paths forever.
  const mtimes = new Map<string, number>();
  let discoveryFailed = false;
  const adapters = options.adapters ?? diskAdapters;
  const readHistory = createHistoryReader(options, () =>
    discoverAll([...adapters]).then((discovery) => discovery.files)
  );

  for (const adapter of adapters) {
    let paths: string[];
    try {
      paths = await adapter.discoverFiles();
    } catch (err) {
      console.warn(
        `[poll] ${adapter.provider}: discoverFiles() failed: ${err instanceof Error ? err.message : err}`
      );
      discoveryFailed = true;
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

        const session = await readChangedSession(
          { filePath, mtimeMs: currentMtime, sizeBytes: currentSizeBytes, adapter },
          options
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

        updated.set(conversation.sessionId, await readHistory(conversation));
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

  // A failed discovery observed nothing about its sources. Dropping them from
  // the baseline made the next successful poll treat that provider's entire
  // history as new and re-parse all of it. Keep every unseen prior entry this
  // round; a later complete poll drops the ones that are really gone.
  if (discoveryFailed) {
    for (const [filePath, mtimeMs] of prevMtimes) {
      if (!mtimes.has(filePath)) mtimes.set(filePath, mtimeMs);
    }
  }

  return { updated, mtimes, deferredDirtyPaths };
}
