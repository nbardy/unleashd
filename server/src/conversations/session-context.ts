/**
 * The context meter's NUMERATOR, read from each harness's own durable session
 * log.
 *
 * There are two provider-truth paths into the meter and they answer the same
 * question at different latencies:
 *
 *   live  — agent-cli's `usage` event, stored on the conversation as turns
 *           complete. Fresh, but only exists for turns that ran since we
 *           started listening.
 *   file  — this module. Slower to notice a change, but RETROACTIVE: it reads
 *           the numbers the CLI already wrote for every turn ever taken, so an
 *           existing thread shows a real number without having to take another
 *           turn first.
 *
 * Both are provider-counted. Neither is an estimate. The live path wins when
 * present; this is what makes the meter correct on a thread that has been idle
 * since before the feature existed.
 *
 * WHY THIS IS NOT THE BILLING PARSER (http/usage-routes.ts): that module sums
 * every request in the session to answer "what did this cost". This module
 * takes the LATEST request to answer "how full is the window right now". The
 * two statistics diverge permanently at a compaction — the sum keeps climbing
 * while the real context collapses — which is exactly why a cumulative number
 * can never drive a fullness meter.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonlLines } from '../adapters/jsonl-lines';
import { findClaudeSessionFile, findCodexSessionFile } from '../http/usage-routes';

/**
 * A provider-side compaction the harness recorded itself. This is read from the
 * harness's own marker record, NOT inferred from a drop in the numbers: the
 * marker is exact, needs no tuned margin, and cannot false-positive when our
 * estimate happens to run hot.
 */
export interface CompactionMarker {
  /** Boundaries this session has crossed. */
  count: number;
  /** Context immediately before the most recent boundary, when reported. */
  preTokens: number | null;
  /** What the harness carried across it (the summary alone), when reported. */
  postTokens: number | null;
  /** Harness's own word for why, passed through verbatim. */
  trigger: string | null;
}

/** The latest request's provider-counted context for one session. */
export interface SessionContextReading {
  /** Provider's own input count for the most recent request. Never a sum. */
  contextTokens: number;
  /**
   * The window the harness reported. Present for codex (`model_context_window`)
   * and derivable for muse; absent for claude, which reports none — absent
   * means "resolve it from the model id", not "unknown".
   */
  contextWindow: number | null;
  /** Null means this harness recorded no compaction for this session. */
  compaction: CompactionMarker | null;
}

/**
 * Parsed readings keyed by file path, invalidated on mtime — the same shape as
 * usageFileCache in usage-routes.ts, and for the same reason.
 *
 * Without it every context-breakdown request re-read and re-parsed the whole
 * transcript on the event loop: measured at 72-93ms on a real 28MB claude
 * session. Session logs are append-only, so mtime is a sound key.
 *
 * A cache miss (every first chat open, and every open after a turn) still
 * readFileSync'd the whole transcript until 2026-09-25, blocking every other
 * request for as long as the parse took. Reads are now async and streamed in
 * 1 MiB chunks, so the loop is released between chunks.
 */
const readingCache = new Map<string, { mtimeMs: number; reading: SessionContextReading | null }>();

type Lines = AsyncIterable<string>;
type ParseLines = (lines: Lines) => Promise<SessionContextReading | null>;

/**
 * Parse `filePath` unless its mtime is unchanged since the last parse. Only
 * lines containing one of `keys` reach the parser: every record a parser acts
 * on names its key literally, so this skips JSON.parse of tool output and
 * prose (most of a transcript) without changing any reading.
 */
async function cachedRead(
  filePath: string,
  keys: readonly string[],
  parse: ParseLines
): Promise<SessionContextReading | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.promises.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
  const hit = readingCache.get(filePath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.reading;
  const reading = await parse(readLines(filePath, keys));
  readingCache.set(filePath, { mtimeMs, reading });
  return reading;
}

async function* readLines(filePath: string, keys: readonly string[]): Lines {
  for await (const { text } of readJsonlLines(filePath, 0)) {
    if (keys.some((key) => text.includes(key))) yield text;
  }
}

function parseLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * claude. Context is `input_tokens + cache_read_input_tokens +
 * cache_creation_input_tokens` — claude reports cache hits in SEPARATE fields,
 * so they must be added back. (`input_tokens` alone is only the uncached
 * remainder and reads as low as 2 on a fully cached turn.)
 *
 * Subagent rows (`isSidechain`) measure the SUBAGENT's context, not this
 * thread's, and must be excluded. Note the billing parser in usage-routes.ts
 * deliberately does NOT exclude them — you pay for subagent tokens — which is
 * why the two parsers cannot share an accumulator.
 *
 * Compaction rides a first-class record: `{type:'system',
 * subtype:'compact_boundary', compactMetadata:{...}}`.
 */
async function readClaudeContext(sessionId: string): Promise<SessionContextReading | null> {
  const found = await findClaudeSessionFile(sessionId);
  if (!found) return null;
  return cachedRead(found.path, ['"usage"', 'compact_boundary'], parseClaudeLines);
}

async function parseClaudeLines(lines: Lines): Promise<SessionContextReading | null> {
  let contextTokens: number | null = null;
  let count = 0;
  let preTokens: number | null = null;
  let postTokens: number | null = null;
  let trigger: string | null = null;

  for await (const line of lines) {
    const entry = parseLine(line);
    if (!entry) continue;

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      count += 1;
      const meta = entry.compactMetadata as Record<string, unknown> | undefined;
      preTokens = num(meta?.preTokens);
      postTokens = num(meta?.postTokens);
      trigger = typeof meta?.trigger === 'string' ? meta.trigger : null;
      continue;
    }

    if (entry.type !== 'assistant' || entry.isSidechain === true) continue;
    const usage = (entry.message as Record<string, unknown> | undefined)?.usage as
      | Record<string, unknown>
      | undefined;
    if (!usage) continue;
    const input = num(usage.input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    if (input === null && cacheRead === null && cacheWrite === null) continue;
    // Last main-thread row wins: that is the newest real request.
    contextTokens = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  }

  if (contextTokens === null) return null;
  return {
    contextTokens,
    // claude reports no window anywhere in the transcript; the caller resolves
    // it from the model id.
    contextWindow: null,
    compaction: count > 0 ? { count, preTokens, postTokens, trigger } : null,
  };
}

/**
 * codex. Context is `input_tokens` ALONE — codex reports one total with
 * `cached_input_tokens` as a SUBSET of it, the opposite of claude. Adding the
 * cache here would double-count.
 *
 * The `token_count` record carries all three things the meter needs:
 * `last_token_usage` (this request), `total_token_usage` (the cumulative sum
 * usage-routes bills from) and `model_context_window` (the denominator).
 *
 * TRAP: the token_count immediately following a `compacted` record reports
 * input_tokens 0 — a reset sentinel, not a request. Taking it would drop the
 * meter to empty for one tick before it refills, so zero readings are skipped.
 */
async function readCodexContext(sessionId: string): Promise<SessionContextReading | null> {
  const filePath = await findCodexSessionFile(sessionId);
  if (!filePath) return null;
  return cachedRead(filePath, ['token_count', 'compacted'], parseCodexLines);
}

async function parseCodexLines(lines: Lines): Promise<SessionContextReading | null> {
  let contextTokens: number | null = null;
  let contextWindow: number | null = null;
  let count = 0;

  for await (const line of lines) {
    const entry = parseLine(line);
    if (!entry) continue;
    const payload = entry.payload as Record<string, unknown> | undefined;
    // `compacted` is tagged at the TOP level, not inside payload -- the payload
    // holds replacement_history / window_number / latest_token_usage_record.
    // Checking payload.type found 0 of the 21 boundaries in a real rollout.
    if (entry.type === 'compacted') {
      count += 1;
      continue;
    }
    if (entry.type !== 'event_msg' || payload?.type !== 'token_count') continue;
    const info = payload.info as Record<string, unknown> | undefined;
    if (!info) continue;
    contextWindow = num(info.model_context_window) ?? contextWindow;
    const last = info.last_token_usage as Record<string, unknown> | undefined;
    const input = num(last?.input_tokens);
    // Skip the post-compaction reset sentinel; keep the last REAL request.
    if (input !== null && input > 0) contextTokens = input;
  }

  if (contextTokens === null) return null;
  return {
    contextTokens,
    contextWindow,
    // codex records the boundary but no pre/post token counts alongside it.
    compaction: count > 0 ? { count, preTokens: null, postTokens: null, trigger: null } : null,
  };
}

/**
 * opencode. Context is `tokens.input + tokens.cache.read + tokens.cache.write`
 * (its own `total` folds in output and reasoning, so it is not a context size).
 * One JSON file per message; the newest assistant message is the latest
 * request.
 */
async function readOpenCodeContext(sessionId: string): Promise<SessionContextReading | null> {
  const dir = path.join(
    os.homedir(),
    '.local',
    'share',
    'opencode',
    'storage',
    'message',
    sessionId
  );
  let files: string[];
  try {
    files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  let newestMs = -1;
  let contextTokens: number | null = null;

  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.join(dir, file), 'utf-8'));
      if (parsed?.role !== 'assistant') continue;
      const created = num(parsed?.time?.created) ?? num(parsed?.time?.completed) ?? 0;
      if (created < newestMs) continue;
      const tokens = parsed?.tokens;
      const input = num(tokens?.input);
      const cacheRead = num(tokens?.cache?.read);
      const cacheWrite = num(tokens?.cache?.write);
      if (input === null && cacheRead === null && cacheWrite === null) continue;
      newestMs = created;
      contextTokens = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
    } catch {
      /* a message file may be mid-write */
    }
  }

  if (contextTokens === null) return null;
  // opencode records no compaction marker of its own.
  return { contextTokens, contextWindow: null, compaction: null };
}

/**
 * muse. `muse exec --json` omits token fields from stdout entirely, so the
 * durable log is the ONLY source — this is the harness the live usage event
 * cannot cover, and the reason the file path is not merely an optimisation.
 *
 * Context is `input_tokens` alone: `cached_tokens` is a subset of it (observed
 * input 23,158 with cache_read 22,641 on the request after a 22,690-token one).
 *
 * Muse reports thresholds rather than a window:
 * `strategy.target_budget_tokens` is the SOFT threshold and
 * `config_fingerprint` carries the fraction it represents, so the window is
 * recoverable as target / soft.
 */
async function findMuseSessionFile(sessionId: string): Promise<string | null> {
  const root = path.join(os.homedir(), '.local', 'share', 'muse', 'sessions');
  try {
    for (const year of await fs.promises.readdir(root, { withFileTypes: true })) {
      if (!year.isDirectory()) continue;
      const yearPath = path.join(root, year.name);
      for (const month of await fs.promises.readdir(yearPath, { withFileTypes: true })) {
        if (!month.isDirectory()) continue;
        const monthPath = path.join(yearPath, month.name);
        for (const day of await fs.promises.readdir(monthPath, { withFileTypes: true })) {
          if (!day.isDirectory()) continue;
          const candidate = path.join(monthPath, day.name, sessionId, 'session.jsonl');
          try {
            if ((await fs.promises.stat(candidate)).isFile()) return candidate;
          } catch {
            /* not in this day dir */
          }
        }
      }
    }
  } catch {
    /* ~/.local/share/muse/sessions may not exist */
  }
  return null;
}

/** Recover muse's window from the soft threshold and the fraction it encodes. */
function museWindowFrom(strategy: Record<string, unknown> | undefined): number | null {
  const target = num(strategy?.target_budget_tokens);
  if (target === null || target <= 0) return null;
  const fingerprint =
    typeof strategy?.config_fingerprint === 'string' ? strategy.config_fingerprint : '';
  const soft = Number.parseFloat(/soft=([0-9.]+)/.exec(fingerprint)?.[1] ?? '');
  if (!Number.isFinite(soft) || soft <= 0 || soft > 1) return null;
  return Math.round(target / soft);
}

async function readMuseContext(sessionId: string): Promise<SessionContextReading | null> {
  const filePath = await findMuseSessionFile(sessionId);
  if (!filePath) return null;
  return cachedRead(filePath, ['runtime.session'], parseMuseLines);
}

async function parseMuseLines(lines: Lines): Promise<SessionContextReading | null> {
  let contextTokens: number | null = null;
  let contextWindow: number | null = null;
  let count = 0;
  let trigger: string | null = null;

  for await (const line of lines) {
    const entry = parseLine(line);
    if (!entry || entry.payload_type !== 'runtime.session') continue;
    const event = (entry.payload as Record<string, unknown> | undefined)?.event as
      | Record<string, unknown>
      | undefined;
    if (!event) continue;

    if (event.kind === 'model_completed') {
      const input = num((event.usage as Record<string, unknown> | undefined)?.input_tokens);
      if (input !== null) contextTokens = input;
      continue;
    }

    if (event.kind === 'context_compaction_candidate') {
      const strategy = event.strategy as Record<string, unknown> | undefined;
      contextWindow = museWindowFrom(strategy) ?? contextWindow;
      // A candidate is only a compaction once it actually finished. Observed
      // statuses on a real durable log are `running`, `failed` and
      // `succeeded` -- counting anything else reports a compaction that never
      // happened, and `failed` in particular dropped no history at all.
      if (event.status === 'succeeded') {
        count += 1;
        trigger = typeof event.trigger === 'string' ? event.trigger : trigger;
      }
    }
  }

  if (contextTokens === null) return null;
  return {
    contextTokens,
    contextWindow,
    compaction: count > 0 ? { count, preTokens: null, postTokens: null, trigger } : null,
  };
}

/**
 * Thin dispatcher: the session id itself says nothing about which harness wrote
 * it, so each reader is asked in turn and the first that finds its own file
 * answers. Each reader owns exactly one harness's conventions.
 */
const READERS: ReadonlyArray<(sessionId: string) => Promise<SessionContextReading | null>> = [
  readClaudeContext,
  readCodexContext,
  readOpenCodeContext,
  readMuseContext,
];

/**
 * Latest provider-counted context for a session, or null when no harness log
 * matches. Never throws: the meter must never break the conversation read.
 */
export async function lookupSessionContext(
  sessionId: string
): Promise<SessionContextReading | null> {
  if (!sessionId) return null;
  for (const read of READERS) {
    try {
      const reading = await read(sessionId);
      if (reading) return reading;
    } catch {
      /* try the next harness */
    }
  }
  return null;
}
