# Independent cross-review — 2026-09-12

The main conclusions survive an independent challenge. This review inspected the history, work/retry and client reports, the privacy diagnostic and captured results, the package equivalence manifest, broad-test logs, relevant individual source files, and the consolidated `AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md` draft. It did not rerun the broad suites, inspect live production state, change product code, or manage Buddy state. `RTK.md` is absent at the workspace root; cited source was read from individual files.

## Confirmed claims and necessary qualifications

- **A1 is P1 and causally established.** The history diagnostic uses the real runtime, disk-backed configuration store and loader boundaries, with synthetic provider and discovery inputs. It proves four messages become two at poll, remain two after hydration supplied both sessions, and the visible date changes while the durable original date/binding remain. Source agrees: `session-loader.ts:465` replaces messages, `:470` replaces the date, and `:150` excludes noncurrent bindings at hydration. This is a server projection defect. The diagnostic does not claim a live provider round trip. Keep the original incident's second memory-write trigger explicitly inferential: current deterministic reproduction does not retroactively establish unlogged production reset reasons.
- **A2 is P1 privacy and is not a false positive caused by a different identity.** The same Buddy in an unrelated team audience is denied the private message by `get_message`, but `get_capabilities` returns its execution error through actual in-memory MCP. `team-readiness.ts:78` checks participant identity/workspace, then `:127` serializes `messageExecution` without the additional audience check used by `operations.ts:811`. The fixture's error canary is direct content-disclosure evidence; private conversation metadata is also returned. It proves disclosure to an unauthorized model audience, not a historical external exfiltration incident. Do not claim the entire original privacy repair was absent: the original tested entry points are repaired and readiness is an adjacent omission.
- **A3 should be P2 as a trigger, explicitly feeding P1 A1.** Unrelated scheduler metadata/global relationships cause unnecessary resets, confirmed through the runtime. The standalone harm is context churn and wasted continuity; the current loader turns those resets into the already counted history defect. Giving both rows the same history-loss impact would double count symptoms. Fixing A3 cannot close A1 because real permission/retraction changes must still rotate sessions.
- **A4 remains provisional P2 in the draft reviewed.** The controlled link fixture proves `ensureReady` returns a deleted/unregistered object after its awaited link. It does not alone prove production admission after the real deletion route. `conversation-websocket.ts:287–295` also stops the runtime and calls `cancelBuddyConversation`; the fixture's no-op `stop` and direct tombstone/registry removal omit those effects. Any later stronger reproduction must be reported separately and identify whether it exercises actual cancellation and run-claim fencing. A single post-await check is useful but cannot establish atomic admission across later awaits.
- **A5 is appropriately P3.** The 18,000 UTF-8-byte note is an actual cross-entry validation inconsistency. Its append-only replacement check still holds. The fixture supplies no evidence of catastrophic memory growth or availability loss, so stronger severity would overstate it.

The final draft's A6/A7 contract findings are outside this lane's independent source validation. They should retain their own contract diagnostic/source evidence rather than borrowing the privacy or history confidence.

## Test and delivery accounting

The logs support **305 server + 76 client + 87 package = 468 existing passing tests**, plus three server live-provider skips. The 34-test history lane, 17-test work lane, 12 passing privacy acceptance cases and 16 focused client cases overlap those suites and must not be added. Observed-defect diagnostics pass by asserting the defect; they are separate evidence, never repair acceptance. The consolidated draft gets this right.

The manifest's 25 package members match archive, installed files and the identified repair worktree. This supports the package test provenance but does not prove the running production process loaded that snapshot. Preserve “fixed for the original reproduction locally,” “pending,” and “production unverified” as separate statements. No deployment/restart/live repair was established here.

The recommended repair direction is sound: retain authorized display history/date without replaying disallowed historical context into a narrowed model session; share audience checks across all read projections; derive continuity keys from effective disclosure changes; preserve actual cancellation/admission authority. Removing all resets, treating the display transcript as universally replayable model input, or disabling privacy checks would invalidate the repair.

## Preserved review basis

SHA-256 values captured during this review (the working tree is uncommitted; mutable paths alone are insufficient historical references):

| Source | SHA-256 |
|---|---|
| History report | `71abc57f39d7101995e72974b4f31dccfb614e932a647f37ebb7ba91d34284fa` |
| Work/retry report before any deletion-proof supplement | `3d71432f514d38854217d6d87ca5edcc419c684d2307614b4f9df2a215c47c16` |
| Client report | `4df44511405ced7bd4e9a8595ca732e7aac4ee60a3b009ce94766b53dad68d1d` |
| `server/src/buddies/team-readiness.ts` | `61efb77033198a27fe742fa6d9c47d72cfb26bf6f5a3f10d3c8c0f29f540c866` |
| `server/src/buddies/operations.ts` | `b42f90303563eb0aaaaf6cd8509204c6db930d6e2b89361365c3b9811d64dda4` |
| `server/src/conversations/creation-service.ts` | `756308078b587f181b36b5b6b8dbe32ea25d7e8779bb4d6d4f60b8a4685aa1d6` |
| `server/src/transport/conversation-websocket.ts` | `a5a05e5a74559f9769ec8159fdf4d17ea8bc58a146df4d9e25859878cc302dad` |
| Privacy diagnostic | `b3b9d08c890270a9690dcb97cde616d52c90efab37450b1c322300733b78890f` |
| Privacy diagnostic captured result | `cc0d866a5e0958cde1278a9dafc63b5c1b0393dee96e357d324ae50d0f5bb5b5` |
| Rotate/poll/reload diagnostic | `c7d037f2e079f412b9bb561961c183606e196c22ffe307cb5044cf38f856ca0d` |

Exact relevant behavior is preserved above and in the lane evidence manifests/diagnostics. This is an assistant review and repair recommendation, not a new owner architecture decision or authoritative project status.
