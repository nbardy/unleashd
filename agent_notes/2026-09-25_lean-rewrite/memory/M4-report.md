# M4 report: live memory-relevance benchmark rebuilt (not run)

Branch `lane/memory-bench`, commit beb8c66 on top of lane/memory-reviewer 7806092. Not merged
or pushed. 3 files, +617 / -122.

## What changed
- **`server/test/buddy-memory-curation.test.ts`** (new): the live harness.
  - Skipped unless `UNLEASHD_LIVE_MEMORY_CURATION=1`.
  - Each case × repeat gets its own temp `BuddiesCore`, workspace, Buddy and MCP endpoint.
  - It seeds soul, working and long-term through the real core, plus the case's workspace files.
  - It runs the production `createMemoryReviewer`: real `executeCommand`, the real 4-rung
    ladder, real grants. A tee on the event stream only records each rung's text and tool uses.
  - It waits for the `memory_review` receipt, then snapshots the docs.
  - It writes `<case>.r<repeat>.json` and `summary.json`.
- **Result kinds:**
  - `reviewed`: the receipt, before/after docs with revisions, the rungs, the report, and the
    verdicts.
  - `infra`: a setup crash (`receipt: null`) or a receipt that is not `complete`.
  - Infra results are saved and counted separately from check failures, never dropped.
  - Every result is saved before any assertion runs.
  - Up to 2 run concurrently.
- **Env:** `_CASE` (an unknown id fails loudly), `_REPEATS` (1–3, default 2), `_RESULTS`.
- **Provenance per row:** commit, dirty flag, sha256 of the instructions, cases.ts and the
  harness, the ladder, and the rung timeout.
- **`cases.ts`:**
  - `noOp` is replaced by a typed `checks: CurationCheck[]` sum: `noWrites`, `unchanged`,
    `includes`, `excludes`, `occursOnce`, `reportsNone`. The harness has one handler per kind.
  - A–J are kept unchanged. F and J carry `noWrites`.
  - Added K–O as specified:
    - L seeds the edited file in the workspace, and its turn has an `Edit` toolCall.
    - O seeds the log file its pointer names.
  - Every run also gets `soulUnchanged` and `withinLimits`.
- **README:** the run, cost, grading and extension sections are rewritten for the new harness.
  The relevance cases and the check table are documented. The M3 note now says the harness was
  ported but not run.
  - There is no baseline arm any more: `createMemoryReviewer` has no way to override its
    instructions. The frozen baseline file is kept.
  - The ladder is NOT disabled. Rows record `model` and `fallbackFrom`, and grading is grouped
    by model.

## Run it (owner gate: costs credits)
Pilot, 1 review:
```sh
UNLEASHD_LIVE_MEMORY_CURATION=1 UNLEASHD_MEMORY_CURATION_CASE=K-inflight-to-working \
UNLEASHD_MEMORY_CURATION_REPEATS=1 UNLEASHD_MEMORY_CURATION_RESULTS=/tmp/memory-curation-pilot-<id> \
pnpm exec tsx --test server/test/buddy-memory-curation.test.ts
```
Full run:
```sh
UNLEASHD_LIVE_MEMORY_CURATION=1 UNLEASHD_MEMORY_CURATION_REPEATS=2 \
UNLEASHD_MEMORY_CURATION_RESULTS=/tmp/memory-curation-<id> \
pnpm exec tsx --test server/test/buddy-memory-curation.test.ts
```
**Expected model calls:** 15 cases × 2 repeats = **30 reviews = 30 model calls** if codex has
credits. A review climbs a rung only on `out_of_tokens` or its 300 s timeout, so the hard
ceiling is 120 calls (4 rungs).

## Verification
- `pnpm typecheck` is green.
- `pnpm test:server`: 202 tests, 201 pass, 0 fail, 1 skipped (the live test).
- Tree is clean after the commit, so these checks cover the commit itself.
- **Wiring smoke test, zero model calls.** One case ran with PATH limited to `node` and `git`,
  so no agent CLI could be spawned.
  - The full path ran: seeding, the reviewer, the receipt, the JSON result and the summary.
  - It correctly recorded `kind: infra`, with the receipt `failed` / `spawn codex ENOENT`.
  - Not verified: any real reviewer behaviour, and whether the loose check patterns
    (e.g. L's pending regex, O's `occursOnce reindex`) fit real outputs. Check them on the
    pilot.
