# Buddy memory: as-built audit, measured evidence, and external comparison

*Date: 2026-08-21 · Author: Buddies Development Lead (buddy) · Kind: insight + measurement*
*Companion: `product/PLANNING_BUDDY_MEMORY.md` (the design this note feeds)*

Append-only research log. Verbose on purpose — this is the layer that keeps the full
context so the dense docs don't have to. Nothing here is auto-injected into a briefing.

## 1. What we have today (as-built)

Buddy memory is **file-backed, not in SQLite**. The database stores only a path
(`buddies.memory_path`); the library performs every write so it can enforce path
containment (`~/git/buddies/docs/DESIGN.md` §3.3, `src/store.js:4261-4285`).

```
<memory_path>/            # profiles/<slug>/memory
├── MEMORY.md             # curated; dated sections, APPEND ONLY
├── journal/YYYY-MM-DD.md # one file per UTC day, append only
├── archive/YYYY-MM/…     # journal days retired by compaction
└── index.json            # compaction ledger, sha256 per archived source
```

| operation | where | notes |
|---|---|---|
| `readBuddyMemory` | `store.js:2492` | **not a tool** — server-side only |
| `remember` | `store.js:2521` | MCP tool `remember`, kinds `journal` \| `curated` |
| `compactMemory` | `store.js:2541` | MCP tool `compact_memory`; dry-run, sha256 dedupe, atomic w/ rollback |

Reading is not an action a buddy can take. `getBuddyContext` pulls memory and
`buildBriefing` splices it into the system prompt at conversation start
(`server/src/buddies/integration.ts:233-248`), under these caps:

- `BUDDY_MEMORY_SUMMARY_MAX_CHARACTERS` = 4,200
- `BUDDY_MEMORY_JOURNAL_MAX_CHARACTERS` = 1,800
- `BUDDY_BRIEFING_MAX_CHARACTERS` = 40,000
- journal lookback: 7 calendar days fetched, **3 most recent rendered**

### Soul is write-once

`BUDDY_SOUL.md` is written exactly once inside `hireDirectReport`
(`store.js:4077`), capped at 32 KB (`MAX_DIRECT_REPORT_SOUL_BYTES`). There is
**no update path at all** — not for the buddy, not for a human, not via HTTP.
The only other surface is `buddies buddy add --soul <path>` pointing at a
different file. The briefing instructs buddies to write a
`SOUL_CHANGE_PROPOSAL` journal entry for review; **nothing reads those entries.**

## 2. Two defects found

**D1 — curated memory silently stops reaching the buddy.**
`boundedText` truncates from the *front* (`integration.ts:19-22`), but both
`remember(kind:"curated")` and compaction **append** to `MEMORY.md`. Once that
file passes ~4,200 characters, every new curated fact lands past the cutoff and
never appears in a briefing again. No error, no signal. Compaction rolls up the
journal but never compacts `MEMORY.md` itself, so it only grows.
This is a silent fallback, which the repo style rules (rule T4) forbid.

**D2 — journal recall is calendar-based, not recency-based.**
`readBuddyMemory` walks back 7 UTC days from *today* (`store.js:2505-2517`). A
buddy that has not run in eight days gets `No recent journal entries.` even with
a full journal on disk. With no read/search tool, it cannot go looking.

## 3. Measured: the system is unused

| | content |
|---|---|
| buddies with a profile dir | **4 of 16** |
| total memory files on disk | **6 files, 24 KB** |
| `agent_notes/` | **28 substantive notes**, referenced by 4 docs |
| `conversation_links` | 77 |
| `buddy_projects` | 25 |

The formal memory system has accumulated ~nothing. `agent_notes/` is what agents
actually do when they learn something. **Migration cost from the current memory
layout is effectively zero.**

Also measured: **4 of 30 agent_notes were uncommitted** at the time of writing
(26 tracked / 30 on disk), two of them written that day. See §6.

## 4. Measured: why transcripts balloon

Motivation: could we search prior conversations instead of building memory?

| | |
|---|---|
| `~/.codex/sessions` | **43.5 GB**, 2,470 files |
| `~/.claude/projects` | 1.4 GB, 3,842 files |
| median codex file | **727 KB** |
| top 100 files | **27 GB — 62% of the corpus** |
| top 10 files | 6.2 GB |

Two regimes, two causes.

**Giant files** (sampled the 203 MB session `rollout-2026-05-21T12-59-52…`):

| type | bytes | detail |
|---|---|---|
| `response_item/function_call_output` | **132 MB (65%)** | 8,693 calls, avg 15 KB, **largest single output 6.6 MB** |
| `compacted` | 36 MB (18%) | 82 snapshots × ~430 KB |
| `response_item/reasoning` | 8.1 MB | |
| **`response_item/message`** | **2.2 MB (1.1%)** | the actual conversation |

**Ordinary mid-size files** (random sample of 60, 278 MB):

| type | share |
|---|---|
| `event_msg/token_count` | **26.9%** |
| `compacted` | 20.6% |
| `event_msg/patch_apply_end` | 16.6% |
| `function_call_output` | 9.0% |
| `custom_tool_call_output` | 6.5% |
| `world_state` | 4.7% |

Conclusion: **no format bloat, no VM artifacts.** It is (a) Codex writing a
`token_count`/rate-limit event *every turn* — 4,202 in one session at ~1 KB each
— plus `world_state`, plus a **full context snapshot on every compaction**; and
(b) a long tail of sessions where one tool call dumped megabytes. That 6.6 MB
`function_call_output` is a single command that catted a file or ran an
unbounded search — the same failure mode the repo's `rg`-not-`grep -r` rule
exists to prevent.

**Conversation is ~1% of the bytes.** Combined with the fact that the owner
prunes these directories regularly, this kills any design that indexes or points
into harness transcripts: the index rots exactly when it is needed. Memory must
be **extracted at write time**, self-contained, and survive transcript deletion.

## 5. External comparison

### OpenClaw

Six markdown files in the workspace, split by *who writes them*:

| file | writer | loaded |
|---|---|---|
| `AGENTS.md` | human | every system prompt |
| `SOUL.md` | **agent-writable, unguarded** | every wake |
| `IDENTITY.md`, `USER.md` | human, static | always |
| `HEARTBEAT.md` | human | polled every 30 min |
| `MEMORY.md` | **auto-managed, "not manually edited"** | private sessions only |
| `memory/YYYY-MM-DD.md` | agent, append-only | via search |

Two mechanisms we lack entirely:
- **`memory_search`** — hybrid vector + BM25, scoped to memory *files* (not transcripts).
- **Memory flush** — near context compaction, a silent turn tells the agent to write
  durable notes *before* compression. This is the short-term → long-term pump, and it
  is automatic rather than relying on agent diligence.

Their writable `SOUL.md` is explicitly flagged as the security hazard: anything
that can modify it can change who the agent is.

### Hermes (Nous Research)

Five pillars: memory, skills, soul, crons, self-improving loop.

- `MEMORY.md` (active projects, business context, ongoing work) + `USER.md` (stable
  profile) in `~/.hermes`, **both loaded at session start** — described as
  "preventing context amnesia."
- **`session_search`**: SQLite FTS5 over `~/.hermes/state.db` (`sessions`,
  `messages`, `messages_fts`). **No embeddings or vector search built in.**
  Four call shapes in one tool, mode-detected by arguments:
  - discovery `session_search(query=…, limit=3)`
  - scroll `session_search(session_id=…, around_message_id=…, window=10)`
  - read `session_search(session_id=…)`
  - browse `session_search()`
  `role_filter` defaults to `user,assistant` (tool output excluded as "usually
  noise"); adaptive detail hydrates only the top-ranked hit; results deduped by
  session lineage. 10–15 MB typical, 384 MB heavy.
- **v0.15.0 replaced an LLM-powered retrieval pipeline with pure FTS5** —
  discovery went ~90 s → ~20 ms (4,500×). They deleted the smart layer.
- Vector search exists only via **optional external providers** (Honcho,
  Hindsight, Supermemory, Mem0, OpenViking) — additive, one at a time.
- **Soul is edited on feedback**: "too verbose", "wrong tone" → the agent updates
  the file. Correction-driven, not autonomous drift.

### What neither has

Neither records **why** memory changed. OpenClaw's `MEMORY.md` is agent-edited;
Hermes updates silently from conversation. Recording a justification with every
mutation is the one place our design goes beyond both.

## 6. Operational finding: notes are not being committed

Other buddy sessions share this working tree. They commit, and they **reset** — on
2026-08-20 a concurrent session wiped a verified changeset out of the tree
(`git status` clean, no stash, nothing in reflog; reflog showed repeated
`reset: moving to <sha>` from other sessions). Guards now deny `git reset --hard`,
`filter-branch`, `filter-repo`, `rebase -i` on shared branches.

At the time of writing, 4 of 30 agent notes were untracked. If `agent_notes/`
becomes the memory substrate, **`remember` must commit the single note file it
wrote** (feature branch, no push). A note is a leaf file nobody else touches, so
one-file commits do not tangle with in-flight code changes.

## 7. Existing tests worth copying

Genuinely good, doctrine-compliant (falsifiable, not schema mirrors):

- `buddies/test/v1.test.js:361` — writes memory, symlinks `journal/` to an outside
  dir, asserts the write throws **and** nothing landed outside.
- `buddies/test/v1.test.js:439` — containment rechecked *after* configuration
  (root swapped between config and write).
- `buddies/test/v1.test.js:464` — compaction dry-run leaves all 9 files; real run
  archives exactly 2, writes the sha256 source list, re-run is idempotent.
- `server/test/buddy-lifecycle-e2e.test.ts:17` — real MCP client, real store,
  `remember` + `compact_memory` through the actual tool surface, across restart.

**Gap:** nothing tests briefing assembly, which is where D1 lives.

## Sources

- OpenClaw memory files — https://claw-packs.com/articles/memory-files-explained/
- OpenClaw HEARTBEAT/SOUL/memory guide — https://blink.new/blog/openclaw-heartbeat-soul-memory-configuration-guide-2026
- Hermes sessions docs — https://hermes-agent.nousresearch.com/docs/user-guide/sessions
- Hermes sessions.md — https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md
- Hermes memory providers — https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md
- Hermes 5-pillar architecture — https://www.mindstudio.ai/blog/hermes-agent-5-pillar-architecture-memory-skills-soul-crons
- session_search rebuild (4,500×) — https://hermes-tutorials.dev/blog/session-search-rebuild/
