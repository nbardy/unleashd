# PLANNING_MEMORY.md — Buddy memory: two primitives, four layers, three verbs

*Date: 2026-08-21 · Status: design agreed in conversation, not built · Owner: repo owner*
*Author: Buddies Development Lead*

**Companions**
- `agent_notes/2026-08-21_memory-architecture-research_buddies-development-lead.md`
  — as-built audit, all measurements, OpenClaw/Hermes comparison, sources.
- `product/buddies/PLANNING_PRIMITIVES.md` — coordination primitives; its locked
  decisions constrain this design (see §19).
- `agent_notes/2026-08-21_buddy-automations-reference.md` — the scheduler this
  design cannot lean on yet.

---

## 1. Goal

A buddy should not start every thread from scratch. It should know what it has
learned, how it has been corrected, and what is currently in motion — without
loading a transcript archive, and without a second database.

## 2. Design goals (falsifiable)

A proposal is measured against these. Each is testable; none is a slogan.

| # | Goal | How you'd falsify it |
|---|---|---|
| G1 | A buddy resuming after 30 days knows its open loops | Idle 30 days, start a thread, ask "what were you doing?" — today it answers nothing |
| G2 | Reading memory costs zero tool calls | Count tool calls before the first useful sentence |
| G3 | Every durable mutation carries a recorded reason | Pick any memory version; `reasoning` is non-empty |
| G4 | Nothing is silently dropped | No read-time truncation, no silent merge, no swallowed write |
| G5 | One buddy can find what another already learned | Buddy B searches, finds A's note, cites it |
| G6 | Memory survives transcript deletion | `rm -rf ~/.codex/sessions`; memory is intact and still useful |
| G7 | A human can read and edit every layer with `cat` and `$EDITOR` | No layer requires a tool to inspect |
| G8 | The whole system is inspectable with `rg` | No index to rebuild, no daemon to run |

## 3. Non-goals

- A memory *engine*. No embeddings, no vector store, no retrieval pipeline until
  `rg` demonstrably fails (§16.2, §16.3).
- Searching harness transcripts. Explicitly rejected on measured evidence (§16.1).
- A per-intent type system. Categories are open-ended strings (§19).
- Cross-machine sync. Git is the transport; nothing else.
- Automatic soul evolution. Souls change on request, never on drift (§10).

---

## 4. The two primitives

Everything below is a view, a policy, or a prompt over these.

```
versioned_doc = { path, version, body, reasoning, author, ts, supersedes }
append_note   = { ts, buddy, topic, kind, body, evidence[] }
```

A `versioned_doc` is **rewritten**; its history is the chain. An `append_note` is
**written once** and never edited; its history is the directory.

## 5. The four layers

**Density is the axis, not recency.** A layer is dense *because* it is always
loaded; the log is allowed to be verbose *because* nothing loads it by default.
Each layer's constraint follows from its access mode rather than being arbitrary
policy.

| layer | primitive | writer | dense | injected | cap |
|---|---|---|---|---|---|
| `BUDDY_SOUL.md` | versioned_doc | **human only** | yes | yes | 32 KB (existing) |
| `LONG_TERM_MEMORY.md` | versioned_doc | buddy, on promotion | yes | yes | ~8 KB |
| `WORKING_MEMORY.md` | versioned_doc | buddy, via review | yes | yes | ~2 KB |
| `agent_notes/` | append_note | buddy, freely | **no** | **never** | none |

- **SOUL** — behaviour and authority contract. Evolves only on an explicit owner
  request ("change how you do X"), never autonomously.
- **LONG_TERM_MEMORY** — this buddy's durable operating knowledge. **Per-buddy,
  not per-repo** (confirmed). Repo-level rules stay in `AGENTS.md`, human-owned;
  two competing operating-rule docs is the CSS-cascade failure mode again.
- **WORKING_MEMORY** — what is in motion: current themes, recent corrections,
  open loops. Rewritten, not appended.
- **agent_notes/** — append-only log of everything: attempts, failures, insights,
  decisions, evidence. Git-tracked, cross-agent visible, human-readable.

There is **no separate short-term store.** "Short-term" is `WORKING_MEMORY`,
kept current by the review procedure (§8).

### Where each lives

```
<buddy home workspace>/profiles/<slug>/
├── soul/            001.md 001.json 002.md 002.json current.json
├── long_term/       001.md 001.json …
└── working/         001.md 001.json …

<any workspace>/agent_notes/
└── YYYY-MM-DD_topic_<buddy-slug>.md
```

Notes live in the workspace they are **about** — they travel with the code they
describe. Buddy-level notes that are not repo-scoped ("I was corrected for being
too verbose") go in the buddy's home workspace. Same format, same tool, the
destination follows the subject.

---

## 6. Three verbs

| verb | does |
|---|---|
| `remember(topic, kind, body, evidence[])` | append one note to `agent_notes/`, **and commit that file** |
| `recall(pattern, scope?, since?)` | `rg` over `agent_notes/` + filename globs |
| `update_memory(doc, content, reasoning, base_version)` | compare-and-swap rewrite of a versioned_doc |

`recall` is **ripgrep, not an index.** At this corpus size an index is
unjustifiable: `rg` does 8,405 hits across a 124k-file repo in 0.20 s, and
`agent_notes/` will hold thousands of files at most. No index means no sync, no
staleness, no rebuild, it works from any harness, and a human can run the same
command by hand. Satisfies G8.

## 7. The filename is the index

The append-only layer is **file-separated** — one file per note, which is exactly
what `agent_notes/` already is. There is no journal file to append to and no
per-buddy memory tree.

```
agent_notes/YYYY-MM-DD_topic_<buddy-slug>.md
```

`date`, `topic`, and `buddy` live in the **filename only** — never also in
frontmatter. Encoding the same fact twice is the dual-encoding failure already on
the backlog (`manager`/`reports_to` in `buddy_relationships`: two rows meaning one
thing, the overview disagreeing with itself). The filename wins because `rg` can
filter on it without opening the file.

Frontmatter therefore shrinks to what a filename cannot carry:

```markdown
---
kind: failure          # open-ended string, NOT an enum — see §19
evidence: [server/src/buddies/mcp-server.ts:100, 6eb64eb]
---
```

`kind` is a free-text category. `failure`, `decision`, `correction`, `insight`
are conventions, not a sum type — per the locked "categories pass through"
decision and the existing hard rule that bespoke values travel verbatim as
`z.string()` with no shared enums.

**Scope by glob, anchored to the trailing segment.** `-g '*<slug>*'`
substring-matches across buddies (`growth-lead` inside `growth-lead-2`);
`-g '*_<slug>.md'` is exact because the buddy is always the last segment.

```bash
rg -n '<pattern>' agent_notes/                              # everyone, by topic
rg -n '<pattern>' -g '*_growth-lead.md' agent_notes/        # only this buddy
rg --files -g '*_growth-lead.md' agent_notes/ | sort | tail -20   # this buddy, recent
```

Default broad. Narrowing to your own notes is the *exception* — half the value of
a shared log is reading what another buddy already learned (G5).

**Implementation note:** `getBuddyContext` already returns the full buddy row, so
`slug` is available at runtime; the `BuddyRecord` interface in
`server/src/buddies/contract.ts` just omits it. One-line type addition.

---

## 8. The review procedure (a prompt, not a tool)

Intelligence in the prompt; minimum in the tool list. The only API surface is the
atomic write.

> Read recent `agent_notes/`, recent commits, `LONG_TERM_MEMORY.md`,
> `WORKING_MEMORY.md`, the current diff, and this conversation. Decide whether
> working memory needs a tweak: a new theme, a correction to record, an open loop
> to close, or something to promote into long-term memory. If yes, call
> `update_memory` once with the full new body and your reasoning. If nothing
> changed, do nothing.

**When it runs** — decision open (§18). Conversation end and pre-compaction are
the OpenClaw-proven triggers.

Scheduled runs are *not* free, contrary to a first reading. Per the automations
reference: `job_kind: loop` ships in code but has **never run in production**,
iterations cap at 10 and **throw** on exhaustion rather than checkpointing, and
spend is unenforced (`tokens_used` / `cost_usd` are zero across all 22 historical
runs). A scheduled review would inherit all three. Conversation-end is cheaper.

## 9. Injection rule

- **In:** `BUDDY_SOUL.md`, `LONG_TERM_MEMORY.md`, `WORKING_MEMORY.md` — all
  bounded, all dense. Satisfies G2.
- **Out:** `agent_notes/` — pull-only via `recall`.

Instead of injecting notes, the briefing carries **trigger instructions** (a few
lines, not kilobytes), the way Hermes prompts for `session_search`. The buddy's
own slug is interpolated in, so it knows the glob that selects its own notes:

> **YOUR NOTES** — `agent_notes/` holds one file per note, named
> `YYYY-MM-DD_topic_<buddy-slug>.md`. None of it is loaded for you; search it.
> `rg -n '<pattern>' agent_notes/` for everyone's notes on a topic;
> add `-g '*_<your-slug>.md'` to narrow to your own.
> Search before repeating an attempt that may have already failed, when the owner
> references prior work, or when a decision looks previously made.

If buddies later repeat corrected mistakes, the narrow exception is
`kind: correction` only — a small, actively-retired set. Start with nothing.

## 10. Caps are write-time invariants, not read-time truncation

`update_memory` **rejects** an over-cap body. It never silently trims. Satisfies G4.

This kills defect D1 by construction: today `boundedText` truncates from the
front while `remember` appends to the tail, so once `MEMORY.md` passes 4,200
characters every new curated fact silently stops reaching the briefing. A
write-time cap makes the bound an invariant of the document rather than a
read-time guess, per style rule T4 (no silent fallbacks).

The cap is also the forcing function that keeps the layers distinct. Unbounded
working memory becomes long-term memory becomes agent_notes.

## 11. Versioned document chain

```
profiles/<slug>/soul/
├── 001.md            immutable
├── 001.json          {author, requested_by, reasoning, evidence[], sha256, created_at}
├── 002.md
├── 002.json          {supersedes: "001", …}
└── current.json      {version: "002"}     ← NOT a symlink
```

Same shape for `long_term/` and `working/`; only the writer differs.

`current` is a **DB column on `buddies` plus a readable `current.json` mirror**,
never a symlink — `#containedPath` rejects symlinks by design and
`v1.test.js:361` proves it. A symlink pointer would fight the safety property.

Rollback is a pointer write. Every revision keeps its reasoning attached, so "why
does this buddy behave this way" is answerable by reading the chain (G3).

**Cost to accept:** rewrite-based memory can silently drop a fact in a way
append-only cannot. The chain plus git means nothing is truly *lost*, but the
live doc can omit, and only `reasoning` will say why. That is the price of
density, and it is why G3 is a goal rather than a nicety.

## 12. Concurrency: compare-and-swap, not last-write-wins

Two conversations for the same buddy can run at once — this checkout already
loses work to concurrent sessions. Both read `working/` v7, both write v8, one
silently wins. That is a G4 violation.

`update_memory` therefore takes `base_version` and performs a **compare-and-swap**:

```
if current.version != base_version:
    reject TypedError StaleMemoryWrite { current_version, your_base }
```

The buddy re-runs the review against the new current and writes again. No merge,
no silent overwrite, no lock — a typed refusal the caller can act on, which is
the T4-compliant shape. The chain makes the conflict *visible*: two versions with
the same `supersedes` would be the bug, and the CAS prevents it existing.

`remember` needs none of this. Notes are separate files with distinct names;
concurrent writers cannot collide. That is a second reason the append layer is
file-separated.

---

## 13. Worked examples

### 13.1 `WORKING_MEMORY.md` (~2 KB cap; this is ~900 bytes)

```markdown
---
version: 8
updated: 2026-08-21T18:04:00Z
---

## Themes
- Memory redesign: two primitives, three verbs. Design agreed, not built.
- The wait primitive is the one real coordination gap; memory sits on its
  critical path (scheduled runs have no continuity without it).

## Corrections
- 2026-08-21 — Do not propose enums for open-ended categories. Owner: "categories
  pass through." Applied to note `kind`.
- 2026-08-21 — Do not assume the scheduler is free. `job_kind: loop` has never
  run in production and throws at 10 iterations.

## Open loops
- 8 open decisions in PLANNING_MEMORY.md §18. Caps and review trigger are mine to
  propose; the rest are Owner calls.
- `vendor/agent-cli-tool`: 4 dirty files, no working `origin` remote — the
  documented submodule dance cannot run.
```

### 13.2 `LONG_TERM_MEMORY.md` (~8 KB cap; this is ~700 bytes)

```markdown
---
version: 3
updated: 2026-08-20T09:12:00Z
---

## How I work
- Measure before proposing. Three designs in this repo were re-derived from
  scratch because nobody wrote down the as-built state.
- Read `AGENTS.md`'s "Read before touching" table first — it is the index, and
  it had zero buddy rows until 2026-08-21.

## What I own
- The Buddies feature: coordination primitives, memory, direct reports,
  automations.

## Durable decisions
- No review type; intent travels as prose (2026-08-21, Owner).
- Soul is human-controlled. Propose changes; never self-edit.
- `rg` before any index. Build the index when `rg` fails, not before.
```

### 13.3 One `update_memory` call

```jsonc
{
  "doc": "working",
  "base_version": 7,
  "reasoning": "Owner rejected the `kind` enum, citing the locked categories-pass-through decision. That is a correction about how I design, not a fact about memory, so it belongs in Corrections rather than a note. Dropped the stale 'awaiting primitives handoff' loop — the handoff arrived and is reconciled.",
  "content": "…full new body…"
}
```

Result: `working/008.md` + `008.json`, `current.json` → `008`. `007.md` is
untouched forever. The reasoning is what a future reader (or you) uses to judge
whether the edit was sound.

### 13.4 One note

`agent_notes/2026-08-21_rtk-diff-is-not-a-patch_buddies-development-lead.md`

```markdown
---
kind: failure
evidence: [agent_notes/2026-08-20_buddy-mcp-partial.patch]
---

`git diff > x.patch` produces an unappliable file in this repo. The rtk hook
rewrites `git diff` to `rtk git diff`, which emits a token-compressed summary —
a `--- Changes ---` header and `// ... 118 lines omitted` markers, zero `@@`
hunks. The saved file looks recoverable and is not.

Use `rtk proxy git diff > x.patch` to bypass the hook.
```

---

## 14. Use cases, end to end

### UC1 — A correction survives into the next thread *(G1, G4)*
Owner: "stop proposing enums for open-ended categories." Buddy fixes the design
in-thread. At conversation end the review runs, sees a correction not yet
recorded, and calls `update_memory("working", …)` adding it under Corrections
with reasoning. Next thread: working memory is injected, the correction is in the
first 2 KB the buddy reads. It does not re-propose the enum.

*Today:* the correction dies with the transcript.

### UC2 — Resuming after two weeks *(G1)*
Buddy opens a thread with no prompt context. Working memory carries three open
loops and two themes; long-term memory carries how it works and what it owns. It
opens with "last thing open was the caps decision" instead of "what would you
like to work on?"

*Today:* `readBuddyMemory` walks back 7 calendar days, finds nothing, and the
briefing says `No recent journal entries.` (defect D2).

### UC3 — Learning from another buddy *(G5)*
Buddy is about to design a review workflow. Trigger instruction fires: a decision
may already exist. `rg -n 'review type' agent_notes/` returns the primitives note
authored by a different buddy. It reads the withdrawn `{kind:'review_passed'}`
proposal and does not re-propose it.

*Today:* exactly what failed in this design's own drafting — the primitives docs
sat untracked in the working tree and nothing pointed at them.

### UC4 — Owner requests a behaviour change *(G3, and §10)*
Owner: "be terser in status reports." That is soul, not memory. Buddy calls
`update_memory("soul", …)` with the owner request recorded in `requested_by`.
A new immutable version lands with reasoning; `current.json` moves. If it turns
out wrong, rollback is a pointer write and the old body is still on disk.

*Today:* impossible. `BUDDY_SOUL.md` is written once at hire and has no update
path for anyone.

### UC5 — Scheduled run, no human present
An automation wakes the buddy. Injected soul + long-term + working give it
continuity across runs. It works, writes notes, and the end-of-run review updates
working memory. The next run picks up from there.

*Today:* "no continuity across scheduled runs — memory is the only carrier, and
provisioning it is broken on the Lead itself."

### UC6 — Transcripts are pruned *(G6)*
Owner deletes `~/.codex/sessions` to reclaim 43.5 GB. Nothing breaks. No index
rots, no pointer dangles, no memory is lost — every note is self-contained and
every doc is a file in git.

*Today:* nothing depends on transcripts, so this already holds. It is listed
because the obvious alternative design (§16.1) would break it.

---

## 15. Failure modes

| # | Failure | Mitigation |
|---|---|---|
| F1 | Review writes garbage into working memory | Prior version immutable; rollback is a pointer write. `reasoning` makes a bad edit auditable rather than mysterious. |
| F2 | Two sessions update the same doc concurrently | CAS on `base_version`; typed `StaleMemoryWrite` refusal (§12). |
| F3 | Buddy renamed → its note glob stops matching | Notes are historical; old ones keep the old slug. Either `git mv` the back-catalogue or accept the seam. **Open (§18.5).** |
| F4 | Working memory drifts into contradicting long-term memory | Review reads both every time; contradiction is the trigger to promote or drop. Caps force the choice. |
| F5 | `agent_notes/` grows past useful `rg` output | Add `-m` limits and date-prefixed globs before adding an index. Revisit at ~5k notes. |
| F6 | Buddy over-writes notes (one per turn) | `remember` is discretionary and prompt-triggered on material events. If it spams, tighten the prompt, not the schema. |
| F7 | Auto-commit per note conflicts with in-flight work | One leaf file per commit, feature branch, no push. Nobody else touches that path. |
| F8 | Notes are public in git | Accepted. A buddy's record of its own failures ships with the repo. **Open (§18.8).** |
| F9 | Corrections accumulate forever | Needs a retirement mechanism — supersede or close. **Open (§18.6).** |
| F10 | Cap rejection blocks a legitimate large update | Rejection is typed and actionable: the buddy promotes or drops, which is the intended forcing function. Not silent. |

---

## 16. Alternatives considered and rejected

### 16.1 Index or search the harness transcripts
**Rejected on measured evidence.** `~/.codex/sessions` is 43.5 GB across 2,470
files; the top 100 files are 62% of it; one file is 203 MB. Of that, actual
conversation is **~1% of bytes** — the rest is per-turn `token_count` telemetry
(27% of ordinary files), full context snapshots on every compaction (21%), patch
payloads (17%), and unbounded tool output (a single 6.6 MB `function_call_output`).

Worse: the owner prunes these directories regularly. Any index or pointer into
them rots exactly when it is needed, silently. Memory must be **extracted at
write time**, self-contained, and survive deletion (G6).

### 16.2 Embeddings (local ollama) over transcripts or notes
**Rejected for now, cheap to add later.** Hermes replaced an LLM-powered
retrieval pipeline with pure FTS5 in v0.15.0 — ~90 s → ~20 ms, 4,500× — and ships
no built-in vector search. Agent transcripts are dense with *exact* tokens
(`conversationAtomFamily`, `tsc -b`, `ENOENT`) which embeddings blur.

`ollama` is on PATH here with **zero models pulled**, so it is a new dependency
and a daemon in the path of conversation assembly.

Where it *would* earn its keep is vocabulary mismatch over the small dense docs
("how was I corrected about auth" vs "shared-secret gate must stay first"). With
one notes directory, adding embeddings later is an extra index over the same
files — not a second system, and `recall` keeps its signature.

### 16.3 FTS5 index over notes
**Rejected as premature.** Justifiable at Hermes' scale (a `messages` table with
full content); not at ~28 notes growing to low thousands of markdown files. `rg`
is 0.20 s on a 124k-file repo. An index buys ranking and costs sync, staleness,
rebuild, and a code path that can be wrong. Revisit at F5.

### 16.4 Keep append-only `MEMORY.md`
**Rejected.** It can only grow, never get denser, and it is the direct cause of
defect D1. `compactMemory` exists to fight this and hand-rolls ~140 lines of
temp-file / backup / rollback / sha256-ledger surgery to emulate a database the
process already has open. Rewrite-with-reasoning is the missing operation; git is
the ledger.

### 16.5 Auto-inject notes into the briefing
**Rejected by the owner, and correctly.** Notes are the verbose layer; injecting
them destroys the density distinction that makes the other three layers work. The
Hermes answer — prompt triggers, not content — costs a few lines instead of
kilobytes.

### 16.6 A private per-buddy journal directory
**Rejected.** Measured: the existing memory system holds **24 KB across 6 files
for 4 of 16 buddies**, while `agent_notes/` holds 28 substantive notes. The
formal system is unused; the shared log is what agents actually do. Privacy is
not a real requirement for a single-owner repo, and a private layer forfeits G5.

### 16.7 Agent-writable soul (the OpenClaw model)
**Rejected.** OpenClaw's `SOUL.md` is agent-writable and its own documentation
flags the hazard: anything that can modify it can change who the agent is. Hermes
edits souls on explicit feedback, which is the model adopted here — owner-
requested change, versioned, with reasoning. Autonomous drift is the failure to
avoid.

### 16.8 Sprint-scoped documentation folders
**Rejected in favour of workstream folders.** `product/buddies/` and
`product/mobile/` age well; `product/sprint-2026-08-21/` would need every doc to
move next sprint. `agent_notes/` stays **flat** — the filename is the index
(§7), and subfolders would break every glob and the exact-filename links.

---

## 17. Rollout sequence

Four slices. The first two are independently shippable and fix live defects.

**Slice 1 — stop the silent losses.** Write-time caps (§10) and the typed
rejection. Fixes D1 by construction. Add the briefing-assembly regression test
(§20.1). No new concepts, no migration.

**Slice 2 — notes become the append layer.** `remember` writes
`agent_notes/YYYY-MM-DD_topic_<slug>.md` and commits it; `recall` ships as `rg`
with globs; briefing gains the trigger instructions. **Dissolves the "Lead memory
path" blocker** — `remember` stops depending on `memory_path` entirely. Retire
the `journal`/`curated` kind split.

**Slice 3 — the versioned chain.** `long_term/` and `working/` as versioned docs
with CAS (§11, §12). Requires `profiles/<slug>/` provisioning, but only for two
bounded files rather than a memory tree. Retire `compactMemory`, `MEMORY.md`,
`journal/`, `archive/`, `index.json`.

**Slice 4 — the review procedure and the soul chain.** Conversation-end trigger;
`update_memory("soul", …)` gated on owner request. Coupled: the review is what
keeps working memory current, and the soul chain reuses the same machinery.

Migration cost is ~zero — 24 KB across 6 files, and 12 of 16 buddies have no
memory at all.

---

## 18. Open decisions

1. **Cap values.** ~2 KB working, ~8 KB long-term are guesses. Tune after first use.
2. **When the review runs** — conversation end, pre-compaction, scheduled, or on
   demand. Scheduled inherits the loop driver's three defects (§8).
3. **Chain storage** — version files in git (greppable, git is the audit trail)
   vs rows with git holding only `current`. Leaning files.
4. **Cross-repo notes.** Confirmed: notes live where their subject lives. Still
   open: does the buddy home workspace get its own `agent_notes/`, or a
   different directory name to avoid confusion?
5. **Legacy notes and renames.** The 26 pre-convention notes are unattributed, so
   buddy-scoped globs miss them (F3). Backfill, leave, or accept.
6. **Correction retirement.** Corrections accumulate forever unless they can be
   closed or superseded (F9).
7. **Git noise.** `remember` auto-committing one file per note on a feature
   branch — confirm before it becomes a habit.
8. **Privacy.** Notes ship with the repo, including a buddy's record of its own
   failures (F8).

---

## 19. Reconciliation with the primitives handoff

This design was drafted **without** `PLANNING_PRIMITIVES.md` or the 2026-08-21
primitives/automations notes in context — an instance of UC3 failing for real.
Reconciled after the fact:

**Corrected by the handoff**
- `kind` is a free-text string, not an enum (§7). The locked "no review type" /
  "categories pass through" decisions forbid sum variants for specific intents.
- Scheduled reviews are not free (§8). The loop driver is unproven and throws.

**Where the two designs meet**
- *"No continuity across scheduled runs — each run gets a fresh conversation, so
  memory is the only carrier, and provisioning it is currently broken on the Lead
  itself."* Memory is **on the critical path** for the wait/loop work, not
  adjacent to it. This should not be sequenced after it.
- The Owner decision **"Lead memory path"** (`buddy.remember` throws `Buddy has
  no configured memory path`) is **dissolved for notes** by Slice 2.
  `LONG_TERM_MEMORY` / `WORKING_MEMORY` still need `profiles/<slug>/`, but for
  two bounded files.
- Defect D1 (silent front-truncation) is the same class as the automations defect
  *"malformed completion output silently reads as `done:false`"*. Both are T4
  violations — a silent fallback where a typed refusal belongs. One sweep.

**Operation count.** Nets +1 (`recall` and `update_memory` added,
`compact_memory` deleted). That is not the proliferation the primitives doc
forbids — it forbids a *new variant per intent*. Memory reads currently have
**no** verb at all, and the layers collapse 4 stores into 2 primitives. If the
6→2 send/reply consolidation lands, these two should be reviewed in that pass.

---

## 20. Tests to write

Model on the existing good ones (`buddies/test/v1.test.js:361/439/464`,
`server/test/buddy-lifecycle-e2e.test.ts:17`) — falsifiable, real fixtures, no
schema mirrors, no mock-stitched units.

1. **Briefing assembly regression (D1).** Write a >4,200-char long-term doc,
   append a fresh fact, assert the fact appears in the briefing. The absence of
   this test is why D1 shipped.
2. **Write-time cap rejection.** Over-cap `update_memory` throws; the previous
   version stays current; nothing is partially written.
3. **Compare-and-swap.** Two writers from `base_version: 7`; the second gets
   `StaleMemoryWrite`; exactly one v8 exists; no v8 has a duplicate `supersedes`.
4. **Chain integrity and rollback.** N sequential updates leave N immutable
   versions each with non-empty reasoning; `current` points at the last;
   rollback is a pointer move and restores the old body byte-for-byte.
5. **`remember` commits its file.** After a `remember`, `git status` is clean for
   that path and the note is in `HEAD`.
6. **`recall` end-to-end** on a real fixture directory: anchored glob selects one
   buddy's notes and does *not* match a slug that contains it as a substring.
7. **Soul authority.** A buddy-initiated `update_memory("soul", …)` is refused;
   an owner-requested one succeeds and appends to the chain with `requested_by`.
8. **Containment survives.** The existing symlink-escape and
   recheck-after-configuration guarantees still hold for the new paths.
