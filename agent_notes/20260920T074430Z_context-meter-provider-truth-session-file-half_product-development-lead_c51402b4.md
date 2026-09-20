# Context meter: provider-reported truth — the session-file half

**Date:** 2026-09-20
**Buddy:** Product Development Lead (`c51402b4`)
**Project:** Replace the context estimator with provider-reported truth
(`buddy_project_3d52671d-120d-4f64-9438-fed36c97a151`)
**Branch:** `refactor/reduce-sprawl-2026-09-06`
**Commits:** `afbcff3`, `757d156`, `cb0828a`, `848fbec` (on top of `48724f4`, `ce4210a`)

---

## 1. The question that started it

> "Can we test on the conversation we know got compacted, to see if it reports
> POST-compaction count?"

**Answer: yes, on both CLIs. The provider-reported number is post-compaction.**

Claude session `d468c888` (8,310 lines / 25MB at the time, `entrypoint: sdk-cli`
throughout, `claude-opus-5`, CLI 2.1.267). Replayed all 2,482 main-thread
assistant rows through the parser's exact canonicalisation:

| boundary | before | after | drop |
|---|---|---|---|
| line 2791 | 965,735 | 51,843 | 94.6% |
| line 5025 | 964,858 | 52,704 | 94.5% |
| line 7701 | 967,684 | 45,355 | 95.3% |

Codex, mid-session on a real rollout (21 compactions): 232,954 → 27,898;
224,804 → 35,111; 234,011 → 35,747.

This is the non-interactive `-p` mode we actually spawn, not a terminal session.

## 2. The 1M window is confirmed active

Auto-compact fired at preTokens **968,884 / 970,136 / 968,765** — 96.9% / 97.0%
/ 96.9% of 1,000,000. Against 200,000 that reads 484%, which is impossible.
Three independent trips to the same threshold.

**Claude reports no window field anywhere.** Grepped the full 25MB transcript
for `context_window`, `contextWindow`, `max_tokens`: zero hits. The denominator
must be resolved from the model id. Codex and muse do better (below).

## 3. What the old meter did with that

It could not show a compaction, for four independent reasons:

1. Fill width was `Math.min(pctOfBudget, 100)` — it clamped, so an over-budget
   thread pinned full and never moved.
2. The numerator was a chars/4 estimate over *our* append-only store, which
   never drops.
3. The one provider number shown was `cumulativeInputTokens` — the sum of
   input + cacheRead + cacheWrite across the whole session. Monotonically
   increasing **by construction**; it can never fall at a compaction. It
   answers "what did this cost", not "how full is the window".
4. The card already shipped an alert reading *"...likely cache TTL expiry after
   an idle gap, **not a compaction boundary**"* — the UI explicitly disclaimed
   seeing the thing.

**Measured consequence:** on `d468c888` the meter read full / red / clamped at
100% at three moments when the thread had just dropped to 51,843 tokens = 5.2%
of its real window. Maximum alarm at the moment of maximum headroom.

---

## 4. What was done

### 4.1 By a concurrent session — `48724f4` (the live half)

Consumed agent-cli's `usage` event in the runtime, bound to the session (not
the conversation) so a reset starts empty. Replaced the hardcoded 200,000 with
`conversations/context-window.ts`, a sum type with provenance
(`operator > provider > model > unknown`). Rebased the meter headline on the
measured count with the ~39.5k harness overhead as its own labelled band.
Removed the two dead compact controls.

### 4.2 `afbcff3` — repairing a broken HEAD

**`48724f4` did not compile.** It committed `conversation-routes.ts` importing
`SessionProviderUsage` and `lookupProviderUsageForSession` while the file
*defining* them went unstaged. At HEAD those symbols had four consumers
(`conversation-routes.ts:6,91,147,310`) and **zero definitions** — TS2305.

It passed unnoticed because verification ran against the dirty working tree,
where the definitions existed but uncommitted. **A green check on a dirty tree
says nothing about the commit.** This repo is structurally prone to it: git
cannot stage part of a file non-interactively, and stashing is forbidden here,
so multi-file changes land half-applied.

### 4.3 `757d156` — the session-file half (the actual new work)

Everything the project needed was already in files we already open. The codex
`token_count` record we parse for billing carries three fields; we read one:

```
info.total_token_usage     <- the only one read (cumulative, climbs forever)
info.last_token_usage      <- the live context, drops at a compaction
info.model_context_window  <- the denominator, 258,400 observed
```

New `server/src/conversations/session-context.ts` asks each harness log the
question the billing parser cannot answer. `usage-routes.ts` **sums** every
request ("what did this cost"); this takes the **latest** ("how full is the
window now"). The two diverge permanently at a compaction.

This path is **retroactive** — it reads numbers the CLI already wrote for every
turn ever taken, so an existing thread reads correctly without taking another
turn. The live event still wins when present.

Per-harness conventions, canonicalised at the reader:

| harness | context tokens | window | compaction marker |
|---|---|---|---|
| claude | `input + cache_read + cache_creation`, last **main-thread** row | none reported | `{type:'system',subtype:'compact_boundary'}` + `compactMetadata` |
| codex | `last_token_usage.input_tokens` alone (cached is a SUBSET) | `model_context_window` | **top-level** `type:'compacted'` |
| opencode | `input + cache.read + cache.write` (its `total` folds in output) | none | none |
| muse | `input_tokens` from the durable log | derived, see below | `context_compaction_candidate` at `succeeded` |

Compaction now reads the harness's own marker instead of a 0.9 ratio. The ratio
survives only as the fallback when no session log backs the reading, and the
response carries `source: 'marker' | 'inferred'` so the provider's word is
never blended with our arithmetic. An inferred detection reports null counts
rather than inventing them.

Also separated two concerns the reading logic had complected: whether history
was **dropped** (compaction) vs whether our bands **fit** the measured total
(scale vs residual). A marker can fire while bands still fit; bands can overflow
from estimator drift with no compaction at all.

### 4.4 `cb0828a` — three bugs only the REAL logs exposed

The synthetic suite passed 9/9. Running the reader against the actual files
found three bugs, because the fixtures encoded the same wrong guesses as the
code:

1. **Codex files were never found.** `findCodexSessionFile` probed
   `<sessionId>.jsonl`; codex names every rollout
   `rollout-<timestamp>-<sessionId>.jsonl`. Zero files can ever match — so the
   **billing** path in `lookupProviderUsageForSession` has never resolved a
   codex session either. Pre-existing, inherited.
2. **Codex compaction nesting.** `compacted` is tagged at the TOP level;
   `payload` holds `replacement_history` / `window_number` /
   `latest_token_usage_record`. Checking `payload.type` found 0 of 21.
3. **Muse status vocabulary guessed.** Real statuses are
   `running | failed | succeeded` — not `completed`/`applied`. The counter never
   fired. Only `succeeded` counts: a `failed` candidate dropped no history.

### 4.5 `848fbec` — caching

The reader re-read and re-parsed the whole log synchronously per request:
**72–93ms of event-loop blocking** on a 28MB transcript, and the same file was
read twice per request since the billing parser beside it already had an mtime
cache. Added the same pattern. After: 77.1ms → 0.5ms → 0.4ms, same values.
OpenCode left uncached deliberately (many small files; cost is in statting).

---

## 5. Verification actually performed

- Server **420 tests, 415 pass / 0 fail / 5 pre-existing skips**; 90 test files.
- Client **122/122**; all **6** invariant gates pass.
- `tsc --noEmit` (server) exit 0 with **110 files inspected** (`--listFiles`,
  to prove the checker ran); client `tsc -b` exit 0.
- Biome scoped to changed files only — never across `vendor/`.
- Staged **file-by-file**; none of the 168 unrelated dirty files from concurrent
  sessions were swept in.

**Validated against real logs, not only fixtures:**

| session | context | window | compaction |
|---|---|---|---|
| claude `d468c888` | 452,662 | from model | 3× — pre 968,765 → post 7,720, `auto` |
| codex `019f9dcb` | 185,334 | 258,400 provider-reported | 21× |
| muse `1b16740e` | 356,233 | 512,000 derived | 1× |

Each count matches what those files independently contain.

---

## 6. Reference: format details worth keeping

**Claude `compact_boundary`** (`{type:'system', subtype:'compact_boundary'}`,
`parentUuid:null`, `logicalParentUuid:<tailUuid>`, `content:'Conversation
compacted'`), with `compactMetadata`:

```
trigger, preTokens, postTokens, cumulativeDroppedTokens, durationMs,
preservedSegment{headUuid,anchorUuid,tailUuid}, preservedMessages{...}
```

Measured: preTokens 968,884 / 970,136 / 968,765 → postTokens 10,737 / 12,178 /
7,720; cumulativeDroppedTokens 958,147 → 1,916,105 → 2,877,150.

**Correction to an earlier project finding:** the boundary row does NOT carry
`parentUuid:""` plus `logicalParentUuid` — there are **zero** rows with
`parentUuid:""` in the whole file. The `isCompactSummary:true` user row is the
summary *text*, one line later.

**postTokens is not the meter number.** It reads 10,737 while the next real
request measures 51,843. The ~40k gap is the harness's own system prompt + tool
schemas, re-sent every request — matching the ~39.5k residual measured
independently.

**Codex trap:** the `token_count` immediately after a `compacted` record reports
`input_tokens: 0` — a reset sentinel, not a request. Reproduced at all three
boundaries checked. Taking it flatlines the meter for a tick.

**Muse window derivation:** muse reports no window, but
`context_compaction_candidate.strategy` carries `target_budget_tokens` (the soft
threshold) and `config_fingerprint` (`soft=0.7500,hard=0.9000`), so
window = target / soft = 384,000 / 0.75 = **512,000**.

**Muse cached is a subset:** observed `input_tokens: 23,158` with
`cache_read_tokens: 22,641` on the request after a 22,690-token one. So
`input_tokens` alone is the context, like codex — not an addend, like claude.

---

## 7. NOT CONFIDENT — read this before trusting the above

Ranked by how much it would cost to be wrong.

1. **`--resume` post-compaction is an UNVERIFIED ASSUMPTION.** Project finding
   #3 asserts "replay on `--resume` honours the cut". That was inferred from the
   boundary record's structure and **never measured** — including by me. If it
   is wrong, we re-send ~966k tokens on every resume of a compacted thread. That
   is a cost and latency bug an order of magnitude worse than a wrong progress
   bar. Tracked as its own todo.

2. **OpenCode's reader was never validated against a real session.** Claude,
   codex and muse were each checked against real logs; opencode was written from
   the existing billing parser's field names and covered only by a synthetic
   assumption. Given that three of four harnesses had a format bug found this
   way, assume this one does too until checked.

3. **Whether the meter renders correctly in the running app.** Never launched
   it. Evidence is tests + typecheck + the reader against real files. The
   rendering path is unexercised end-to-end. See `[[unleashd-verify-ui-in-running-app]]`
   for the CDP recipe.

4. **`compact_boundary` on stdout — unknown.** The string appears 30× in the
   shipped 200MB binary, which does not distinguish the stdout emitter from the
   transcript writer. Now **non-blocking**: the session log always carries the
   marker and the file path is retroactive. Settling it would only let the live
   path report a boundary a poll-interval sooner.

5. **The 1M window is INFERRED, not read.** From auto-compact firing at 96.9%
   of 1,000,000, three times. Strong but indirect — claude exposes no field.
   The model table also assumes default `claude -p`: the window narrows to 200K
   on Bedrock/GCP/Foundry, on Opus 4.6 / Sonnet 4.6 without extended context, or
   with `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`, **none of which we can observe from
   here**. An operator on those paths must set
   `UNLEASHD_CONTEXT_BUDGET_TOKENS`, which outranks the table.

6. **Muse's status vocabulary and window derivation come from ONE log.** There
   may be statuses beyond `running|failed|succeeded`, and the `soft=` fingerprint
   format may vary. Single-sample evidence.

7. **`source:'unknown'` still computes a percentage** against a 200,000 floor,
   labelled "assumed minimum window". The provenance is honest but the number is
   still inferred — flagged as a deviation by the concurrent session, not mine
   to overturn. Stricter option: suppress the bar entirely for `unknown`.

8. **Codex live-run verification is still quota-blocked** — its parser rests on
   a recorded fixture, not a fresh end-to-end run.

---

## 8. Pending work

| # | Item | Status | Why it matters |
|---|---|---|---|
| 1 | Verify `--resume` actually resumes post-compaction | open | §7.1 — the expensive unknown |
| 2 | Audit every provider session-id→file lookup against a real tree | open | codex's silently never matched; sweep for the class |
| 3 | Verify the codex usage event against a live run | blocked (quota) | parser rests on a fixture |
| 4 | Validate the opencode reader against a real session | open (`todo_71ba4175`) | §7.2 |
| 5 | Confirm the meter in the running app | open (`todo_45a8f495`) | §7.3 |

**One experiment closes #1 and #4-of-§7 together:** force a small compaction on
a cheap model (`haiku-4-5` via `--autocompact` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW`),
pump context past it, then resume and read the reported input tokens. Estimated
**$0.10–0.30, ~10 minutes**. Not run — requires spend authorisation.

---

## 9. Transferable lessons

- **A green check on a dirty tree says nothing about the commit.** Check the
  commit (`git grep <symbol> HEAD`), not the working tree.
- **Synthetic fixtures test your assumptions, not the format.** Nine passing
  tests hid three real bugs because the fixtures encoded the same guesses as the
  code. Always run a new parser against a real file once and sanity-check the
  numbers against something independently counted.
- **A cumulative statistic can never drive a fullness meter.** Billing sums and
  context sizes answer different questions and diverge permanently at a
  compaction. Keep them as separate named fields; don't blend them in copy.
- Both folded into `[[verify-that-the-verifier-ran]]`.
