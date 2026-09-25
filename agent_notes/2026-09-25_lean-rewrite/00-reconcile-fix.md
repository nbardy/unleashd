# reconcileBackgroundWork event-loop stall: fix report (2026-09-25)

## Root cause
Once a second, the Buddy scheduler tick (`BuddyRunExecutor.poll()`) calls `store.reconcileBackgroundWork()`. The trouble was the query shape and the lack of indexes, not how much data there is:
- `buddy_runs` had **no index on `input_id`**, and `buddy_messages` had none on `caused_by_run_id`. So every lookup keyed on input_id did a full scan of `buddy_runs`: 14 MB, ~2.5k rows, each with a large JSON `policy`. That covers `getBackgroundWork` (the runs list, the budget query, the children join), `getMessageExecution` and `getMessageDeliveries`. Each outstanding `until_done` message cost about 15 scans per tick.
- The id query (`SELECT DISTINCT m.id … JOIN buddy_runs r … OR …`) was planned as `SCAN r` on the outside.
- `reconcileInterruptionReports` was never the problem. It stayed under 1ms throughout, because it already used `buddy_runs_ready`.
- Because the machine is short on memory, each scan misses the page cache. That turned about 80ms of warm CPU into 1.6-2.5s per tick.

The tick cadence was kept at 1s on purpose. Background deadlines (`limit_reached` by duration) expire without any event to react to, so reconcile has to keep polling. Once the queries use indexes, a tick costs a few milliseconds.

## Changes
**Buddies package**: repo `~/git/buddies`, branch `fix/reconcile-tick-2026-09-25` (based on 886e2e1), commit **7ee9d22**. Worktree: `~/git/.codex-worktrees/buddies/reconcile-tick-2026-09-25`. The repo has no remote, so nothing was pushed.
- `src/background-work.js`
  - New `ensureBackgroundWorkIndexes(db)`, which creates `buddy_runs(input_id,input_kind)`, a partial index on `buddy_runs(error_code)`, `buddy_messages(status)` and `buddy_messages(caused_by_run_id)`. The incident comment is at this site.
  - The reconcile id query is rewritten as two index-driven halves joined by `UNION`.
- `src/store.js`: calls `ensureBackgroundWorkIndexes` at the end of `#migrate()`. It runs `IF NOT EXISTS` on every open and does **not** bump `user_version`, so a v33 build can still open the file.
- `test/background-work.test.js`: new test "the reconcile tick never scans a table".
  - It records every SELECT that `reconcileBackgroundWork()` runs, with its real bound arguments, then runs `EXPLAIN QUERY PLAN` on each and fails on any `SCAN`.
  - It first asserts that the fixture reaches the per-message path (1 result, disposition `waiting`).
  - With the index call disabled it fails, reporting 8 distinct scans.
- Test results: the full package suite passes, 131/131.

**unleashd**: worktree `.claude/worktrees/agent-aaed73753d7dab009`, branch **`fix/reconcile-tick-2026-09-25`** (based on `feat/channels-project-view-2026-09-22` at cbb8820), commit **ab47223**:
- The tgz was re-vendored from 7ee9d22; the provenance `sourceCommit` is 7ee9d22.
- `pnpm-lock.yaml`: the tarball integrity was updated. Without this, `pnpm install --frozen-lockfile` fails with `ERR_PNPM_TARBALL_INTEGRITY`.
- `server/src/buddies/run-executor.ts`: a comment at the `reconcileBackgroundWork` call site pointing to the incident and the guard test.
- Test results:
  - Buddy server tests (background ×3 and scheduler): 34/34 pass.
  - Full `test:server`: 484/492 pass. The 2 failures are unrelated: this worktree's `vendor/agent-cli-tool` submodule was never checked out, which breaks `listModels` and `buddy-builder.integration`.
- The commit was verified at HEAD (clean tree; `git grep` and the tarball extracted from HEAD).

## Timings (`reconcileBackgroundWork()`, copies of the live DB)
| DB copy / machine state | before (886e2e1) | after (7ee9d22) |
|---|---|---|
| earlier copy (8 outstanding msgs), warm | ~80ms | ~8ms |
| same copy, swap-bound machine, 30 runs ×3 | p50 605-662ms, p90 up to 2.5s, max 19.9s | p50 6-33ms, max 66ms |
| fresh `unleashd-lean-scope/db` copy (3 outstanding), 20 runs ×2 | p50 35-43ms, max 117ms | p50 4.8-5.1ms, max 8ms |

After the fix, the most expensive statement is `SELECT * FROM buddy_runs WHERE id=?`, about 0.5ms across 89 calls. No statement scans a table.

## To deploy
1. Merge `fix/reconcile-tick-2026-09-25` (unleashd) into your branch. It contains only commit ab47223.
2. In the main tree, run `pnpm install --frozen-lockfile --offline`. Then check that the extract really changed: `rg ensureBackgroundWorkIndexes node_modules/@nbardy/buddies/src`. If that finds nothing, `mv` the `node_modules/.pnpm/@nbardy+buddies@file+vendor+…` directory aside and reinstall (see the CLAUDE.md stale-extract note).
3. Restart the backend (dev supervisor / `dev:replace`, whichever you normally use). The indexes are created automatically on the first open of `~/.buddies/buddies.sqlite`. This takes a few ms, and there is no schema version change, so a rollback to an older build still opens the DB.
4. Optional: merge `fix/reconcile-tick-2026-09-25` in `~/git/buddies` into your package line. Its parent is 886e2e1.
5. Check the fix: a trivial 404 should drop back to single-digit ms.
