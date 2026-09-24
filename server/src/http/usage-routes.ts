import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Provider as ProviderName } from '@unleashd/shared';
import type { Express, Request, Response } from 'express';
import { USAGE_CACHE_TTL_MS } from '../constants/timeouts';

// =============================================================================
// GET /api/usage — Aggregate token usage from Claude + Codex + OpenCode sessions.
//
// Reads persisted files on disk, sums token counts, and computes approximate cost.
// Claude: ~/.claude/projects/**/*.jsonl → assistant entries with message.usage
// Codex:  ~/.codex/sessions/**/*.jsonl  → event_msg with payload.type=token_count
// OpenCode: ~/.local/share/opencode/storage/message/{session-id}/*.json
//
// Query params:
//   ?days=N  — only include sessions from the last N days (default: 30)
// =============================================================================

interface UsageEntry {
  sessionId: string;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  date: string; // YYYY-MM-DD
}

// Approximate pricing per 1M tokens (as of early 2026).
// Claude: input $3, output $15, cache read $0.30, cache write $3.75
// Codex: input $2.50, cached input $0.25, output $10. OpenAI bills cached input
// at a tenth of the input rate; until 2026-09-25 every Codex token was priced
// as uncached, overstating Codex spend several-fold (~97% of it is cached).
function estimateCost(
  provider: ProviderName,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number
): number {
  if (provider === 'claude') {
    return (input * 3 + output * 15 + cacheRead * 0.3 + cacheWrite * 3.75) / 1_000_000;
  }
  // Codex/OpenAI and OpenCode (provider-backed model pricing can vary by backend).
  // Gemini mirrors Codex-like pricing here until token billing data is emitted per-provider.
  return (input * 2.5 + output * 10 + cacheRead * 0.25) / 1_000_000;
}

// Per-session cached usage data so we don't re-read unchanged files.
// Maps filePath → { mtimeMs, data }. Survives across requests.
const usageFileCache = new Map<
  string,
  { mtimeMs: number; data: UsageEntry & { timestampedTokens: { ts: number; tokens: number }[] } }
>();
const openCodeUsageCache = new Map<
  string,
  { mtimeMs: number; data: UsageEntry & { lastTimestampMs: number } }
>();

// Full response cache — avoids re-aggregating when nothing changed.
// Key is `days` param. Invalidated after USAGE_CACHE_TTL_MS.
interface RateLimit {
  label: string;
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  tokenCount?: number;
}
interface UsageResponse {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSessions: number;
  days: number;
  daily: {
    date: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    sessions: number;
  }[];
  topSessions: UsageEntry[];
  rateLimits: Record<ProviderName, RateLimit[]>;
}
const usageResponseCache = new Map<number, { time: number; data: UsageResponse }>();
// Parse a single Claude JSONL file. Returns cached result if mtime unchanged.
// Exported for the per-conversation context-breakdown meter (same parser,
// scoped to one session id instead of aggregated across all sessions).
export function parseClaudeSession(
  filePath: string,
  stat: fs.Stats
): UsageEntry & { timestampedTokens: { ts: number; tokens: number }[] } {
  const cached = usageFileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;

  const sessionId = path.basename(filePath, '.jsonl');
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let model = 'unknown';
  const timestampedTokens: { ts: number; tokens: number }[] = [];

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'assistant' && entry.message?.usage) {
        const u = entry.message.usage;
        const inTok = u.input_tokens ?? 0;
        const outTok = u.output_tokens ?? 0;
        inputTokens += inTok;
        outputTokens += outTok;
        cacheRead += u.cache_read_input_tokens ?? 0;
        cacheWrite += u.cache_creation_input_tokens ?? 0;
        if (entry.message.model && model === 'unknown') {
          model = entry.message.model;
        }
        if (entry.timestamp) {
          timestampedTokens.push({
            ts: new Date(entry.timestamp).getTime(),
            tokens: inTok + outTok,
          });
        }
      }
    } catch {
      /* skip malformed lines */
    }
  }

  const date = stat.mtime.toISOString().slice(0, 10);
  const data: UsageEntry & { timestampedTokens: { ts: number; tokens: number }[] } = {
    sessionId,
    provider: 'claude',
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: estimateCost('claude', inputTokens, outputTokens, cacheRead, cacheWrite),
    date,
    timestampedTokens,
  };
  usageFileCache.set(filePath, { mtimeMs: stat.mtimeMs, data });
  return data;
}

function parseOpenCodeSessionUsage(
  sessionDirPath: string
): (UsageEntry & { lastTimestampMs: number }) | null {
  const messageFiles = fs.readdirSync(sessionDirPath).filter((f) => f.endsWith('.json'));
  if (messageFiles.length === 0) {
    return null;
  }

  let maxMtimeMs = 0;
  for (const file of messageFiles) {
    try {
      const stat = fs.statSync(path.join(sessionDirPath, file));
      if (stat.mtimeMs > maxMtimeMs) {
        maxMtimeMs = stat.mtimeMs;
      }
    } catch {
      // File may disappear between readdir and stat/read.
    }
  }

  const cached = openCodeUsageCache.get(sessionDirPath);
  if (cached && cached.mtimeMs === maxMtimeMs) {
    return cached.data;
  }

  const sessionId = path.basename(sessionDirPath);
  let model = 'unknown';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let lastTimestampMs = 0;
  let hasUsage = false;

  for (const file of messageFiles) {
    const filePath = path.join(sessionDirPath, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed?.role !== 'assistant') {
        continue;
      }

      const inTok = typeof parsed?.tokens?.input === 'number' ? parsed.tokens.input : 0;
      const outTok = typeof parsed?.tokens?.output === 'number' ? parsed.tokens.output : 0;
      const cacheRead =
        typeof parsed?.tokens?.cache?.read === 'number' ? parsed.tokens.cache.read : 0;
      const cacheWrite =
        typeof parsed?.tokens?.cache?.write === 'number' ? parsed.tokens.cache.write : 0;
      const messageCost = typeof parsed?.cost === 'number' ? parsed.cost : 0;

      inputTokens += inTok;
      outputTokens += outTok;
      cacheReadTokens += cacheRead;
      cacheWriteTokens += cacheWrite;
      costUsd += messageCost;

      if (inTok + outTok + cacheRead + cacheWrite > 0 || messageCost > 0) {
        hasUsage = true;
      }

      const providerID = typeof parsed?.providerID === 'string' ? parsed.providerID : null;
      const modelID = typeof parsed?.modelID === 'string' ? parsed.modelID : null;
      if (model === 'unknown') {
        if (providerID && modelID) model = `${providerID}/${modelID}`;
        else if (modelID) model = modelID;
        else if (providerID) model = providerID;
      }

      const completedTs = typeof parsed?.time?.completed === 'number' ? parsed.time.completed : 0;
      const createdTs = typeof parsed?.time?.created === 'number' ? parsed.time.created : 0;
      const ts = Math.max(completedTs, createdTs);
      if (ts > lastTimestampMs) {
        lastTimestampMs = ts;
      }
    } catch {
      // Skip malformed/unreadable message file.
    }
  }

  if (!hasUsage) {
    return null;
  }

  if (costUsd === 0) {
    costUsd = estimateCost(
      'opencode',
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens
    );
  }

  const fallbackTs = maxMtimeMs > 0 ? maxMtimeMs : Date.now();
  const date = new Date(lastTimestampMs > 0 ? lastTimestampMs : fallbackTs)
    .toISOString()
    .slice(0, 10);

  const data: UsageEntry & { lastTimestampMs: number } = {
    sessionId,
    provider: 'opencode',
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
    date,
    lastTimestampMs: lastTimestampMs > 0 ? lastTimestampMs : fallbackTs,
  };

  openCodeUsageCache.set(sessionDirPath, { mtimeMs: maxMtimeMs, data });
  return data;
}

export interface SessionProviderUsage {
  sessionId: string;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Provider-priced cumulative input (re-read across turns, not one turn's stack). */
  cumulativeInputTokens: number;
}

// Codex `token_count` events carry the session's latest cumulative totals, so the
// last one wins. `cached_input_tokens` is a SUBSET of `input_tokens`; split it out
// so `input` means uncached input, as it does for Claude.
type CodexTokenTotals = { input: number; cacheRead: number; output: number };

function codexTokenTotals(content: string): CodexTokenTotals | null {
  let totals: CodexTokenTotals | null = null;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (
        entry.type === 'event_msg' &&
        entry.payload?.type === 'token_count' &&
        entry.payload.info?.total_token_usage
      ) {
        const u = entry.payload.info.total_token_usage;
        const cacheRead = u.cached_input_tokens ?? 0;
        totals = {
          input: (u.input_tokens ?? 0) - cacheRead,
          cacheRead,
          output: u.output_tokens ?? 0,
        };
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return totals;
}

function parseCodexTokenTotals(filePath: string): CodexTokenTotals | null {
  try {
    return codexTokenTotals(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Recover a codex session id from its rollout filename.
 *
 * Codex writes `rollout-<timestamp>-<sessionId>.jsonl`, and has used two
 * timestamp shapes (`...T11-22-44-` and an older `...T11-14-43-024Z-`).
 * Stripping only the extension left the whole `rollout-<timestamp>-` prefix
 * glued to the id, so UsagePanel's `sessionId.slice(0, 8)` rendered the
 * literal string "rollout-" for EVERY codex row instead of its id. Anchoring
 * on the trailing UUID resolves both shapes; a bare `<sessionId>.jsonl` (the
 * form `findCodexSessionFile` also accepts) passes through unchanged.
 */
const CODEX_ROLLOUT_NAME =
  /^rollout-.+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function codexSessionIdFromFilename(fileName: string): string {
  const base = fileName.replace(/\.jsonl$/, '');
  const rollout = base.match(CODEX_ROLLOUT_NAME);
  return rollout ? rollout[1] : base;
}

/**
 * Locate a codex rollout by session id. Exported so the context reader
 * (conversations/session-context.ts) asks the same question one way: that file
 * carries BOTH the cumulative totals this module bills from and the
 * per-request `last_token_usage` the context meter needs.
 */
export function findCodexSessionFile(sessionId: string): string | null {
  const codexDir = path.join(os.homedir(), '.codex', 'sessions');
  try {
    for (const year of fs.readdirSync(codexDir, { withFileTypes: true })) {
      if (!year.isDirectory()) continue;
      const yearPath = path.join(codexDir, year.name);
      for (const month of fs.readdirSync(yearPath, { withFileTypes: true })) {
        if (!month.isDirectory()) continue;
        const monthPath = path.join(yearPath, month.name);
        for (const day of fs.readdirSync(monthPath, { withFileTypes: true })) {
          if (!day.isDirectory()) continue;
          const dayPath = path.join(monthPath, day.name);
          // Codex names rollouts `rollout-<timestamp>-<sessionId>.jsonl`, NOT
          // `<sessionId>.jsonl`. Probing the bare name matched zero files on a
          // real ~/.codex/sessions tree, so this lookup silently never
          // resolved and every codex thread fell back to estimates.
          try {
            for (const file of fs.readdirSync(dayPath)) {
              if (!file.endsWith('.jsonl')) continue;
              if (file === `${sessionId}.jsonl` || file.endsWith(`-${sessionId}.jsonl`)) {
                return path.join(dayPath, file);
              }
            }
          } catch {
            /* day dir may vanish between readdir and read */
          }
        }
      }
    }
  } catch {
    /* ~/.codex/sessions may not exist */
  }
  return null;
}

/**
 * Locate a claude transcript by session id. The basename IS the session id, but
 * the project directory is a lossy encoding of the cwd, so the only reliable
 * lookup is a scan across project dirs. Exported for the same reason as
 * findCodexSessionFile.
 */
export function findClaudeSessionFile(sessionId: string): { path: string; stat: fs.Stats } | null {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const project of fs.readdirSync(claudeDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const candidate = path.join(claudeDir, project.name, `${sessionId}.jsonl`);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return { path: candidate, stat };
      } catch {
        /* not in this project dir */
      }
    }
  } catch {
    /* ~/.claude/projects may not exist */
  }
  return null;
}

/**
 * Provider usage for one CLI session id, reusing the aggregate usage parsers
 * (Claude assistant usage, Codex latest token_count totals, OpenCode assistant
 * tokens). Returns null when no provider file matches — the meter then shows
 * only our estimated stack. Never throws; never recomputes pricing.
 */
export function lookupProviderUsageForSession(sessionId: string): SessionProviderUsage | null {
  if (!sessionId) return null;

  // Claude: file basename is the session id.
  const claudeFile = findClaudeSessionFile(sessionId);
  if (claudeFile) {
    const data = parseClaudeSession(claudeFile.path, claudeFile.stat);
    return {
      sessionId,
      provider: 'claude',
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      cumulativeInputTokens: data.inputTokens + data.cacheReadTokens + data.cacheWriteTokens,
    };
  }

  // Codex: latest token_count totals are already cumulative for the session.
  const codexFile = findCodexSessionFile(sessionId);
  if (codexFile) {
    const totals = parseCodexTokenTotals(codexFile);
    if (totals) {
      return {
        sessionId,
        provider: 'codex',
        model: 'codex',
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadTokens: totals.cacheRead,
        cacheWriteTokens: 0,
        cumulativeInputTokens: totals.input + totals.cacheRead,
      };
    }
  }

  // OpenCode: session dir holds per-message assistant token usage.
  try {
    const sessionDir = path.join(
      os.homedir(),
      '.local',
      'share',
      'opencode',
      'storage',
      'message',
      sessionId
    );
    const usage = parseOpenCodeSessionUsage(sessionDir);
    if (usage) {
      return {
        sessionId,
        provider: 'opencode',
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        cumulativeInputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      };
    }
  } catch {
    /* opencode storage may not exist */
  }

  return null;
}

export function registerUsageRoutes(app: Express, providerNames: readonly ProviderName[]): void {
  app.get('/api/usage', async (_req: Request, res: Response) => {
    const days = Math.min(Math.max(Number.parseInt(String(_req.query.days)) || 30, 1), 365);

    // Check response cache
    const cached = usageResponseCache.get(days);
    if (cached && Date.now() - cached.time < USAGE_CACHE_TTL_MS) {
      res.json(cached.data);
      return;
    }

    // Response cache expired (or missing) — clear per-file caches so entries for
    // deleted files don't accumulate unboundedly across requests.
    usageFileCache.clear();
    openCodeUsageCache.clear();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffMs = cutoff.getTime();
    const now = Date.now();
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const entries: UsageEntry[] = [];
    let claude5hTokens = 0;
    let claudeWeeklyTokens = 0;

    // --- Claude sessions (single pass: usage entries + rate limit token counts) ---
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    try {
      const projectDirs = fs
        .readdirSync(claudeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(claudeDir, d.name));

      for (const projDir of projectDirs) {
        const jsonlFiles = fs.readdirSync(projDir).filter((f) => f.endsWith('.jsonl'));
        for (const file of jsonlFiles) {
          const filePath = path.join(projDir, file);
          const stat = fs.statSync(filePath);
          // Skip files older than both the query window AND the 7-day rate-limit window
          if (stat.mtimeMs < cutoffMs && stat.mtimeMs < sevenDaysAgo) continue;

          const data = parseClaudeSession(filePath, stat);

          // Usage entry (for the requested days window)
          if (stat.mtimeMs >= cutoffMs && data.inputTokens + data.outputTokens > 0) {
            entries.push(data);
          }

          // Rate limit token counts (5h + 7d windows)
          for (const { ts, tokens } of data.timestampedTokens) {
            if (ts >= sevenDaysAgo) claudeWeeklyTokens += tokens;
            if (ts >= fiveHoursAgo) claude5hTokens += tokens;
          }
        }
      }
    } catch {
      /* ~/.claude/projects may not exist */
    }

    // --- Codex sessions (single pass: usage entries + rate limits from most recent) ---
    const codexDir = path.join(os.homedir(), '.codex', 'sessions');
    const rateLimits = {} as Record<ProviderName, RateLimit[]>;
    for (const provider of providerNames) {
      rateLimits[provider] = [];
    }
    let newestCodexFile = '';
    let newestCodexMtime = 0;

    try {
      const years = fs
        .readdirSync(codexDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const year of years) {
        const months = fs
          .readdirSync(path.join(codexDir, year.name), { withFileTypes: true })
          .filter((d) => d.isDirectory());
        for (const month of months) {
          const dayDirs = fs
            .readdirSync(path.join(codexDir, year.name, month.name), { withFileTypes: true })
            .filter((d) => d.isDirectory());
          for (const day of dayDirs) {
            const dateStr = `${year.name}-${month.name}-${day.name}`;
            const dateMs = new Date(dateStr).getTime();
            // Skip entire day dirs that are too old for BOTH usage and rate limits
            if (dateMs < cutoffMs && dateMs < sevenDaysAgo) continue;

            const dayPath = path.join(codexDir, year.name, month.name, day.name);
            const files = fs.readdirSync(dayPath).filter((f) => f.endsWith('.jsonl'));
            for (const file of files) {
              const filePath = path.join(dayPath, file);
              const stat = fs.statSync(filePath);

              // Track most recent for rate limits
              if (stat.mtimeMs > newestCodexMtime) {
                newestCodexMtime = stat.mtimeMs;
                newestCodexFile = filePath;
              }

              // Only parse for usage if within the query window
              if (dateMs < cutoffMs) continue;

              const sessionId = codexSessionIdFromFilename(file);
              const totals = codexTokenTotals(fs.readFileSync(filePath, 'utf-8'));
              if (totals && totals.input + totals.cacheRead + totals.output > 0) {
                entries.push({
                  sessionId,
                  provider: 'codex',
                  model: 'codex',
                  inputTokens: totals.input,
                  outputTokens: totals.output,
                  cacheReadTokens: totals.cacheRead,
                  cacheWriteTokens: 0,
                  costUsd: estimateCost('codex', totals.input, totals.output, totals.cacheRead, 0),
                  date: dateStr,
                });
              }
            }
          }
        }
      }
    } catch {
      /* ~/.codex/sessions may not exist */
    }

    // --- OpenCode sessions (single pass: assistant message token usage from local storage) ---
    const openCodeMessageDir = path.join(
      os.homedir(),
      '.local',
      'share',
      'opencode',
      'storage',
      'message'
    );
    try {
      const openCodeSessionDirs = fs
        .readdirSync(openCodeMessageDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(openCodeMessageDir, d.name));

      for (const sessionDirPath of openCodeSessionDirs) {
        const usage = parseOpenCodeSessionUsage(sessionDirPath);
        if (!usage) {
          continue;
        }

        if (usage.lastTimestampMs < cutoffMs) {
          continue;
        }

        entries.push({
          sessionId: usage.sessionId,
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costUsd: usage.costUsd,
          date: usage.date,
        });
      }
    } catch {
      /* ~/.local/share/opencode/storage/message may not exist */
    }

    // Extract rate limits from the most recent Codex session file
    if (newestCodexFile) {
      try {
        const content = fs.readFileSync(newestCodexFile, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.type === 'event_msg' && entry.payload?.rate_limits) {
              const r = entry.payload.rate_limits;
              if (r.primary) {
                rateLimits.codex.push({
                  label: `${r.primary.window_minutes / 60}h limit`,
                  usedPercent: r.primary.used_percent,
                  windowMinutes: r.primary.window_minutes,
                  resetsAt: r.primary.resets_at ?? null,
                });
              }
              if (r.secondary) {
                rateLimits.codex.push({
                  label: 'Weekly limit',
                  usedPercent: r.secondary.used_percent,
                  windowMinutes: r.secondary.window_minutes,
                  resetsAt: r.secondary.resets_at ?? null,
                });
              }
              break;
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* file may have been deleted */
      }
    }

    // Claude rate limits from timestamped tokens (already computed in single pass above)
    if (claude5hTokens > 0 || claudeWeeklyTokens > 0) {
      rateLimits.claude.push({
        label: '5h window',
        usedPercent: 0,
        windowMinutes: 300,
        resetsAt: null,
        tokenCount: claude5hTokens,
      });
      rateLimits.claude.push({
        label: 'Weekly',
        usedPercent: 0,
        windowMinutes: 10080,
        resetsAt: null,
        tokenCount: claudeWeeklyTokens,
      });
    }

    // Aggregate by day
    const byDay = new Map<
      string,
      { inputTokens: number; outputTokens: number; costUsd: number; sessions: number }
    >();
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const e of entries) {
      totalCost += e.costUsd;
      totalInput += e.inputTokens;
      totalOutput += e.outputTokens;

      const existing = byDay.get(e.date);
      if (existing) {
        existing.inputTokens += e.inputTokens;
        existing.outputTokens += e.outputTokens;
        existing.costUsd += e.costUsd;
        existing.sessions += 1;
      } else {
        byDay.set(e.date, {
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          costUsd: e.costUsd,
          sessions: 1,
        });
      }
    }

    const daily = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({ date, ...data }));

    const sortedEntries = [...entries].sort((a, b) => b.costUsd - a.costUsd);
    const topSessions = sortedEntries.slice(0, 20);

    // Keep provider tabs useful even when one provider's sessions are lower-cost.
    const orderedProviders = providerNames;
    for (const provider of orderedProviders) {
      if (topSessions.some((entry) => entry.provider === provider)) {
        continue;
      }
      const providerTopSession = sortedEntries.find((entry) => entry.provider === provider);
      if (providerTopSession) {
        topSessions.push(providerTopSession);
      }
    }
    topSessions.sort((a, b) => b.costUsd - a.costUsd);

    const response: UsageResponse = {
      totalCostUsd: totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalSessions: entries.length,
      days,
      daily,
      topSessions,
      rateLimits,
    };

    usageResponseCache.set(days, { time: Date.now(), data: response });
    res.json(response);
  });
}
