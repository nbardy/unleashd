# Decision: Repair existing coordination authorities and expose their provenance

September 12, 2026. Decision-maker: Buddies Development Lead, exercising the owner's current instruction to compare three designs, decide and implement. Status: implementation selection by assistant; not a separately claimed owner endorsement. The prior owner decision remains resource consolidation, accepted September 11.

## Decision and why

Implement [Design 1](01-existing-resources.md). Keep the current messages, projects, runs, conversation creation and document services. Correct identity/replay and provenance at those authorities; add small checkpoint and team-observation capabilities. Do not introduce a replacement workflow engine or a second event/transport spine.

The consumer succeeded at useful delegation. The demonstrated failures occur when the same conversation is linked again, when attempt and project facts are joined, when a child sender is mistaken for a non-controller, and when effective limits are hidden. None requires replacing projects with workflow cases. The prior consolidation rationale—share resource services and keep creation separate from admission—still holds. What changed is stronger live evidence for return delivery, oversights in receipt semantics and the need for explicit recovery artifacts. This decision is a successor, not a reversal.

Evidence is frozen in `source-manifest.json` and `sources/`, with source hashes, dated excerpts preserved as complete files, host baseline `3ea36ad97dbfed535b0da9841519222040b074bc` and package baseline `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`. The source baseline preserves uncommitted concurrent work. The report's production errors do not identify the exact running build; tests must establish the repaired boundary independently.

## Comparison

| Criterion | Existing resources | Coordination ledger | Workflow cases |
|---|---|---|---|
| Repairs four failed returns | Direct linking/queue repair | Same repair plus outbox | Same repair plus case dispatcher |
| Truthful attribution | Separate sourced projections + checkpoints | Strong event provenance after migration | Strong step/attempt provenance after import |
| Recovery | Existing attempt retry with named controllers | New recovery/event protocol | New step/controller protocol |
| Team visibility | Bounded causal/supervised metadata | Event projections/subscriptions | Explicit case membership/board |
| Migration burden | Additive columns/checkpoints | Dual-write and historical unknowns | Import and dual work vocabulary |
| Preserves current authority | Yes | Requires transition discipline | Requires replacing project authority |
| Immediate consumer value | Highest | Delayed by infrastructure | Delayed by product conversion |

Design 2 is appropriate if replayable subscriptions, multi-consumer event exports or formal resource leases become near-term requirements. Design 3 needs evidence for reusable process templates and dependency/review orchestration exceeding current projects. Neither is selected now. Their complete contracts remain preserved for future reconsideration.

## Current work and sequencing

Native reads found three active work records: composable system (`buddy_project_545457c2-3c8a-4bc1-b792-702a6d3ffbb7`), owner readiness (`buddy_project_9864f34e-b435-43b1-80b1-07cc51645fbe`) and history/privacy repairs (`buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`). The repair project records A1–A7 complete with tests and keeps live history adoption separate. Older August backlog entries are stale evidence and do not authorize redoing completed work.

At approximately 15:36 UTC, native runs showed this thread `c474d933-5a61-41c8-8e3b-327848d26c6e` and `7d9d117f-7a13-46e2-bf6a-95da591d6e2b` running. No provider process was stopped. Work is isolated in `codex/coordination-reliability-20260912`; source integration must compare the original snapshot and concurrent tree before applying edits. Current task state is authoritative in `buddy_project_f24b0cc3-e82e-40ab-b974-5f1bfc469950`, not in this historical note.

Implementation order: durable link/admission and attribution; explicit retry/controller/limit handling; checkpoint and scoped observation services; native/API/UI wiring; verification and safe integration. Package archive/types/provenance must match the tested source. No forced live restart or production root replay is needed to implement or verify an isolated fixture.

## Exact behavioral decisions

* Repeated linking returns the same durable link for the same immutable scope. A mismatched Buddy/workspace/project is a conflict. Session refresh is explicit; readiness does not change history.
* Acknowledgment means input admission, identified by its attempt. Legacy unknown admission remains unknown. Project acceptance/evidence is a separate current snapshot with revision and observation time. A cancelled request never gains acknowledgment from a later project result.
* Persisted reply, notification admission, provider completion and consumer review are separate facts. Return delivery retries use existing durable runs and stable keys. Only a known failure before input admission is eligible for bounded automatic retry. Busy recipients remain queued; post-admission uncertainty requires explicit inspection.
* Original input sender and root requester may recover the relevant failed branch, subject to current audience/workspace/supervision and original limits. Identity is Buddy ID, not conversation ID. A child sender gains no control of sibling work. Root stop, deleted destination and cancelled execution epoch remain fences.
* Timeout of managed work with remaining envelope becomes a recoverable failure, with a durable notice and checkpoint references. Recovery creates one new attempt; it preserves failed evidence and consumed runs/time. Exhaustion is terminal. Already terminal historical replies are not rewritten or silently reopened.
* Managed attempts use an explicit effective cap derived from policy/envelope and the host background maximum, rather than silently inheriting the ordinary 600-second default. Waiting consumes chain wall time and releases the parent slot. Foreground chat continues using its explicit application deadline.
* Team reads expose only authorized coordination metadata and published checkpoint references. Causal-root participation and existing project supervision authorize observation, not private message/transcript/memory access. Active audience filtering precedes pagination. Current owner HTTP remains host scoped.
* A checkpoint is an append-only producer attestation with stable key, source run/project/root, artifact version/digest, effects and resume text. It survives attempt failure. It is not a guarantee of current filesystem availability or an authorization to rerun effects.
* Exact send preview executes the same validation in a rolled-back store transaction and returns a route/limit observation; apply always rechecks. Cross-team informs default to no project binding. Explicit context projects need shared readability; managed work still needs recipient ownership.

## Concern-to-outcome matrix

| Consumer concern | Selected response / acceptance evidence |
|---|---|
| Four UNIQUE link failures | Real creation/integration replay test after native session binding; same link ID and no duplicate admitted input |
| Busy CEO return / notice failures | Durable delivery history and bounded pre-admission retries; busy queue drains once; failed notice visible without recursion |
| 600 seconds despite managed budget | Requested/effective cap and limiting source exposed; deadline regression and managed-envelope tests |
| CEO cannot inspect descendants | Native team metadata for authorized causal roots/supervised work, with negative privacy tests |
| Cancelled request gains later evidence | Message admission and reply refs separate from current project snapshot; cancellation regression |
| Project Lead cannot retry its child | Direct-sender branch recovery plus root requester; unrelated actor denied; duplicate key yields one successor |
| Cross-team reply/project confusion | Message recipient + active audience authorization, exact send preview and contextual inform rules |
| Saved files after timeout | Registered checkpoint/artifact versions tied to original attempt; surviving refs/effects in recovery view |
| Pending consumer handoffs | Reply persistence and delivery attempts separately visible; consumer review remains explicit reply/project evidence |
| Model/effort and cost preferences | Actual execution snapshot shown; per-assignment overrides and unenforced usage caps explicitly identified as unavailable |
| GPU reservation versus actual lease | Explicitly report no host resource-lease integration; never infer exclusivity from prose; separate future resource-manager project if authorized |
| Stale working memory | Current project/run authority and source revisions visible; preserve prior decisions; do not promote old memory to current status |
| Excessive inbox payload | Compact team summary with bounded evidence refs and detail expansion; no repeated project evidence arrays |
| Recall regex mismatch | Already repaired in A6; preserve current literal-only native schema and regression |
| Shared creation and deletion | Retain inert creation, background placement, foreground deadlines, delete admission and privacy/history regressions |

## Delivery boundary and risks

Implement all selected repairs and surfaces, including discoverable limitations. A GPU lease manager, per-assignment provider policy, full event subscription engine and automated filesystem artifact discovery are deliberately not selected: the report asks for honest observation of those boundaries, and their implementation would require new execution authorities. The view must state their absence plainly. A production recovery action and live build adoption are distinct from code completion; do not claim a consumer's old roots were repaired by tests.

Tests must exercise the packaged store plus real host configuration/creation/runtime boundary, not mocks that bypass the reported fault. Include SQLite reopen, retry races/idempotency, scoped reads, preview rollback, cancelled-history attribution and shared component rendering. Run package suite, focused and broad host/client regressions, typechecks, invariants and a bounded isolated live-provider return. Record exact results and any environmental failures in an implementation report. No claims of deployment, external outreach or simulation acceptance follow from these checks.

## Reconsideration

Revisit this decision if append-only checkpoint and run history cannot represent required provenance without ambiguous joins; if multiple consumers require replay/changed-since subscriptions at scale; if an owner authorizes real shared-device leasing; or if users repeatedly construct identical multi-step review processes that warrant case templates. Append a new decision with evidence and a link to this one. Do not erase these alternatives or rewrite their historical selection status.
