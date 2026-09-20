# Lead review packet — September 15, 2026

Owner direction: “Is all the info in tasks? We're gonna have a lead review it after we've recorded it all.”

This is a dated navigation and evidence record. Native Tasks and their comments own current criteria, ownership, blockers, review outcomes and next actions. The lead review itself remains pending. Concurrent preparation also produced the [lead review brief](2026-09-15-lead-review-brief.md) and its own source snapshot; retain both records. The existing lead-review todo is `todo_0e20e4a3-4b7a-4006-84e3-df832edf2786`; no duplicate review Task is needed.

## Coverage and entry points

The recording audit found 68 Lead-owned Tasks plus the two known supervised UI/release Tasks: **70 records**, with 33 unfinished and 37 closed at discovery. This covers the task inventory discussed in this owner thread, not other teams' entire workspaces. The prior review covered 68 existing records plus the restart child (69); one concurrently created efficiency follow-up was absent from that index.

- Start in efficiency umbrella `buddy_project_6efaffd1-0415-4dcf-80a4-bb6599d924b7`: six delivery slices, linked supporting work, the additional conditional follow-up and the pending lead-review criterion.
- Repair/reconciliation umbrella `buddy_project_37f2780f-f766-452b-991c-eb4ca4192a9b` retains old-criteria reconciliation, saved-grant/draft/history acceptance and integration ownership.
- [Prior inventory and proposed dispositions](2026-09-15-task-review-plan.md) covers the original records. Its closed-record review was an inventory/history review, not a fresh verification of every completed claim.
- Added index entry: `buddy_project_8638d8bf-f609-46f3-b991-a2d5232e55c4`, the conditional change-feed/usage/cross-request-review follow-up. It overlaps existing incremental-read, usage and review-wakeup Tasks; lead disposition is pending. All criteria remain preserved.
- Six efficiency children now contain 19 todos, including Worker terminology added after the original 18-todo plan. The restart-integration child contains three. Counts describe this observation only.

## Latest evidence the reviewer needs

Read the [implementation assessment](2026-09-15-efficiency-assessment.md) alongside the earlier plan. It was updated after the prior task inventory and reports implementation through existing authorities:

- Opt-in compact/focused work, inbox and team reads; result-set-bound work cursors and full expansion.
- Assignment-scoped configuration, pinned defaults and requested/actual execution receipts at the provider-adapter boundary.
- Durable queue/claim/elapsed intervals; token and cost coverage remain explicitly unavailable.
- Existing managed-parent child-return coalescing remains; independent cross-request batching is deferred.

The assessment reports 66 server and 108 package tests plus shared/server/client checks; its provider invocation evidence uses a deterministic adapter. Those are preserved prior-run results, not tests rerun by this recording audit. The synthetic four-project summary measured 3,190 versus 564,726 normalized characters. Earlier loaded Lead data measured 3,400 versus 17,463 (full MCP envelopes 7,120 versus 35,888). Neither corpus establishes original Wave_sim acceptance, controlled latency or billed savings.

Recorded package commit: `631829b62ae6a6f706e3fb9b171e85a387ccbebe`; vendored archive SHA-256: `961e14438ee1afea02252d5e030bbdbba377a140ca1b3f3c39431097f1d4db0f`. Current native reads exposed contract `2026-09-15.1`, which does not establish the exact loaded source/package identity. Browser, paid-provider and production adoption remain separately verifiable.

## Task map and review questions

| Topic | Canonical Task | Review focus |
|---|---|---|
| Compact summaries | `buddy_project_075e367e-3442-474c-a58d-8094aec59e25` | Qualify existing implementation, original/representative corpus, complete envelope and latency. |
| Incremental reads | `buddy_project_56ced029-2ce3-4897-b037-462d5a01e2ff` | Inclusive timestamp filters and restart-on-stale are not a deletion feed. Decide the consumer guarantee. |
| Assignment settings | `buddy_project_4abf69fe-7981-4934-aaa0-7b4d2908906e` | Assess reported invocation tests against full criteria; stable loaded build and remote behavior are separate. |
| Usage | `buddy_project_cdae619b-6e1d-4d5b-9c78-84308f418344` | Telemetry prerequisite, units, interruption coverage and deduplication; null is not zero. |
| Review wakeups | `buddy_project_4f875aff-3481-4ba9-8aab-eb0ea62c1308` | Existing child-return grouping versus cross-request policy; audience, limits, urgent route and maximum delay. |
| UI/MCP/runtime composition | `buddy_project_67c0de12-9b60-4748-ae8b-0a88792c2f74` | Separate accepted-result evidence from attempt/delivery facts; temporary Buddy Worker terminology. |
| Restart candidate | `buddy_project_62511186-9ab4-4ec6-aece-4bdf39307527` | Identify only missing corrections against stable delivery candidate. |
| UI repairs | `buddy_project_95592e35-f568-4868-9a93-03c8a8511597` | Saved grants held by archived/detached grantees, dirty drafts, exact original-thread browser evidence. |
| Release | `buddy_project_a2047be3-f8cb-4eed-ac2e-522e3831bee6` | Preserve source and attributable candidate/pushed/loaded distinctions; reconcile exhausted old requests. |
| Consistency | `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b` | Exact history acceptance plus the newly observed evidence-preservation defect below. |

The earlier suggested order remains a proposal: reconcile old criteria → restart/summaries → assignment selection and cursor qualification → usage → review policy → composition. The lead should decide which slices are already satisfied, which require qualification, and which remain conditional. Validated slices can ship independently under their existing delivery scope.

The broad follow-up `8638d8bf` must be reconciled with `56ced029`, `cdae619b` and `4f875aff` before selecting more implementation work. Original failed/stopped attempts remain historical. Old checkpoint, quota and alternate-runtime proposals must be evaluated against current owner decisions and core design.

## New observed evidence-preservation defect

While correcting the UI Task wording through native `update_project`, revision 5 → 6 changed its five project evidence entries to `[]`, although the submitted mutation omitted evidence. A separate full native read confirmed the empty array. An explicit native evidence-only update restored all five at revision 7; another full read matched the original array exactly.

- Mutation audit: `audit_4b68cac0-8aff-43d2-9e91-653f83d51122`.
- Restoration audit: `audit_29fe815b-a8cd-4d1a-9e76-08b9de4a05e1`.
- Existing consistency Task now has open todo `todo_0c08ebff-7e66-4034-a609-103cf7cd4e8f` for reproduction, root cause and a real native-boundary regression.
- Historical A1–A7 completion records remain intact. This current observation supersedes any assumption that omitted-evidence preservation is already proven for this supervised update path.
- The record was repaired; the underlying implementation was not diagnosed or changed in this recording pass.

## Decision attribution and preserved sources

Owner chose recording before a later lead review. Assistant recording choices: retain the additional follow-up with explicit overlap questions, attach the latest assessment to relevant Tasks, correct “former-lead” wording to archived/detached grantees without changing grant behavior, restore unexpectedly removed evidence, and record the reproduced defect in existing consistency work. These are not lead acceptance of the implementation or an owner choice of detailed cursor/telemetry/batching mechanics.

Why: the prior review and latest implementation record overlapped in time; accepting the old plan alone would miss current implementation evidence and duplicate scope. The native evidence loss supplies new grounds for reopening that precise consistency guarantee. Alternatives were to cancel/merge proposed work now or treat all prior checks as complete; preserving criteria leaves those acceptance decisions reviewable. Revisit when the lead records artifact-backed dispositions.

[Source snapshot](2026-09-15-lead-review-140506-sources.json) preserves exact document/log text and SHA-256 hashes, including the prior plan, implementation assessment, original handoff snapshot and verification artifacts. [Recording receipts](2026-09-15-lead-review-recording.json) preserve the census and native evidence-loss/restoration observations. These files preserve evidence, not a parallel current-work ledger.
