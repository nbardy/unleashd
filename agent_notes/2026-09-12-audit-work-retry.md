# Work pagination, conversation readiness, and local mail audit

Observed 2026-09-12 09:30 UTC. Independent read-only review lane requested by Buddies Development Lead for the owner's full audit. No product code, production state, grants, schedules, or external services changed. The pre-existing mixed working tree was preserved. Only this note and isolated diagnostic/evidence artifacts were added.

## Result

The original R4 (audience filtering after pagination) and R5 (retry skipping an incomplete conversation link) are repaired in the current working tree and installed package. Seventeen focused tests pass. A new adjacent deletion-during-link race remains reproducible in a controlled boundary fixture: a deleted, unregistered conversation is returned as ready and receives one provider turn.

| Item | Current evidence | Disposition |
|---|---|---|
| R4, `get_current_work` | Both operation branches filter before `.slice`: `server/src/buddies/operations.ts:914` and `:945`; MCP uses an authorized limit+1 probe via `shared/src/buddy-resources.ts:116`. Native in-memory MCP regression returns the selected last project with `limit:1`. | Original reproduction fixed locally. |
| R4 adjacent, `get_runs` | `operations.ts:830` supplies an audience `accept` predicate. Installed `node_modules/@nbardy/buddies/src/coordination.js:450` evaluates it before offset/count. Regression selects a project beyond the first underlying run and returns it. | Fixed locally. |
| R5, partial link failure | `server/src/conversations/creation-service.ts:64` validates durable creation even on registry hits; `:102` centralizes readiness and retries failed links. `server/src/buddies/run-executor.ts:318` preserves the original creation command and `:323` calls readiness for continuations. Production wires the hook at `server/src/server.ts:655`. | Original reproduction fixed locally. |
| R5 variants | Existing launcher tests cover failure before persistence, after persistence, after registration, deletion before retry, and registered-then-deleted. They prove 2 link attempts after registration failure, 1 provider turn on successful retry, preserved command ID, no startup prompt replay, and no dispatch for deleted destinations. | All five pass. |
| New deletion during linking | Tombstone checked before await; object returned after deletion. Diagnostic result: `recordStatus:"deleted", registrySize:0, runStatus:"complete", providerTurns:1, linkAttempts:1`. | Pending repair recommendation; no production occurrence claimed. |
| Buddy mail | Nine-turn real runtime fixture exercises lead/two return paths, memory review, and disk reopen of local messages/replies (`server/test/buddy-coordination.test.ts:329`). Separate external-mail adapter test passes unknown-delivery/reconciliation behavior. | Local durable send/reply is tested. Adapter test is not account integration. |

## New finding: deletion during readiness can still admit input

`creation-service.ts:106` obtains/checks a record before `await link` at line 118. The subsequent return at line 123 checks neither the durable tombstone nor registry membership. `run-executor.ts:338` accepts that returned object, verifies identity/workspace, then starts its claim at line 344 and calls `runCoordinationMessage` at line 352.

The diagnostic uses the real configuration service/store, shared creation service, run executor, and installed Buddy store. Its controlled link port awaits `configStore.delete(id)` and removes the runtime from the registry before returning. The fake provider boundary nevertheless runs and settles the run as complete. It intentionally asserts this observed defect, so **a passing diagnostic means the bug remains present**.

```sh
pnpm exec tsx --test product/buddies/audit-2026-09-12/delete-during-link.repro.ts
```

This proves a readiness-boundary gap under that interleaving. It does not establish that a live WebSocket deletion has occurred during a production link outage. Production deletion additionally calls `stop()` and Buddy cleanup (`server/src/transport/conversation-websocket.ts:285`), so an end-to-end test with the real deletion path is appropriate before assigning production incidence or final severity.

Recommendation (assistant proposal, not an accepted architecture change): fence readiness/admission against deletion, revalidate the durable record and current registry identity after asynchronous linking, and ensure deletion revokes pending creation/admission. Keep the original creation command, no-input-before-ready behavior, and run deadline. Cover the interleaving at the actual delete/admit boundary; a fresh check alone should not be mistaken for atomic coordination across all subsequent awaits.

## Verification and limits

```sh
pnpm exec tsx --test server/test/buddy-resource-consistency.test.ts server/test/buddy-launcher-creation.test.ts server/test/buddy-mailbox.test.ts server/test/buddy-coordination.test.ts server/test/buddy-creation-service.test.ts
```

Result: **17 passed, 0 failed, 0 skipped**. The preserved relocated diagnostic also ran successfully with the observed defect above. Tests use isolated stores and controlled provider/link ports, not a live model/team launch. No claim is made that every pagination case, changing offset dataset, or all transports have been exhaustively verified.

All 25 files in the vendored archive exactly match the installed package; no mismatches. Archive SHA-256 `54fc8e53846dbc1fb66f101ecbc963c8dee9e442b89cbb1b797a2a88f4c9059a`, declared source commit `135aafa6ecfbf26dd17c269e2818d5db80c2f15a`. Unleashd HEAD `1187a8b6660b95c0c60bd8fada105f015b98cc39` is insufficient to identify this uncommitted working tree.

Full hashes and observed outputs are preserved in `product/buddies/audit-2026-09-12/work-retry.evidence.json`; diagnostic SHA-256 `48dc6db22ecd610bede2f63f4e53971c8dd1a9d43530ce2ddf960700c38355e2`. Key reviewed source hashes:

- `operations.ts`: `b42f90303563eb0aaaaf6cd8509204c6db930d6e2b89361365c3b9811d64dda4`.
- `creation-service.ts`: `756308078b587f181b36b5b6b8dbe32ea25d7e8779bb4d6d4f60b8a4685aa1d6`.
- `run-executor.ts`: `d9d7f5fd5eefaf928f51ad0cab4ac5d213d0dba015d0424bd6e120950995a2bc`.
- Installed `coordination.js`: `27d92bc29959d5a672affc7996f086b041d2e5f9e85c1e5a3f82b96f8c94cbc9`.

Historical context read before review: the September 11 review (`ae10cedce4bfbab0e202c44987864bda09697a4821fb6f0a86d424e2e8c9733c`) and September 12 repair report (`311152c5aa3823a9c60af8412a89455fee47967f6100fbfd12b2fb408de98ba6`), plus architecture, test strategy, automation ownership and planning primitives. The repair report's original passing tests remain valid; the new interleaving narrows its completeness claim. `RTK.md` is absent at the workspace root; AGENTS.md's explicit RTK caveat was followed by checking cited lines in individual files.

## Follow-up challenge, 2026-09-12 09:42 UTC

The lead requested a challenge against the actual WebSocket delete handler before treating the new finding as a production regression. The result remains **provisional: a reproduced creation-service/admission gap, not an end-to-end WebSocket deletion reproduction**. No stronger runtime fixture was completed in this bounded audit.

The additional cleanup was inspected rather than assumed away:

- `server/src/transport/conversation-websocket.ts:285` durably deletes, calls `conversation.stop()`, calls `cancelBuddyConversation`, then removes registry and session aliases.
- `server/src/server.ts:361` maps cancellation to integration link cancellation and delegation settlement.
- `server/src/conversations/runtime.ts:2458` enters `stopOwnedTurn`; line 2460 returns when no provider process exists. The initial linking phase precedes process startup, so this branch does not itself cancel the unstarted coordination claim.
- `server/src/buddies/integration.ts:401` updates the link and calls `finishConversationMessages` for terminal status. Installed `store.js:2644` restricts that message update to a bound `child_conversation_id` and `command_key IS NULL`; modern coordination requests have a command key, and fresh requests bind the child at `coordination.js:573` during start.
- `server/src/buddies/closure.ts:32` and `:35` settle legacy delegation/review rows; this code contains no coordination-run cancellation.

Those observations make the cleanup an insufficient *obvious* refutation of the service-level reproduction, but do not substitute for exercising the real handler and runtime together. Retain provisional priority and do not describe this as an observed user deletion failure. The source hashes for this challenge are also preserved in `product/buddies/audit-2026-09-12/mcp-contract.evidence.json`.
