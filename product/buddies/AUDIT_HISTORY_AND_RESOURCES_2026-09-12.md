# Buddy history and resource audit — 2026-09-12

**Yes: the history-loss bug is traced to exact code and independently reproduced. It remains present in this audited working tree.** The original transcript is intact. What disappears is the application's projection of older native sessions, and its original creation date. The separate September 12 repairs fix the original five reproduction sequences; they do not fix this history projection.

This report answers the owner's request to fan out an audit, preserve findings on disk, and record verified versus pending fixes. Four subagents supplied history, privacy/memory, work/retry, contract, and independent cross-review passes; the lead reviewed the client and ran the broad checks. Scope is the Buddy resource-consolidation code and its conversation, memory, authority, creation, and display boundaries. It is not a proof that every Unleashd feature is defect-free.

## Exact history-loss mechanism

The original conversation is `7d9d117f-7a13-46e2-bf6a-95da591d6e2b`, created September 9. Its original five-defect answer is still at line 8051 of native transcript `rollout-2026-09-09T12-46-14-01a0847c-ed91-75e2-85fb-6a57cdc8bd54.jsonl`. During this audit the file was independently rechecked: **60,237,815 bytes, SHA-256 `100c1bf32e4074352dd4a2837424ebf3ab399e163dd99a387f6441bbb4e270a4`**, matching the earlier incident evidence. [Fresh file check and bounded excerpt](audit-2026-09-12/original-transcript-check.json).

The code path is:

1. [Runtime audience comparison](../../server/src/conversations/runtime.ts:2107) can call `resetProcess()`. A restored session's approved audience key starts unknown, so the next Buddy turn conservatively starts fresh. Real access changes also require invalidation. Ordinary memory-review writes no longer change the repaired key.
2. [Reset](../../server/src/conversations/runtime.ts:2516) rotates the native session while immediately retaining the application messages, ID, and date. [Config persistence](../../server/src/conversations/config-store.ts:413) keeps the prior native binding and original durable date.
3. [Polling](../../server/src/lifecycle/session-loader.ts:465) assigns `existing.messages` from the newest native session's `source.messages`. [Line 470](../../server/src/lifecycle/session-loader.ts:470) also assigns `existing.createdAt = source.createdAt`.
4. [Restart hydration](../../server/src/lifecycle/session-loader.ts:150) rejects noncurrent native bindings, then [loads the current source's messages/date](../../server/src/lifecycle/session-loader.ts:225). It cannot restore the older display history even when the old source is supplied.
5. The client installs the full server update through [actions.ts](../../client/src/atoms/actions.ts:561). The loss has already happened before rendering.

The new fixture exercises the actual runtime, disk-backed configuration store, polling, and restart loader, with controlled provider/transcript inputs:

| Boundary | Visible messages | Visible creation date | Durable record |
|---|---:|---|---|
| Immediately after rotation and new turn | 4: original 2 plus new 2 | September 9 | Original date and prior binding retained |
| After current-session poll | 2: new only | September 12 | Unchanged |
| After reload, given both native transcripts | 2: new only | September 12 | Unchanged |

[Runnable diagnostic](audit-2026-09-12/history-rotate-poll-reload.observed.ts), [captured result](audit-2026-09-12/history-rotate-poll-reload.result.json), and [full causal audit](../../agent_notes/2026-09-12-audit-history-cause.md).

The historical live observations establish preserved original bytes, repeated fresh sessions, stable app ID, and an API projection missing the old review. The specific claim that the **second historical rotation** was triggered by an intervening memory-review write remains an inference from timing and the old key algorithm: compared audience hashes/reset reasons were not logged. The current projection bug no longer depends on that inference; it is directly reproduced.

## Earlier defects: current verification

“Fixed” below means the original reproduction passes desired-behavior tests against this local source/package snapshot. It does not mean deployed or comprehensively closed across every entry point.

| Earlier finding | Current status | Evidence and important limit |
|---|---|---|
| R1: private owner messages readable in unrelated project turns | Original path fixed | `get_message` and inbox/run projections now apply audience/publication policy. Another entry point still leaks private execution errors; see A2. |
| R2: reviewer, composer, tools, and UI select competing memory | Fixed for original sequence | Effective scoped resolution preserves authorized inherited owner defaults, reviewer lessons, and note discovery; selected HTTP/UI audience uses that same head. Team scopes do not inherit private defaults. |
| R3: ordinary memory learning starts a fresh model session | Original trigger fixed | Reviewer document/note writes preserve key and continuity. Unrelated operational/topology changes still alter it; see A3. |
| R4: work filtered after pagination | Fixed | Authorized project filtering precedes slicing; native MCP returns a readable project beyond hidden rows. |
| R4 adjacent: run history filtered after pagination | Fixed | Installed run query applies the audience predicate before offset/count. |
| R5: retry skips failed conversation linking | Fixed for original failure boundaries | Retry uses common readiness/link repair and original command identity. Before/after persistence, after registration, and deletion-before-retry regressions pass. An overlapping deletion case is separately investigated as A4. |
| Earlier nested `get_runs.execution.error` disclosure | Original path fixed | Unauthorized execution object is omitted, with raw failure canary absent. `get_capabilities` is still a separate hole. |

Shared-reference discovery, in-scope self-publication, required shared/note names and audience references, scoped CAS, and shared desktop/mobile Memory controls have current implementation and boundary evidence. Note updates remain append-only. Local Buddy mail is durable `send`/`reply`; the disconnected external-email adapter is not required for that workflow.

## Remaining findings and proposed repairs

| ID | Priority | Finding | Repair/acceptance required |
|---|---|---|---|
| A1 | P1 | Session rotation followed by poll/reload drops earlier display history and changes the apparent birth date. | Preserve authorized application history across bound sessions and the durable creation date; prove ordering/deduplication, poll/restart/detail/WS behavior, and exclusion of disallowed old content from new provider input. |
| A2 | P1 | `get_capabilities({messageIds:[privateId]})` exposes private execution errors in an unrelated team audience even when `get_message` denies and `get_runs` redacts them. | Apply the common audience predicate and safe execution projection to readiness/capability receipts. Test actual MCP catalog/call and the same private canary across all three entry points. |
| A3 | P2, feeds A1 | Another Buddy's scheduler pause metadata or a relationship wholly in another workspace changes the current owner's continuity key and starts fresh. | Hash the effective disclosure boundary rather than whole operational membership rows/global topology. Runtime tests must resume on unrelated changes and still reset on real narrowing/retraction. |
| A4 | Provisional P2 | Deletion while awaiting link readiness can return a deleted/unregistered runtime and admit input in a controlled fixture. | Fence deletion versus admission through the real delete/stop/link path. Distinguish the proven boundary gap from unmeasured production incidence; do not treat a single extra preflight check as atomicity. |
| A5 | P3 | `update_document(kind:"note")` can save an 18,000-byte note that `remember_note` rejects under its 16,000 UTF-8-byte bound. | Put the chosen note bound at the shared write boundary; prove both paths agree while preserving append-only enforcement. |
| A6 | P3 | Native recall advertises optional `regex:true`, but scoped recall rejects it; literal search succeeds. | Advertise the actual supported schema/behavior or implement the promised mode consistently. |
| A7 | P3 | Required planning documentation still advertises obsolete `send` fields and synchronous waiting rather than the typed `delivery` contract. | Update current usage documentation against the real MCP schema; preserve older dated decision records as historical evidence. |

These are audit recommendations. No product fix was applied in this audit. Detailed source lines, exact canaries, commands, hashes, and qualification of the deletion finding are in the lane reports below. Repairing A3 alone cannot solve A1: legitimate privacy changes must still rotate sessions. Disabling the privacy fence or blindly replaying private old transcripts into a team/narrowed audience is not a valid history repair.

## Verification, delivery state, and evidence limits

**468 existing tests passed: 305 server + 76 client + 87 package; three server live-provider tests skipped.** Shared/server/client `tsc -b` and all six client invariants passed. Overlapping focused runs are not added to this total. New observed-defect diagnostics deliberately pass when the bug is present; they are not acceptance tests or proof of a fix.

The installed package, all 25 vendored archive members, and the clean package repair worktree are byte-identical. Package source commit: `135aafa6ecfbf26dd17c269e2818d5db80c2f15a`. Archive SHA-256: `54fc8e53846dbc1fb66f101ecbc963c8dee9e442b89cbb1b797a2a88f4c9059a`. The source worktree is `/Users/nicholasbardy/git/.codex-worktrees/buddies/resource-repair-20260912`; the unrelated dirty main checkout of `~/git/buddies` was not used to claim package parity.

Unleashd HEAD is `1187a8b6660b95c0c60bd8fada105f015b98cc39` on `refactor/reduce-sprawl-2026-09-06`, with a pre-existing mixed, uncommitted working tree. HEAD alone cannot identify the audited implementation. The audit captured 257 source/test/document hashes and compared them again: no changes to those baseline files. Audit Markdown, diagnostic fixtures, logs, manifests, and native Buddy records are the work products. No deployment, push, production repair, restart, external mail, or persistent team activation is claimed. Existing stopped production roots were not restarted.

The old transcript is recoverable from retained bytes, but the live conversation has not been repaired by this audit. New diagnostics control provider events; live model and multi-worker production acceptance remains separate. Static client tests do not prove browser interaction or mobile-device behavior. These limits coexist with strong deterministic code-boundary evidence.

## Review files and preserved artifacts

- [History cause and independent runtime continuity review](../../agent_notes/2026-09-12-audit-history-cause.md)
- [Privacy, memory, and package review](../../agent_notes/2026-09-12-audit-privacy-memory.md)
- [Pagination, retry, deletion boundary, and local mail review](../../agent_notes/2026-09-12-audit-work-retry.md)
- [MCP and current-documentation contract review](../../agent_notes/2026-09-12-audit-mcp-contract.md)
- [Client and broad verification review](../../agent_notes/2026-09-12-audit-client-verification.md)
- [Independent cross-review](../../agent_notes/2026-09-12-audit-cross-review.md)
- [Evidence and diagnostic directory](audit-2026-09-12/README.md)

Native work pointers: audit `buddy_project_df4b429d-c8c4-458c-9a4f-52322b4b9db8`; separate seven-item repair project `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`. The parent readiness project and older composable-system project now point to these findings rather than stale original-reproduction next actions. Native records own continuing status; this report is the dated evidence snapshot.

## Dated decision and correction record

Question: can the repaired resource consolidation now be described as fully reliable, and was disappearing history actually diagnosed? Owner requested this audit; the lead's accepted task is investigation, evidence preservation, and work-record reconciliation. The implementation repairs are real, but a complete-readiness claim remains unjustified because A1–A7 and the operational acceptance limits remain. This is the assistant's evidence-backed recommendation, not a new owner-approved architecture.

The earlier accepted Direction 1 remains appropriate: shared resources and conversation infrastructure, distinct execution admission, and scoped disclosure. The new evidence changes the completeness assessment, not that architectural choice. A successor repair should centralize the remaining audience projections, stabilize keys around actual disclosure, and preserve application history separately from provider context. Alternatives of suppressing all resets or adding a separate workflow coordinator do not resolve these demonstrated boundaries. Revisit the broader architecture only if the previously stated shared multiparty/atomic-configuration requirements change; no such new evidence arose here.

Historical sources remain unchanged: September 11 review SHA-256 `ae10cedce4bfbab0e202c44987864bda09697a4821fb6f0a86d424e2e8c9733c`; September 12 repair report SHA-256 `311152c5aa3823a9c60af8412a89455fee47967f6100fbfd12b2fb408de98ba6`. Their specific source snapshots and this audit's source excerpts are preserved in the corresponding evidence manifests. The injected working-memory statement “No fix completion evidence” predates the verified repair record and is corrected by native append-only note `knowledge_6abd482c-a7ca-43da-a4a9-72c45dc63b7b`. Current work belongs in native projects, not that memory sentence.
