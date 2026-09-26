# Lean rewrite — final report (2026-09-26)

Branch reviewed: `lean/integration` at 6b5c6c1, plus the review fixes on `review/final`
(worktree `.claude/worktrees/lane-review`). Scope: `origin/main` f6cc2ca → HEAD, 679 files, +50,472 / −80,000.

## Line counts (git ls-tree + line count per blob, start cbb8820 vs 6b5c6c1)

| Area | cbb8820 | HEAD | Change |
|---|---:|---:|---:|
| Server TS (`server/src`) | 36,552 | 20,003 | −45% |
| Shared TS (`shared/src`) | 4,516 | 2,515 | −44% |
| Client TS/TSX (`client/src`) | 36,739 | 32,706 | −11% |
| CSS | 18,757 | 14,841 | −21% |
| Rust (crates, incl. inline `#[cfg(test)]`) | 0 | 12,258 | new |
| Tests (TS test files + Rust `tests/`) | 37,391 | 17,518 | −53% |
| **Total** | **133,955** | **99,841** | **−25%** |

The start also carried the vendored Buddies package (`vendor/nbardy-buddies-0.1.0.tgz`, 11,348 lines of JS),
which is gone at HEAD. Counting it, the start was 145,303 lines, so the cut is 31% (Buddy server 15.5k → 4.5k
lines, T11). Excluded: `vendor/`, `.d.ts`, docs, tools.

## Data model

| Store | Before | After | Source |
|---|---|---|---|
| Buddies SQLite | 35 tables (package v33) | 13 tables (`crates/unleashd-buddies/src/schema.rs`) | T06, T06b, T11 |
| Conversation config records | 16.8k JSON files (config-store.ts) | 1 SQLite store owned by the ingest crate | T23a, T23b |
| Transcripts | TS re-parse (jsonl.ts, session cache, 5 s poller) | `crates/unleashd-ingest` SQLite store + watcher | T12, T13b |

## Performance (before → after, as measured in each report; not re-measured)

| Measure | Before | After | Report |
|---|---|---|---|
| WS first frame (`init`) | 1.87 MB | 274 KB (54 KB deflated) | T09-wire-v3 |
| First frame received after connect | 785 ms | 76 ms | T09-wire-v3 |
| Bytes for one "mark done" toggle | 1.36 MB | 93.5 B | T09-wire-v3 |
| Server startup to ready (pre-migrated copy) | 33.3 s | 7.5 s | T09-wire-v3 |
| Warm boot to "Initial load complete" | 1.57 s (pre-S1) | 1.11 s | T13b-S2 |
| Server restart (ingest) | 7.2 s | ~1 s | T12 |
| Append to a 934 MB Codex rollout | 11.8 s full re-parse | p50 74 ms | T12 |
| Append → `onChange` (settle + kqueue) | p50 68 ms | p50 6–9 ms | T13a |
| `/api/usage`, 30 days | 16,516 ms | 966 ms cold / 386 ms warm | T13b-usage-switch |
| `/api/usage`, 7 days | 6,157 ms | 169 ms | T13b-usage-switch |
| `GET /api/usage` event-loop cost (cold) | 434 ms | 8 ms | T04-server-perf |
| Startup "list all records" | 1,971 ms | 17 ms Rust (125 ms via addon) | T23a |
| Record listing at startup | 3–6 s | ~100 ms warm | T23b |
| Client stream frame | 0.53 ms | 0.014 ms | T05-client-perf |
| Big Buddy thread, cold, software GL: loader gone | 782 ms | 184 ms | THREAD-LOAD |
| `pnpm run bootstrap` on an addon cache hit | full cargo build (~68 s cold) | 5.5 s | S12-build-cache |

RSS: T09 saw 411 → 490 MB; T14b traced it to the old config store (now deleted); S2 measured 424 MB warm.

## Done

T00a/T00b lean targets · T01 reconcile indexes · T02 delete merge · T03 B1 fix (seat turns carry no owner
authority) · T04 server speed · T05 client speed · T06/T06b Buddies core in Rust (unified posts, zero-loss
import) · T07 agent-cli HTTP MCP · T08 runtime split · T09 Conversation sum type + wire v3 · T10 swarm
quarantine · T11 Buddy server rewrite · T12/T13a ingest crate · T13b S1/S2 transcripts, usage and message
bodies from ingest · T14a/T14b deletions · T17 test audit · T18 screenshot coverage · T19/S3 client state
(65 → 19 exported atoms) · T21a CSS tokens · T22 S4/S5 Buddy UI · T23a/T23b records store · S6 Buddy CSS ·
S9/S9b rate-limit labels · S11 docs and leftovers · S12 build cache · PORT/PORT-QOL/PORT-QOL-2 · post-S2
test:api + napi packaging smoke · T15 prep (dry run + runbook) · this final review.

## Final review findings

Fixed on `review/final` (each commit has a regression test and a reason comment):
- **3859153:** boot looked for the v33 Buddies file only in `~/.buddies`. An owner with `BUDDIES_HOME` set got
  an empty database, not the import command. It now follows the old package's location rule.
- **012ca21:** a `rewritten` patch that arrived during a chat's first load was ignored, so the load could show
  the replaced history. The load now reads again until it has the current history.
- **9055ba7:** records-tool pointed at the wrong directory imported 0 records, and verify still passed. It now
  refuses a source with no `by-conversation/`. When two files claim one id, the canonical file now wins over
  whichever sorts first.

Runbook: target SHA updated, `CARGO_TARGET_DIR` pinned for the CLI paths, and a count of the dropped tables added.

Open, fails loudly or is transitional, not fixed:
- An open v2 tab keeps its list but stops updating after the v3 server starts. Reload open tabs after the swap.
- The 11 tables dropped by design are not counted in the import report; their rows live only in the v33 backup.
- Buddies verify aborts (exit 2) if a buddy has no soul memory head. It blocks the swap; nothing is lost.
- A corrupt record JSON file aborts `record-migration.ts` instead of being kept as a reject.

Checked, sound:
- The owner-authority rule and per-turn MCP token revocation.
- The auth gate is first in Express; the WS uses `noServer` with an upgrade gate; the new routes are behind it.
- The Buddies importer and verifier hash-compare posts, messages, memories and soul.md, and every mismatch
  exits nonzero.
- Wire-skew handling on the v3 client.
- Every flagged merge-survival item survived.

Checks on the clean tree at 9055ba7 (`git status` empty): typecheck, package smoke, server 187/187, client 158/158,
dev-supervisor 14, tools 5, cli 273/273, api 16/16, `check-client-invariants.sh` all 8 gates pass. Two flakes
failed the first chain run and passed on rerun: a ~300 s host stall hit 2 server tests, and a load-sensitive
cursor MCP probe (34 s) failed once.

## Follow-ups (from PROJECT.md)

- **T20, one view tree** (O1 approved): shared views and two thin shells; deletes about 5k duplicated mobile lines.
  Held until the other session commits, because it edits the same files.
- **T21b, CSS views and shells:** after T20. Target 18.5k → ~3.75k lines, proven by T18 pixel diffs.
- **Budget passes** (server / client / Rust): compare each module with its 05/06 line budget and consolidate
  the overages.
- **Memory-curation harness:** its baseline prompt names the old tools; the port costs about 40 paid calls.
  Owner decision.
- **S10, thread-load follow-ups:** 190 ms first-view markdown, thread request from the URL, cached sigils.
- **Swarm deletion** (quarantined behind one entry per side) and other **feature removals**: owner decisions.
- **After the T15 swap:** delete the one-time importers (`crates/unleashd-buddies-import`) and the
  record-migration tool (`crates/unleashd-records-tool`).

## Owner steps to ship

1. **The other session's uncommitted work first.** The main checkout has about 150 dirty files from another
   session (Channels, Chat, mobile). They must be committed there, then ported onto `lean/integration`
   (PORT-3) before any merge. Otherwise they are lost or clobbered.
2. **Merge `review/final` → `lean/integration`** (fast-forward; the 3 review commits sit on 6b5c6c1).
3. **Decide the 20 queued runs** (see T15-RUNBOOK.md): drop them, or let them run before the swap.
4. **T15 live swap, following `T15-RUNBOOK.md`:** stop the backend, back up `~/.buddies` and
   `~/.agent-viewer`, run the Buddies import and the records import, and stop if either verify fails
   (both exit nonzero). Then restart on the new build and spot-check channels, memories and soul.md.
5. **Merge `lean/integration`** → the working branch, then `main`, and restart the backend (T16).
