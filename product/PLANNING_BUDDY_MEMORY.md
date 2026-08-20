# PLANNING_BUDDY_MEMORY.md — two primitives, four layers, three verbs

*Date: 2026-08-21 · Status: design agreed in conversation, not yet built · Owner: repo owner*
*Companion: `agent_notes/2026-08-21_memory-architecture-research_buddies-development-lead.md`*
*(as-built audit, measurements, OpenClaw/Hermes comparison, sources)*

## 1. Goal

A buddy should not start every thread from scratch. It should know what it has
learned, how it has been corrected, and what is currently in motion — without
loading a transcript archive, and without a second database.

The design is **two data structures**. Everything else is a view, a policy, or a
prompt.

```
versioned_doc = { path, version, body, reasoning, author, ts, supersedes }
append_note   = { ts, buddy, topic, kind, body, evidence[] }
```

## 2. The four layers

**Density is the axis, not recency.** A layer is dense *because* it is always
loaded; the log is allowed to be verbose *because* nothing loads it by default.
Each layer's constraint follows from its access mode instead of being arbitrary.

| layer | primitive | writer | dense | injected | cap |
|---|---|---|---|---|---|
| `SOUL.md` | versioned_doc | **human only** | yes | yes | 32 KB (existing) |
| `LONG_TERM_MEMORY.md` | versioned_doc | buddy, on promotion | yes | yes | ~8 KB |
| `WORKING_MEMORY.md` | versioned_doc | buddy, via review | yes | yes | ~2 KB |
| `agent_notes/` | append_note | buddy, freely | **no** | **never** | none |

- **SOUL** — behaviour and authority contract. Human-controlled. Evolves only on an
  explicit owner request ("change how you do X"), never autonomously.
- **LONG_TERM_MEMORY** — this buddy's durable operating knowledge. **Per-buddy, not
  per-repo.** Repo-level rules stay in `CLAUDE.md`/`AGENTS.md`, human-owned. Two
  competing operating-rule docs is the CSS-cascade failure mode again.
- **WORKING_MEMORY** — what is in motion: current themes, recent corrections, open
  loops. Rewritten, not appended.
- **agent_notes/** — append-only log of everything: attempts, failures, insights,
  decisions, evidence. Git-tracked, cross-agent visible, human-readable.

There is **no separate short-term store.** "Short-term" is `WORKING_MEMORY`, kept
current by the review procedure (§4).

## 3. Three verbs

| verb | does |
|---|---|
| `remember(note)` | append one note to `agent_notes/`, **and commit that file** |
| `recall(query, kind?, buddy?, since?)` | `rg` over `agent_notes/` + frontmatter filters |
| `update_memory(doc, content, reasoning)` | atomic rewrite of a versioned_doc, new version in the chain |

`recall` is **ripgrep, not an index.** At this corpus size an index is
unjustifiable: `rg` does 8,405 hits across a 124k-file repo in 0.20 s, and
`agent_notes/` will hold thousands of files at most. No index means no sync, no
staleness, no rebuild, it works from any harness, and a human can run the same
command. Add FTS5 or embeddings only when `rg` demonstrably fails to find
something.

Note format — frontmatter gives structure without a database:

```markdown
---
buddy: buddies-development-lead
date: 2026-08-21
kind: failure | decision | correction | insight
topic: mcp-harness-boundary
evidence: [server/src/buddies/mcp-server.ts:100, 6eb64eb]
---
```

Filed as `agent_notes/YYYY-MM-DD_topic_buddy-name.md`. The buddy suffix is new;
the 26 existing notes keep their `DATE_topic` names because four docs link them
by exact filename.

## 4. The review procedure (a prompt, not a tool)

Intelligence in the prompt; minimum in the tool list. The only API surface is the
atomic write.

> Read recent `agent_notes/`, recent commits, `LONG_TERM_MEMORY.md`,
> `WORKING_MEMORY.md`, the current diff, and this conversation. Decide whether
> working memory needs a tweak: a new theme, a correction to record, an open loop
> to close, or something to promote into long-term memory. If yes, call
> `update_memory` once with the full new body and your reasoning. If nothing
> changed, do nothing.

**When it runs** — decision open (§7). Conversation end and pre-compaction are the
OpenClaw-proven triggers; scheduled runs are already free via `buddy_automations`
(`job_kind: prompt` + cron), which is functionally OpenClaw's HEARTBEAT.

## 5. Injection rule

- **In:** `SOUL.md`, `LONG_TERM_MEMORY.md`, `WORKING_MEMORY.md` — all bounded, all dense.
- **Out:** `agent_notes/` — pull-only via `recall`.

Instead of injecting notes, the briefing carries **trigger instructions** (a few
lines, not kilobytes), the way Hermes prompts for `session_search`: reach for
`recall` when the user references prior work, when a decision looks previously
made, or before repeating an attempt that may have already failed.

If buddies later repeat corrected mistakes, the narrow exception is
`kind: correction` only — a small, actively-retired set. Start with nothing.

## 6. Caps are write-time invariants, not read-time truncation

`update_memory` **rejects** an over-cap body. It never silently trims.

This kills defect D1 by construction: today `boundedText` truncates from the
front while `remember` appends to the tail, so once `MEMORY.md` passes 4,200
characters every new curated fact silently stops reaching the briefing. A
write-time cap makes the bound an invariant of the document rather than a
read-time guess, per style rule T4 (no silent fallbacks).

The cap is also the forcing function that keeps the layers distinct. Unbounded
working memory becomes long-term memory becomes agent_notes.

## 7. Versioned document chain

```
profiles/<slug>/soul/
├── 001.md            immutable
├── 001.json          {author, requested_by, justification, evidence[], sha256, created_at}
├── 002.md
├── 002.json          {supersedes: "001", …}
└── current.json      {version: "002"}     ← NOT a symlink
```

Same shape for `LONG_TERM_MEMORY` and `WORKING_MEMORY`; only the writer differs.

`current` is a **DB column on `buddies` plus a readable `current.json` mirror**,
never a symlink — `#containedPath` rejects symlinks by design and
`v1.test.js:361` proves it. A symlink pointer would fight the safety property.

Rollback is a pointer write. Every revision keeps its justification attached, so
"why does this buddy behave this way" is answerable by reading the chain.

**Cost to accept:** rewrite-based memory can silently drop a fact in a way
append-only cannot. The version chain plus git means nothing is truly lost, but
the *live* doc can omit, and only the `reasoning` field will say why. That is the
price of density.

## 8. What gets deleted

- `MEMORY.md` / `journal/` / `archive/` / `index.json` — replaced by the three docs + the log.
- `compactMemory` and its ~140 lines of temp-file / backup / rollback-on-throw /
  sha256-ledger surgery. **Git is the ledger.** Compaction becomes "write version
  N+1, move the pointer."
- The `journal` \| `curated` kind split on `remember`.
- Any transcript indexing, seek-back locators, or FTS5 over `~/.codex/sessions`.
  Measured: 43.5 GB, ~1% of which is conversation, and the owner prunes it
  regularly — an index into it rots exactly when it is needed.

## 9. Open decisions

1. **Cap values.** ~2 KB working, ~8 KB long-term are guesses. Tune after first use.
2. **When the review runs** — conversation end, pre-compaction, scheduled, or on demand.
3. **Chain storage** — version files in git (greppable, git is the audit trail) vs rows
   with git holding only `current`. Leaning files.
4. **Cross-repo notes.** Notes about unleashd belong in `unleashd/agent_notes/` — they
   travel with the code. Buddy-level notes ("I was corrected for being too verbose")
   are not repo-scoped and need a home in the buddy's home workspace. Same format,
   same tool, destination chosen by scope.
5. **Correction retirement.** Corrections accumulate forever unless they can be closed
   or superseded.
6. **Git noise.** `remember` auto-committing one file per note on a feature branch —
   confirm this is acceptable before it becomes a habit.
7. **Privacy.** Notes are public in git and ship with the repo, including a buddy's
   record of its own failures.

## 10. Tests to write

Model on the existing good ones (`v1.test.js:361/439/464`,
`buddy-lifecycle-e2e.test.ts:17`) — falsifiable, real fixtures, no mirrors.

1. **Briefing assembly regression (D1).** Write a >4,200-char long-term doc, append a
   fresh fact, assert the fact appears in the briefing. This is the test whose absence
   let D1 ship.
2. **Write-time cap rejection.** `update_memory` over cap throws; the previous version
   remains current; nothing is partially written.
3. **Chain integrity.** N sequential updates leave N immutable versions, each with its
   reasoning, and `current` pointing at the last; rollback is a pointer move.
4. **`remember` commits its file.** After a `remember`, `git status` is clean for that
   path and the note is in `HEAD` — the §6 finding in the companion note.
5. **`recall` end-to-end** on a real fixture directory: frontmatter filter + body match,
   through the actual tool surface.
6. **Soul authority.** A buddy-authored `update_memory` against `SOUL.md` is refused;
   an owner-initiated one succeeds and appends to the chain.
