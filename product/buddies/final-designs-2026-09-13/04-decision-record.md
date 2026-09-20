# Decision record — owner design and final alternatives

September 13, 2026 · Append-only design record for conversation
`89d40447-9d68-4b53-9688-67c154dbfae2`.

## Question

Which objects and responsibilities can be removed or unified so persistent
teammates, tasks, reports and autonomous lead review compose into a small system?

## Owner direction and status

The current owner asks to preserve their design as `LATEST_HUMAN_DESIGN` and
pressure-test it against prior reflection, work and usage. The preferred product
direction is named sub-buddies for persistent background tasks, a distinct short
main-Buddy message-response path, human-only Conversations, forward-looking effort
bounds and selective use of economical implementation models.

Status: **owner-stated direction, formalized**. This is not evidence of a deployed
runtime or owner acceptance of every assistant detail below. The original source
is [preserved](00-owner-statement.md); its dated hash is S24 in the
[manifest](source-manifest.json).

## Earlier reasoning and what changed

The owner previously accepted Direction 1/resource consolidation. The acceptance
note is preserved as S18, and its predecessor reflection as S01. The rationale
was to unify service implementations and keep current typed resources rather
than replace working boundaries with a new event ledger or Space system.
Typed change sets (S02) require repeated atomic configuration needs; shared
spaces (S03) require repeated multiparty discussion needs. Neither follows merely
from a desire for fewer MCP tool names.

The immediately preceding September 13 synthesis (S04/S05) distinguished identity,
work, conversation, execution and resource lifetimes. It allowed direct self-owned
background work as a peer to assignment workers and proposed autonomous parent
review within existing obligations. The current owner statement sharpens that:
long work should normally belong to a teammate, and the main Buddy's autonomous
exception should be short message-response/coordination work. Human Conversations
must not become the automatic execution channel.

What still holds: ordinary Buddy identity, canonical task evidence, scoped
knowledge, one execution owner, terminal history, explicit effect authority and
versioned decision evidence. What changes: preferred execution placement, the
need for a first-class report composition and an autonomous lead route that
does not depend on waking a human chat.

## Assistant recommendation and alternatives

Decision-maker for this recommendation: **Buddies Development Lead**. Status:
**proposed**, not owner selected.

Choose Design 1, **Buddies, Tasks and Desk turns**. Keep five core domain types:
Buddy, Task, Message, Document and Conversation. Team/inbox/activity are views;
sub-buddy is an ordinary Buddy in a reporting/task relationship. Report is an
atomic composition, Desk is bounded execution and a UI term, and model selection
is task intent plus an attempt snapshot. Supporting policy/runtime records stay
explicit where they own independent invariants.

Design 2 binds workers to individual Tasks. It clarifies background identity but
creates more identities and complicates reusable learning and reassignment.
Design 3 uses one uniform autonomous inbox loop for every Buddy. It reduces role
policy but permits a main Buddy to become occupied with its own long task, an
intentional relaxation of the current owner direction.

## Motivations, constraints and tradeoffs

- Persistence requires identity to outlive a process. Waiting should release
  process capacity without discarding memory, task ownership or addressability.
- Task progress, report delivery and review are separate facts; each needs one
  authority. Atomic notification intent prevents committed progress from losing
  its lead wake after a crash.
- Coalesced progress preserves attention without launching a model for every
  low-level update. Every retained cause is eventually handled or has a visible
  admission blocker.
- Budgets need a unit, scope and cumulative authority. Active time is a proposed
  initial enforceable unit; current token/cost fields are not a spending meter.
  Reserved report/review allowance is needed when the worker's allocation ends.
- Privacy, cancellation and external-effect controls are existing requirements,
  not optional features to eliminate for noun count. A team edge cannot supply
  access to private memory or authority to send external messages.
- Restricted memory maintenance remains an internal process without a Buddy
  identity. That exception is proposed explicitly because the literal “every
  background process” rule conflicts with the accepted independent reviewer.
- The owner model preferences are retained exactly. Actual task-specific model
  choice and cost measurement require missing implementation; the current
  source/native evidence must not be described as already supporting them.

## Evidence and its limits

The [native snapshot](native-observations.json) records 45 pre-review project
observations across the Lead and two reports, of which 23 were open with 95
unfinished todos; 97 available Lead run records; six coordination rows; and
current readiness. It does not contain every historical transcript or global
usage. Existing status/evidence can be stale, so source and prior verification
reports are checked separately.

Original UI/release/coordinator failures remain terminal and their allowances
are exhausted. Reliability repair is recorded complete. These observations
support reliable reporting and effort/elapsed-time separation; they do not
prove the proposed complete lifecycle has passed a real-team journey.

Sources S01–S24 have dated full-content hashes and preserved excerpts. The host
HEAD at capture was `1187a8b6660b95c0c60bd8fada105f015b98cc39` in a modified
shared worktree. The package provenance reports source commit
`b70c0def1373034aeff56e409adb97d66ff6d7f7`; this review did not independently
rebuild that package. Historical verification counts are reported as historical.

## Reconsideration criteria

Revisit the recommendation if real tasks repeatedly make the Desk restriction
cause pointless delegation; reusable workers measurably contaminate contexts
despite scoped retrieval; task-owned identities give better follow-up with less
total management; multiparty discussion cannot be served through task-linked
messages/docs; or existing services cannot enforce report/accounting transactions
without conflicting authorities. Record that evidence and append a successor.

Before implementation, settle the proposed defaults in the design comparison:
worker reuse/lifecycle, Desk boundaries and name, report triggers, closure/review,
budget unit/renewal authority, reserved review capacity and the maintenance
exception. This review writes the candidates; it does not select unspecified
limits, start background assignments, alter staffing, or push code.

## September 13 successor — handoff incorporation and one limits policy

The owner subsequently requested explicit incorporation of the pending delivery
handoff and removal of repeated budget/limit rules. The owner specified that a
worker reaching its boundary should report to the main Buddy for evidence-based
review, then resume that same worker if more effort is useful, or stop/replan,
split tasks and reuse or assign coworkers as appropriate.

Status: **owner-stated product direction**. Detailed accounting, numeric values,
command shape and runtime implementation remain proposals. This does not select
every detail of Design 1 or approve new operational assignments.

The [dated successor](06-handoff-and-limits-successor.md) preserves the exact
wording, handoff mapping, alternatives, tradeoffs and reconsideration criteria.
[Budgets and limits](../BUDGETS_AND_LIMITS.md) is now the single policy reference;
the earlier recommendations above remain historical decision evidence.
The [pre-consolidation snapshot](limits-consolidation-before.json) preserves this
record before append at SHA-256
`8453d7889a436f0b6a90d7fbf64c510898b8f53df46b840d97688f731c762162`,
alongside the previous owner design, candidates and complete handoff sources.

## September 13 successor — parent-owned Workers and correspondence versus execution

The owner clarified that one Worker should handle a coherent batch of related
tasks, rejected task-owned worker lifetimes, preferred the name Workers, and
specified invisible temporary helpers tied to one Buddy using ordinary Buddy
infrastructure. Those are owner-stated direction. The owner also tentatively
proposed splitting email-like asynchronous messages from executing a prompt in
context. Mail/Prompt names and the precise delivery/execution/wait contract are
assistant proposals; no final native API selection is implied.

The prior identity/task separation still holds. The batch example changes the
lifetime choice: a Worker continues across related outcomes and feedback without
becoming a permanent standalone employee or a new identity per task. The
inventory's Document is clarified as versioned content/reference infrastructure,
not another required editor or document service. Budget policy stays centralized.

The [dated successor](07-workers-mail-and-prompt-successor.md) preserves exact
owner wording, attribution, rationale, alternatives, tradeoffs, unresolved
retirement/context rules and reconsideration criteria. Design 2 is now rejected;
Design 1 is refined by this successor; Design 3 remains unselected. The original
comparison body remains historical evidence.

The [pre-clarification snapshot](workers-mail-before.json), captured at
`2026-09-13T04:58:53.279774+00:00`, preserves six full source versions and hashes.
This record's pre-append SHA-256 is
`926c69b1311ea2d6ba2032599d8c09df2b4237e8f1cf8b3993e579375e6fb7e2`.
Documentation-only implementation and preservation checks are recorded in the
[verification](workers-mail-verification.json). This decision does not convert
existing staff, launch workers, send team messages or change native operations.

## September 13 successor — frequent check-ins and maximum solo work sessions

The owner tentatively reframed “budget” as time until required report-back or a
maximum solo work session, and explicitly wanted more frequent Worker check-ins.
The [dated successor](08-check-ins-and-solo-sessions-successor.md) preserves the
exact wording, predecessor hashes and excerpts, attribution and tradeoffs.

Assistant recommendation: use separate check-in and required-review clocks.
Routine progress reports allow work to continue but do not extend the session;
an explicit lead decision can grant the same Worker a new bounded session.
Keep aggregate resource constraints separate. Numeric defaults and mechanics
remain proposals; this is a documentation refinement, not runtime behavior.
