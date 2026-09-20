# Efficiency delivery: transport verification and task reconciliation

September 15, 2026 · Buddies Development Lead

Successor to [the implementation assessment](2026-09-15-efficiency-assessment.md)
(SHA-256 `37f16513a50595b172a4eecf0065a397c356c2ece65b165dbdd2c780d721c40a`)
and native decision note
`2026-09-15T13:58:26.446Z:01568abf-a9b1-4134-b5b9-91e2ac77f5df`.
The assessment's implementation choices and limits remain unchanged.

## Additional transport evidence

The same synthetic four-project fixture now checks that native MCP text parses
to exactly the structured result, maximum work limit 99 succeeds, invalid limits
0/100/1.5 and a malformed cursor fail, and the complete summary envelope is below
15,000 serialized characters.

| Measurement | Full | Summary |
|---|---:|---:|
| Structured result, serialized characters | 564,726 | 3,190 |
| Complete MCP result, serialized characters | 1,130,548 | 6,700 |
| One in-memory MCP read, milliseconds | 11.038 | 2.242 |

These are one full read followed by one summary read, with setup and caches in
the same process. They are neither a latency benchmark nor the original Wave_sim
production corpus, token usage, billing or accepted-result savings. Both read
tests passed after adding these assertions. The earlier 66-test regression and
108-test package runs remain recorded at their original source hashes.

Exact command, updated test hash and measurement scope:
[transport verification](2026-09-15-efficiency-verification/transport-verification.json).
Raw output: [transport result](2026-09-15-efficiency-verification/transport-verification.log).
Only the test was extended by this task after the previously recorded application
checks. A final hash comparison also detected concurrent edits in the shared
runtime, executor and server composition. The same 66-test regression passed
again against those files, with no further changes during that run. See
[the refreshed source hashes](2026-09-15-efficiency-verification/reconciled-verification.json)
and [regression result](2026-09-15-efficiency-verification/reconciled-server-tests.log).
Those concurrent source edits are not attributed to this implementation.

## Reconcile concurrent task planning

**Question:** Where should delivered evidence and remaining work live after
another session created six detailed children while this implementation was
underway?

**Decision-maker:** Buddies Development Lead, operational reconciliation under
the current owner's investigate-and-implement request. This is not acceptance of
the separate all-project plan or an instruction to resume paused execution.

**Choice:** retain the six earlier, more specific child Tasks as the canonical
work records. Attach local evidence to their exact criteria. Supersede the first
three duplicate todos in `buddy_project_8638d8bf-f609-46f3-b991-a2d5232e55c4`,
preserving their conditions on the corresponding children:

- Incremental reads: `buddy_project_56ced029-2ce3-4897-b037-462d5a01e2ff`.
  Add a durable source only if restart-on-stale cannot serve the demonstrated
  workflow. Do not call inclusive current-record filtering a lossless feed.
- Usage: `buddy_project_cdae619b-6e1d-4d5b-9c78-84308f418344`.
  Capture provider semantics and interrupted usage before deduplicated totals.
- Review wakeups: `buddy_project_4f875aff-3481-4ba9-8aab-eb0ea62c1308`.
  Establish governing audience, limits, permissions, urgency and per-result
  disposition before combining independent requests.

The local assignment configuration implementation meets the three recorded
criteria in `buddy_project_4abf69fe-7981-4934-aaa0-7b4d2908906e`:
documented contract, canonical preview/admission, and actual provider-request
capture including queued defaults, continuation, cancellation and config drift.
Its criteria explicitly allow a captured invocation; no live provider claim is
added.

Compact projection and MCP acceptance evidence belongs in
`buddy_project_075e367e-3442-474c-a58d-8094aec59e25`. Its additional original
consumer-corpus/loaded-build qualification remains distinct from the synthetic
fixture. Integrated UI/loaded-runtime acceptance remains on
`buddy_project_67c0de12-9b60-4748-ae8b-0a88792c2f74`.

During reconciliation, another session added a distinct research-monitoring
review todo to that follow-up. A revision conflict prevented overwriting it.
The project remains as the home for that separate review; only the three
duplicate todos were cancelled. This supersedes the initial parent comment's
statement that the entire duplicate project was cancelled.

**Why:** one implementation owner and work record per outcome prevents exactly
the duplicate tracking and review work identified by the handoff. Cancelling
a duplicate does not complete its unmet criteria. The separate parent plan-review
todo remains intact; this implementation does not claim to review the full
project inventory.

**Alternative rejected:** leave an additional implementation track for the same
three missing boundaries. It adds no distinct deliverable or authority.

**Revisit:** create separate work only when a distinct consumer outcome,
acceptance boundary or owner cannot be represented by the existing children.
Current status, dependencies and next actions belong to the native Tasks.
