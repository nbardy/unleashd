/**
 * Token audit: finds tokens we paid for that bought nothing new.
 *
 *   pnpm token-audit                    # last 2 days, sessions ranked by excess
 *   pnpm token-audit --days 7 --tag buddy
 *   pnpm token-audit --session <id>     # what each detector found in one session
 *   pnpm token-audit --json
 *
 * It never ranks by volume: a long thread or heavy use is not a finding.
 * Sessions are ranked by EXCESS: context sent twice, identical tool output
 * returned twice, and caches rewritten while they should have been warm.
 * Token figures are provider-reported; chars/4 estimates are marked "~".
 *
 * Reads the harness session logs directly (Claude: ~/.claude/projects,
 * Codex: ~/.codex/sessions). Read-only.
 *
 * Built 2026-09-25 after a briefing re-sent on every Buddy turn went unnoticed
 * for five days (5c081f5); detector 1 flags that class in one run.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------- canonical session model ----------

type Provider = 'claude' | 'codex';
/** One provider request. `fresh` = input not served from cache (uncached + cache write). */
type ProviderRequest = { at: number; fresh: number; cached: number; output: number };
type Text = { at: number; text: string };
type Session = {
  provider: Provider;
  id: string;
  file: string;
  cwd: string;
  requests: ProviderRequest[];
  /** User-role messages as the provider received them (ours and the owner's). */
  sent: Text[];
  toolOutputs: Text[];
  compactions: number[];
};

// ---------- readers (one per provider) ----------

/** Line by line in chunks: some Codex rollouts exceed V8's 512MB string limit. */
function* jsonLines(file: string): Generator<Record<string, any>> {
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(16 * 1024 * 1024);
  let pending = Buffer.alloc(0);
  try {
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      pending = Buffer.concat([pending, chunk.subarray(0, read)]);
      let newline = pending.indexOf(10);
      while (newline !== -1 || (read === 0 && pending.length > 0)) {
        const end = newline === -1 ? pending.length : newline;
        const line = pending.subarray(0, end).toString('utf8');
        pending = pending.subarray(end + 1);
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch {
            /* a partially written last line */
          }
        }
        newline = pending.indexOf(10);
      }
      if (read === 0) return;
    }
  } finally {
    fs.closeSync(fd);
  }
}

const at = (row: Record<string, any>) => Date.parse(row.timestamp ?? '') || 0;

function blockTexts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    typeof block?.text === 'string' ? [block.text] : typeof block === 'string' ? [block] : []
  );
}

function readClaude(file: string): Session {
  const session: Session = {
    provider: 'claude',
    id: path.basename(file, '.jsonl'),
    file,
    cwd: '',
    requests: [],
    sent: [],
    toolOutputs: [],
    compactions: [],
  };
  // One JSONL line per content block, each stamped with the same request usage.
  const counted = new Set<string>();
  for (const row of jsonLines(file)) {
    session.cwd ||= row.cwd ?? '';
    if (row.type === 'system' && row.subtype === 'compact_boundary')
      session.compactions.push(at(row));
    if (row.type === 'assistant' && row.message?.usage && !counted.has(row.message.id)) {
      counted.add(row.message.id);
      const u = row.message.usage;
      session.requests.push({
        at: at(row),
        fresh: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        cached: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
      });
    }
    if (row.type === 'user' && row.message?.role === 'user' && !row.isCompactSummary) {
      const content = row.message.content;
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      for (const block of blocks) {
        if (block?.type === 'tool_result') {
          const text = blockTexts(block.content).join('\n');
          if (text) session.toolOutputs.push({ at: at(row), text });
        } else if (typeof block?.text === 'string') {
          session.sent.push({ at: at(row), text: block.text });
        }
      }
    }
  }
  return session;
}

function readCodex(file: string): Session {
  const session: Session = {
    provider: 'codex',
    id: path.basename(file, '.jsonl').replace(/^rollout-.*?-(?=[0-9a-f]{8}-[0-9a-f]{4}-)/, ''),
    file,
    cwd: '',
    requests: [],
    sent: [],
    toolOutputs: [],
    compactions: [],
  };
  // token_count is emitted more than once per request; a request is a change in the total.
  let lastTotal = -1;
  for (const row of jsonLines(file)) {
    const p = row.payload ?? {};
    if (row.type === 'session_meta') session.cwd = p.cwd ?? '';
    if (row.type === 'compacted') session.compactions.push(at(row));
    if (row.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
      const total = p.info.total_token_usage?.total_tokens ?? 0;
      if (total === lastTotal) continue;
      lastTotal = total;
      const u = p.info.last_token_usage;
      const cached = u.cached_input_tokens ?? 0;
      session.requests.push({
        at: at(row),
        fresh: (u.input_tokens ?? 0) - cached,
        cached,
        output: u.output_tokens ?? 0,
      });
    }
    if (row.type === 'response_item' && p.type === 'message' && p.role === 'user') {
      session.sent.push({ at: at(row), text: blockTexts(p.content).join('\n') });
    }
    if (
      row.type === 'response_item' &&
      (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')
    ) {
      const text = typeof p.output === 'string' ? p.output : blockTexts(p.output).join('\n');
      if (text) session.toolOutputs.push({ at: at(row), text });
    }
  }
  return session;
}

function sessionFiles(days: number): { provider: Provider; file: string }[] {
  const since = Date.now() - days * 86_400_000;
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.jsonl') && fs.statSync(full).mtimeMs >= since) out.push(full);
    }
    return out;
  };
  return [
    ...walk(path.join(os.homedir(), '.claude', 'projects')).map((file) => ({
      provider: 'claude' as const,
      file,
    })),
    ...walk(path.join(os.homedir(), '.codex', 'sessions')).map((file) => ({
      provider: 'codex' as const,
      file,
    })),
  ];
}

function readSession(source: { provider: Provider; file: string }): Session {
  switch (source.provider) {
    case 'claude':
      return readClaude(source.file);
    case 'codex':
      return readCodex(source.file);
  }
}

// ---------- tags: what kind of conversation this is ----------

type Tag = 'buddy' | 'channel' | 'swarm' | 'other';

function tagOf(session: Session): Tag {
  const text = session.sent.map((s) => s.text).join('\n');
  if (/ in #\S+ \(list [^)]+\)/.test(text)) return 'channel';
  if (text.includes('unleashd:buddy-context-v2')) return 'buddy';
  if (text.includes('unleashd:swarm-prefix')) return 'swarm';
  return 'other';
}

// ---------- detectors (excess only) ----------

const RESEND_MIN_LINE = 80;
const TOOL_REPEAT_MIN = 1_000;
const REWRITE_MIN = 10_000;
const WARM_CACHE_MS = 5 * 60_000;
const approxTokens = (chars: number) => Math.round(chars / 4);

/** Provider requests after `from` and before the next compaction: how often a sent block is re-read. */
function rereads(session: Session, from: number): number {
  const until = session.compactions.find((c) => c > from) ?? Number.POSITIVE_INFINITY;
  return session.requests.filter((r) => r.at > from && r.at < until).length;
}

type Repeat = { preview: string; copies: number; excessChars: number; rereadTokens: number };

/** Detector 1: long lines sent again in a later message of the same session. */
function resentContext(session: Session): Repeat[] {
  const seen = new Map<string, Repeat>();
  const firstMessage = new Map<string, number>();
  session.sent.forEach((message, index) => {
    for (const raw of new Set(message.text.split('\n'))) {
      const line = raw.trim();
      if (line.length < RESEND_MIN_LINE) continue;
      const key = createHash('sha1').update(line).digest('hex');
      if (!firstMessage.has(key)) {
        firstMessage.set(key, index);
        continue;
      }
      const repeat = seen.get(key) ?? {
        preview: line.slice(0, 90),
        copies: 1,
        excessChars: 0,
        rereadTokens: 0,
      };
      repeat.copies += 1;
      repeat.excessChars += line.length;
      repeat.rereadTokens += approxTokens(line.length) * rereads(session, message.at);
      seen.set(key, repeat);
    }
  });
  return [...seen.values()];
}

/** Detector 2: identical large tool output returned again in the same session. */
function repeatedToolOutput(session: Session): Repeat[] {
  const seen = new Map<string, Repeat>();
  const first = new Set<string>();
  for (const output of session.toolOutputs) {
    if (output.text.length < TOOL_REPEAT_MIN) continue;
    const key = createHash('sha1').update(output.text).digest('hex');
    if (!first.has(key)) {
      first.add(key);
      continue;
    }
    const repeat = seen.get(key) ?? {
      preview: output.text.slice(0, 90).replace(/\s+/g, ' '),
      copies: 1,
      excessChars: 0,
      rereadTokens: 0,
    };
    repeat.copies += 1;
    repeat.excessChars += output.text.length;
    repeat.rereadTokens += approxTokens(output.text.length) * rereads(session, output.at);
    seen.set(key, repeat);
  }
  return [...seen.values()];
}

type Rewrite = { at: number; fresh: number; context: number; gapSeconds: number };

/**
 * Detector 3: a request that wrote most of its context fresh. Within the warm
 * window that is a bust (excess); after an idle gap it is expiry (reported,
 * not counted). The first request and the first after a compaction are starts.
 */
function rewrites(session: Session): { busts: Rewrite[]; expiries: Rewrite[] } {
  const busts: Rewrite[] = [];
  const expiries: Rewrite[] = [];
  session.requests.forEach((request, index) => {
    if (index === 0) return;
    const previous = session.requests[index - 1];
    if (session.compactions.some((c) => c > previous.at && c <= request.at)) return;
    const context = request.fresh + request.cached;
    if (request.fresh < REWRITE_MIN || request.fresh < context / 2) return;
    const rewrite = {
      at: request.at,
      fresh: request.fresh,
      context,
      gapSeconds: Math.round((request.at - previous.at) / 1000),
    };
    (request.at - previous.at < WARM_CACHE_MS ? busts : expiries).push(rewrite);
  });
  return { busts, expiries };
}

// ---------- report ----------

type Audit = {
  session: Session;
  tag: Tag;
  resent: Repeat[];
  toolRepeats: Repeat[];
  busts: Rewrite[];
  expiries: Rewrite[];
  startFresh: number;
  contextTokens: number;
  excessTokens: number;
};

function audit(session: Session): Audit {
  const resent = resentContext(session);
  const toolRepeats = repeatedToolOutput(session);
  const { busts, expiries } = rewrites(session);
  const sum = (items: { rereadTokens: number; excessChars: number }[]) =>
    items.reduce((total, item) => total + approxTokens(item.excessChars) + item.rereadTokens, 0);
  return {
    session,
    tag: tagOf(session),
    resent,
    toolRepeats,
    busts,
    expiries,
    startFresh: session.requests[0]?.fresh ?? 0,
    contextTokens: session.requests.reduce((total, r) => total + r.fresh + r.cached, 0),
    excessTokens: sum(resent) + sum(toolRepeats) + busts.reduce((t, b) => t + b.fresh, 0),
  };
}

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function printSummary(audits: Audit[], top: number): void {
  const total = (pick: (a: Audit) => number) => audits.reduce((t, a) => t + pick(a), 0);
  const context = total((a) => a.contextTokens);
  const excess = total((a) => a.excessTokens);
  console.log(
    `${audits.length} sessions · ${fmt(total((a) => a.session.requests.length))} requests · ${fmt(context)} input tokens · ~${fmt(excess)} excess (${context ? ((100 * excess) / context).toFixed(1) : 0}%)`
  );
  const byDetector: [string, number][] = [
    [
      're-sent context (~, incl. re-reads)',
      total((a) => a.resent.reduce((t, r) => t + approxTokens(r.excessChars) + r.rereadTokens, 0)),
    ],
    [
      'repeated tool output (~, incl. re-reads)',
      total((a) =>
        a.toolRepeats.reduce((t, r) => t + approxTokens(r.excessChars) + r.rereadTokens, 0)
      ),
    ],
    ['cache rewrites while warm (busts)', total((a) => a.busts.reduce((t, b) => t + b.fresh, 0))],
  ];
  for (const [name, tokens] of byDetector) console.log(`  ${name.padEnd(44)} ${fmt(tokens)}`);
  const expired = total((a) => a.expiries.reduce((t, b) => t + b.fresh, 0));
  console.log(`  (not counted) rewrites after idle gaps >5m    ${fmt(expired)}`);

  console.log(
    "\nStart cost: fresh input on a session's first request (the per-conversation floor)"
  );
  for (const tag of ['channel', 'buddy', 'swarm', 'other'] as const) {
    const starts = audits
      .filter((a) => a.tag === tag && a.session.requests.length)
      .map((a) => a.startFresh);
    if (starts.length)
      console.log(
        `  ${tag.padEnd(8)} ${String(starts.length).padStart(4)} sessions · median ${fmt(median(starts))}`
      );
  }

  console.log(`\nTop ${top} sessions by excess (not by size):`);
  for (const a of [...audits].sort((x, y) => y.excessTokens - x.excessTokens).slice(0, top)) {
    if (a.excessTokens === 0) break;
    const worst = [...a.resent, ...a.toolRepeats].sort(
      (x, y) => y.rereadTokens - x.rereadTokens
    )[0];
    console.log(
      `  ~${fmt(a.excessTokens).padStart(6)}  ${a.session.provider.padEnd(6)} ${a.tag.padEnd(7)} ${a.session.id.slice(0, 8)}  ${fmt(a.contextTokens).padStart(6)} ctx  ${path.basename(a.session.cwd)}`
    );
    if (worst) console.log(`           ×${worst.copies} "${worst.preview}"`);
    if (a.busts.length)
      console.log(
        `           ${a.busts.length} warm-cache rewrite(s), ${fmt(a.busts.reduce((t, b) => t + b.fresh, 0))} fresh`
      );
  }
  console.log('\nDrill in: pnpm token-audit --session <id>');
}

function printSession(a: Audit): void {
  const s = a.session;
  console.log(`${s.provider} ${s.id} (${a.tag}) ${s.cwd}\n${s.file}`);
  console.log(
    `${s.requests.length} requests · ${fmt(a.contextTokens)} input · start ${fmt(a.startFresh)} fresh · ${s.compactions.length} compaction(s) · ~${fmt(a.excessTokens)} excess`
  );
  const list = (title: string, items: Repeat[]) => {
    console.log(`\n${title}: ${items.length}`);
    for (const r of [...items].sort((x, y) => y.rereadTokens - x.rereadTokens).slice(0, 15))
      console.log(
        `  ×${r.copies}  +${fmt(r.excessChars)} chars  ~${fmt(r.rereadTokens)} re-read  "${r.preview}"`
      );
  };
  list('Re-sent context lines', a.resent);
  list('Repeated tool outputs', a.toolRepeats);
  console.log(`\nWarm-cache rewrites: ${a.busts.length}`);
  for (const b of a.busts)
    console.log(
      `  ${new Date(b.at).toISOString()}  ${fmt(b.fresh)} fresh of ${fmt(b.context)}  gap ${b.gapSeconds}s`
    );
  console.log(`Rewrites after idle gaps (expiry, not counted): ${a.expiries.length}`);
}

// ---------- entry ----------

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const days = Number(arg('days') ?? 2);
const top = Number(arg('top') ?? 15);
const sessionId = arg('session');
const tag = arg('tag');
const audits = sessionFiles(sessionId ? 30 : days)
  .filter((source) => !sessionId || path.basename(source.file).includes(sessionId))
  .map(readSession)
  .filter((s) => !sessionId || s.id.startsWith(sessionId))
  .map(audit)
  .filter((a) => !tag || a.tag === tag);

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      audits.map(({ session, ...rest }) => ({
        provider: session.provider,
        id: session.id,
        file: session.file,
        cwd: session.cwd,
        requests: session.requests.length,
        ...rest,
      })),
      null,
      2
    )
  );
} else if (sessionId) {
  if (audits.length === 0) console.log(`No session matching ${sessionId} in the last 30 days.`);
  for (const a of audits) printSession(a);
} else {
  printSummary(audits, top);
}
