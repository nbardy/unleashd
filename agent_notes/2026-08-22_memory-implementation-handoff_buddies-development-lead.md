---
kind: handoff
evidence: [product/buddies/PLANNING_MEMORY.md, product/buddies/REVIEW_MEMORY_2026-08-22.md, agent_notes/2026-08-21_rtk-diff-is-not-a-patch_buddies-development-lead.md]
---

# Handoff to the memory implementation

Two things the design docs do not carry, from the session that drafted them.
Item 1 is urgent and mechanical. Item 2 is evidence for a decision already made.

One thing that needed handing off turned out **not** to: the absence of a
portable pre-compaction / conversation-end signal. `REVIEW_MEMORY_2026-08-22.md`
already states it (lines 51, 228, 649) and `PLANNING_MEMORY.md:205` records it.
Independently confirmed here — see §3. No action needed.

---

## 1. URGENT: rtk silently rewrites identifiers in recursive search output

**Recursive `rg` output is not trustworthy.** The `PreToolUse` hook rewrites
directory-target searches to `rtk rg`, which applies token substitution and does
not mark that it did. Single-file searches pass through unmodified.

Reproduced 2026-08-22 against `server/src/buddies/`:

| what rtk printed | what is actually in the file |
|---|---|
| `'buddy.n_memory'` | `'buddy.compact_memory'` |
| `this.store.nMemory(...)` | `this.store.compactMemory(...)` |
| `function nProject(...)` | `function compactProject(...)` |

The substitution is `compact` → `n`. Recursive output **also drops line
numbers**, which breaks the `file:line` citation convention this repo uses
everywhere.

```bash
rg -rn -i "compact" server/src/buddies   # → n_memory, nMemory, nProject, no line numbers
rg -n  -i "compact" server/src/buddies/operations.ts   # → correct, with line numbers
```

**Why this bites you specifically:** you are retiring `compact_memory`. Every
search for it returns identifiers that do not exist. An agent that trusts the
output will grep for `nMemory`, find nothing, and conclude the symbol is already
gone — or worse, write `nProject` into code.

**Workarounds, in order of preference:**
1. Target a **single file** once you know which one.
2. `python3 -c "..."` to read and filter — never rewritten.
3. `rg --files -g '<glob>'` to locate, then read the file directly.

`rtk proxy rg ...` did **not** help — it was rewritten too.

Companion failure, same tool, already written up:
`agent_notes/2026-08-21_rtk-diff-is-not-a-patch_buddies-development-lead.md`
(`git diff > x.patch` captures a summary with zero `@@` hunks). Both are the
same root cause: rtk's compressed output is for *reading*, never for *capturing
or citing*.

## 2. Write-timing evidence for §8 "Same-turn capture first"

You adopted same-turn capture. The external evidence supporting and constraining
it was gathered in conversation and never landed on disk. It is not in the
research note — verified absent.

**OpenClaw writes memory on exactly two triggers**, neither per-turn: an explicit
user request, or a pre-compaction flush when context crosses
`softThresholdTokens` (default 4000 before the reserve floor), firing **once per
compaction cycle**.

**That flush loses data even at once-per-cycle** —
[openclaw#6877](https://github.com/openclaw/openclaw/issues/6877). The prompt
says "store durable memories now" without saying *read first*, so agents call a
write tool and produce a full file replacement, destroying the same day's earlier
entries. Reported losses include whole sections. The two proposed fixes are
"READ first and APPEND" or **timestamped filenames so overwrites are
impossible**.

> Our design is already immune, twice: notes are timestamped separate files
> (literally fix (b)), and `update_memory` is CAS'd over immutable versions. Worth
> keeping both properties — they are load-bearing, not incidental.

Users are filing for **more boundaries, not more frequency** —
[#45608](https://github.com/openclaw/openclaw/issues/45608) and
[#8185](https://github.com/openclaw/openclaw/issues/8185) both ask the flush to
also fire on `/new` and `/reset`.

**Hermes** is the only system exposing write cadence as config. Honcho's
`writeFrequency`: `async` (background thread), `turn` (sync), `session` (batch at
end), or integer N. Supermemory does both — per-turn `auto_capture` *plus* a
full-session ingest at boundaries.

But note **what** is written per turn everywhere: raw turns into an *append-only
searchable store*. No system rewrites its curated doc per turn. That is the same
split as our two primitives, and it is why cadence should follow primitive:
appends can be frequent because they cannot clobber; rewrites must be rare
because they can.

**Requirement this implies — recursive memory pollution.** Supermemory ships
"automatic context fencing — strips recalled memories from captured turns to
prevent recursive memory pollution." Our same-turn capture injects working
memory into the briefing and then reads the turn. Without a fence it re-ingests
its own output and amplifies. **Strip the injected briefing block before the
capture model sees the turn.** This is not optional and is not currently in
§8.

## 3. Compaction visibility — confirmed, no action

Searched `vendor/agent-cli-tool/src`, `server/src`, `shared/src` for
compaction/context-limit handling. 19 hits, all unrelated: `summarizeConversation`
/ `summarizeRawStdout` / `summarizeOompaConfig` (serialization, not conversation
compaction), `compact JSON` parsing in `jsonl.ts:345-359`, and token-limit
*regexes* in `diagnostics.ts:4` and `runtime.ts:290` that detect quota **errors**,
not compaction events.

So: harnesses compact (we measured 82 `compacted` snapshots, ~36 MB, 18–21% of
transcript bytes in one Codex session), and we have **no signal when they do**.
OpenClaw's entire flush design hooks pre-compaction; we cannot copy it. Same-turn
capture is therefore not a preference — it is the only reliable mechanism
available. Your docs already say this; this is corroboration.

## 4. "Measure whether capture works" needs a stated threshold

`REVIEW_MEMORY_2026-08-22.md` §1 defers the automatic review and says to "first
use same-turn capture instructions and measure whether useful corrections and
lessons are actually recorded." That is the right call — it directly targets the
largest risk in the original design (discretionary writes are exactly what left
the old system at ~19 KB in months).

But the success criterion has to be fixed **before** the pilot, or "measure"
degrades into "we'll see" and the pilot cannot fail. Something falsifiable, e.g.:
after N buddy conversations, at least X% contain a recorded correction or lesson,
and a spot-read of K of them finds them non-trivial. Pick N, X, K up front.

Without a threshold there is no way to distinguish "capture works" from "capture
never fires and nobody noticed" — which is the exact failure the current system
already exhibits.
