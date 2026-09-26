# Budget pass: server core (branch refactor/budget-server-core, db98212 → 6911521, 10 commits)

| Area | Before | After | 05 budget | Still over, because |
|---|---:|---:|---:|---|
| conversations | 3,216 | 2,814 | ~630 (conversation 250 + config service 300 + records 80) | runtime.ts 942 (Buddy host/policyHost, fork, queue ops); record-migration.ts 385 is a one-time offline tool (delete with records-tool after the live swap); buddy-creation-service 271 is B scope, and buddies/ is not this lane's |
| turns | 2,288 | 2,145 | 1,040 (queue 200, runner 450, policy 60, watchdog 120, record 150, overlay 60) | runner.ts 978 (attempt records + fold + 3 drain paths); tool-format 337 waits for the shared tool-summary (client lane); watchdog 225 was off-limits |
| http | 1,558 | 1,397 | 580 (+150 error routes, counted under observability) | context meter (~300) lives in conversation-routes; usage 293 until pricing moves to the crate |
| ingest glue | 1,020 | 975 | 270 (ingest 120 + hydrate 150) | conversation-list 639 is the settle/overlay join, which 05 moves into the crate |
| transport | 637 | 559 | 480 | within ~80: the `create_conversation` case is still inline |
| **Total** | **8,719** | **7,890** | ~3,000 | −829 lines (−9.5%). The budgets assume the Rust hydrate/list and B-scope moves, which were not part of this pass |

**Moved to docs** (each site keeps a 1–3 line reason plus the guard name):
- New `docs/turn-lifecycle.md`: one terminal path, early turn.complete, one request shape, provider usage, chat fork, session-relative prompt, preflight.
- New `docs/context-meter.md`: window resolution, measured vs. live, bands/compaction.
- `docs/ws-contract-surprises.md`: command slot before the barrier, the silent-drop rule, liveness.
- `docs/architecture.md`: default workspace is not `process.cwd()`.

**Code cuts:**
- Deleted dead code that has no production caller: config service `fork`, `bindSession`, `appendBranchLaunch`, `listRecoverable`; the store's `listActive`, `appendBranchLaunch`, `rekeyConversation`. Only the test lines that exercised `fork` went with them.
- Removed the 65-line `ConversationRuntime` interface that mirrored the class: `Conversation` is now a top-level class.
- Runtime dependencies now extend `TurnRunnerPorts` instead of re-listing them.
- Merged duplicated helpers: runner attempt/session/cleanup, the reject path, `forEachConcurrently`, the directory lister and file server, usage totals.
- tool-format's emoji switch and field ladder are now tables. They were checked identical to the old code on 1,904 cases, and the `/api/paths` output was checked identical against HEAD.

**Behavior note:** the `createOrReuse` catch in `create_conversation` had drifted back to the raw error text. It now uses `replayFailureMessage`, as the invariant and ws-contract-surprises.md require.

**Checks:** full `pnpm test` plus `check-client-invariants` (8/8 gates) pass on the clean tree at 6911521. The one ✖ in the output is the pre-existing todo test (memory per-chat).
