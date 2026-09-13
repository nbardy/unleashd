# Allowances, renewable effort and autonomous continuation

Historical analysis. The current specification is [Buddy budgets and limits](../BUDGETS_AND_LIMITS.md),
updated by the [owner follow-up](../final-designs-2026-09-13/06-handoff-and-limits-successor.md).
The discussion below preserves the predecessor rationale; it does not define a
second current policy.

September 13, 2026 · Handoff 5, with capacity, model-selection and worker-lifecycle implications.
The owner's preference for continued authorized work is distinct from the proposed renewal
mechanism. No limit or live policy is changed by this document.

## 1. Desired behavior

The supplied owner preference is straightforward: keep controls that prevent runaway work,
but do not make a genuinely difficult task stop routinely for human approval of more time.
The system should help employees finish worthwhile authorized work, learn from unsuccessful
attempts and involve a manager when the approach needs to change.

“Bounded” should describe accountable resource use and authority. It should not mean an
arbitrary first estimate is the final answer about how long a hard problem deserves. A
ten-minute runtime watchdog, an hour-long assignment deadline, a team concurrency ceiling
and an owner budget are different controls. Treating any one of them as the others produces
both unnecessary stops and loopholes.

The proposed target is renewable task allocations inside an explicitly granted aggregate
envelope. Renewal does not revive old execution authority. It authorizes another bounded
attempt or tranche, preserves consumed resources and records why further effort is justified.
This requires actual policy and accounting; a manager's prose saying “keep going” is not a
substitute for an enforced resource boundary.

## 2. Provenance: why limits entered the design

The August 21 automation reference describes `max_runtime_seconds = 600`, ten iterations,
a nominal 50,000-token field and snapshotted run policies. It also reports no recorded usage
in the observed token/cost counters. It establishes early limits, but not an original owner
request for those exact numbers. [S12](08-source-evidence.md#s12)

The accepted August 24 design responds to a different and concrete failure: leases,
in-memory scheduler state, conversation bindings and provider processes could disagree about
who still owned execution. An expired lease did not prove the old process was dead. Opening
an old transcript could regain mutation authority. The chosen design makes durable claims
authoritative, terminal states absorbing, and release dependent on provider shutdown and event
drain. [S13](08-source-evidence.md#s13)

September 9's coordination design added hourly activations, sends, pending and active-run
controls. It explicitly said to latch background work paused until owner resume after the
activation/send cap, and interactive access remained subject to active slots. That was a
specific anti-runaway policy; the new owner preference challenges its routine human bottleneck.
The phrase “bounded allowance” appears in the recurring-Chief proposal. The same historical
proposal includes wakeups in a current conversation and self-continuation examples that
should not be copied over the current background-placement and managed-continuation contract.
[S14](08-source-evidence.md#s14), [S15](08-source-evidence.md#s15)

September 10's background-work document records the owner's direction to put completion
criteria on tasks, work until completion and return. It explicitly calls the chosen API and
lifecycle implementation decisions by Buddies Development Lead. Its bounded chain was a
mechanism for that goal, not evidence that the owner wanted every difficult task escalated
after a fixed estimate. [S16](08-source-evidence.md#s16)

September 12–13 recovery work preserves consumed budgets and old failure receipts while
allowing an authorized controller to create one linked successor in supported cases. That
is progress in recovery, but it does not implement a new aggregate budget or renewable
allocation policy. [S17](08-source-evidence.md#s17), [S18](08-source-evidence.md#s18)

## 3. What is enforced today

The current native managed-work contract defaults to 20 admitted attempts and 3,600 seconds,
with schema maxima of 100 and 86,400. Duration starts from first admission, and waiting for
children consumes that elapsed duration. Each attempt also has an effective runtime bound
clamped to remaining overall time. Successful unfinished attempts can continue within the
same obligation. [S06](08-source-evidence.md#s06), [S24](08-source-evidence.md#s24),
[S27](08-source-evidence.md#s27)

Failures, interruption, cancellation, concrete blockers and exhaustion are distinct outcomes.
A supported closed-timeout recovery can preserve the old failed receipt and create a linked
successor while original budget remains. Zero remaining budget is not repaired by replay;
further authorized work uses a new explicit bounded assignment under the current contract.
That ability must not be described as an aggregate anti-reset guarantee that does not exist.

The current ownership guide states that wall-clock and iteration limits are enforced, while
token/cost fields are compatibility data rather than measured spending controls. The system
does not currently offer a verified CEO-controlled dollar pool. [S05](08-source-evidence.md#s05)

Foreground has a separate explicit application deadline and should keep it. Handoff 1 asks
to remove background-capacity coupling; it does not ask to eliminate all per-turn watchdogs.
Independent memory maintenance has its own deadline and restricted capability. Increasing
task effort cannot widen either process's authority implicitly.

## 4. A taxonomy of limits

| Control | What it measures or bounds | Normal response at boundary | Why it cannot stand in for everything else |
|---|---|---|---|
| Foreground deadline | Maximum duration of one owner turn | Truthful timeout and drain | Does not allocate autonomous team resources |
| Attempt watchdog | Duration/liveness of a provider attempt | Checkpoint if possible, terminal disposition and drain | A hung process is different from a hard but progressing task |
| Task estimate | Expected effort before useful review | Progress checkpoint and reconsideration | Estimates are uncertain and should be renewable |
| Attempt count | Number of admitted execution attempts | Reconcile progress/limits | One attempt can be tiny or expensive |
| Active execution time | Time actually executing, if metered | Charge to selected effort account | Does not express a calendar deadline or money |
| Elapsed deadline | Time since a defined start | Mark stale/expired work according to policy | Waiting consumes elapsed time even with no active process |
| Concurrency | Simultaneous resource occupancy | Queue eligible work | Limits rate of consumption, not total consumption |
| Rolling activation/send cap | Activity over a window | Timed wait for ordinary exhaustion, or explicit breaker policy | Counts messages/runs, not task value |
| Aggregate resource ceiling | Authorized total across a root/team/period | Prevent new reservations when exhausted | Requires accounting and a selected scope |
| Owner-only action boundary | Permission for a specific effect | Obtain the required explicit authorization | More time or budget does not grant action authority |

This table is a proposed product vocabulary, not a claim that all listed meters already
exist. The first implementation should display the actual enforced unit. “Execution seconds
remaining” is honest when that is what is measured. “Dollars remaining” is not honest unless
provider usage, pricing treatment and enforcement actually support it.

## 5. Renewable allocations inside an aggregate envelope

The proposed design separates the outer authorization from internal estimates. An owner
selects the aggregate scope and limit, and grants a manager defined allocation/renewal
authority. The manager divides effort into bounded tranches for one or more assignments.
Execution consumes the same aggregate allowance across retries, children and successor
requests that belong to that authorized family.

The aggregate identity must be host-issued and durably bound to the assignment lineage.
It cannot be a caller-controlled string that can be replaced after exhaustion. A new Buddy,
new conversation, different model, new send key or reparented project must not accidentally
refund the root's consumed resources. At the same time, a genuinely new owner-authorized
project needs an explicit way to receive a new envelope rather than being attached forever
to an unrelated historical root.

There are at least three independent scopes to choose:

1. **Purpose scope:** one assignment/root, one project, one team, or one workspace.
2. **Time scope:** one bounded campaign, a rolling period, a fixed reset window, or a deadline.
3. **Resource scope:** measured compute time, provider usage, priced cost, or an explicitly
   defined abstract unit.

These choices should not be hidden behind one `budget` integer. A practical first version
may use execution time and attempt controls while honestly reporting missing dollar data.
A later monetary meter would need price versions, coverage, delayed reports, subscriptions,
caching, failed requests and external charges to be handled explicitly.

The aggregate concept may require a small new durable account/allocation authority. Reusing
existing resources does not mean placing mutable balances in project prose. What should be
avoided is a replacement workflow engine or multiple components each keeping a different
balance. The minimum accounting mechanism must still be atomic and observable.

## 6. Reservation and settlement semantics

If two managers can allocate from the same remaining pool, both must not spend its final
capacity based on a stale read. A useful accounting invariant is:

`consumed + outstanding reservations <= authorized ceiling`

This applies within the chosen unit and enforcement assumptions. An estimate cannot prove
a hard dollar cap when actual usage arrives later or an external process can consume beyond
its reservation. Such a system must either reserve a defensible bound, constrain execution,
use a documented safety margin with bounded overrun, or describe its ceiling as advisory.

Proposed transaction behavior:

- Reservation and eligibility commit together at the authoritative admission/allocation seam.
- A stable command key makes duplicate renewal return the same allocation.
- Settling an attempt charges observed consumption once and releases only demonstrably unused
  reservation, without deleting historical charges.
- A failed or cancelled attempt still consumes what it used; cancellation does not mean refund.
- A process whose drain/effects are uncertain retains an explicit uncertain settlement state;
  do not reclaim all resources merely because its lease expired.
- A successor links to the same aggregate account and records its tranche ancestry.

The manager's own planning/review and any worker children must be included or explicitly
assigned to a separate visible account. Otherwise a cheap worker budget can be “respected”
while an expensive lead spends unbounded effort deciding whether to continue it. Memory
maintenance and non-provider resources need equally explicit treatment when aggregate host
or spending claims are made.

## 7. What a progress checkpoint should contain

A checkpoint should help a manager decide whether more effort is worthwhile and help the
next attempt resume safely. It is not a request to re-explain the entire history at every
timer boundary. Useful content includes:

- current canonical criteria and the artifact/version being worked on;
- observations since the last checkpoint, including informative failed experiments;
- what changed in the hypothesis or implementation;
- saved artifact refs and effects already performed;
- remaining uncertainty and what the next tranche is intended to resolve;
- a bounded estimate, resource request and reason to change model or approach if applicable.

Save artifacts before registering a checkpoint. A checkpoint records an attestation of saved
references, not proof that the files remain present or that every external effect is safe
to repeat. Current recovery already requires effects inspection for this reason.
[S17](08-source-evidence.md#s17), [S18](08-source-evidence.md#s18)

Progress must not be measured only by changed lines or successful tests. An investigation
that disproves three plausible causes may earn another tranche even with no patch. Conversely,
repeated reassuring summaries with no new observation should not be sufficient for infinite
self-renewal. The system needs evidence of information gained or a credible change in plan,
with room for long commands and research that have naturally sparse intermediate output.

Checkpoint frequency is a design choice. Too frequent can spend more effort on narration
than work; too sparse can lose recoverable context on timeout. Use phase boundaries and
before/after material effects, supplemented by bounded runtime checkpoints where feasible.

## 8. Manager renewal and intervention

Within a pre-authorized envelope, the manager can choose to continue, replan, change execution
profile, obtain a targeted second perspective, narrow the next experiment or stop. These are
management choices about already authorized work. They should not routinely require the owner
to adjudicate an initial time estimate.

A possible decision table is:

| Observation | Proposed manager response |
|---|---|
| Failure isolated; next test is concrete and affordable | Renew a bounded tranche |
| Useful uncertainty reduction but no solution yet | Renew if expected information is worth the remaining resource |
| Same command repeatedly fails for the same reason | Change approach or repair environment before more execution |
| Work is waiting for a known child/review | Release compute occupancy; wait on a durable dependency |
| Required artifact is missing after an uncertain effect | Inspect/reconcile; do not blind-replay |
| Worker repeatedly misses clearly specified criteria | Improve the handoff, change model or reassign deliberately |
| Aggregate ceiling exhausted | Apply the selected exhaustion policy; owner expansion only when needed |
| Owner cancels the assignment | Fence the entire intended causal family; no renewal |

A manager title alone does not authorize renewal. The implementation needs to bind which
manager can allocate from which envelope and how much discretion it has. The owner need
not approve each extension once that authority is granted. Delegated renewal must not let
managers mint new outer accounts or expand the hard ceiling through staffing or task splits.

If no manager is running, the system must decide how renewal review gets admitted. A parent
whose own envelope has already expired cannot magically resume to approve a child. Reserve
bounded coordination capacity/allowance, schedule a separate authorized management review,
or use another explicit controller policy. This interaction is a central reason to design
parent and worker budgets together.

## 9. Waiting time, calendar deadlines and multi-day work

Current child waiting consumes the chain's elapsed duration. That is coherent for “finish
within an hour,” but poor as a proxy for “spend an hour of useful effort, then let me review
tomorrow.” Handoff 4's multi-day worker makes the difference visible.

Recommendation: display and eventually model effort allocation separately from calendar
deadline and waiting eligibility. A sleeping worker consumes no active process slot, while
its obligation may still have an expiration to prevent forgotten work lasting indefinitely.
If review is expected tomorrow, the contract must allow that wait explicitly rather than
pretending the original one-hour wall-clock envelope survived.

Whether ordinary waiting pauses a task clock is not a tiny implementation detail. It changes
the meaning of stored duration values and recovery. Preserve old envelopes as originally
defined. A new policy version or explicit renewal should state the new meaning; do not
retroactively refund elapsed time on historical attempts.

Normal rolling rate limits should expose when work becomes eligible again and resume
automatically under the chosen policy. An explicit owner pause should remain paused. A
runaway circuit breaker is different again and should state what evidence tripped it and
which controller can clear it. One `background_paused_reason` string currently carries
several of these meanings; future typed causes should separate them without deleting
historical reasons.

## 10. Terminal authority, recovery and planned continuation

Planned continuation after a drained successful attempt is easier than recovery after a
crash. The existing runtime can inspect canonical work and queue the next eligible bounded
attempt. A failed attempt may have uncertain external effects; restarting it blindly can
duplicate actions. The August single-owner decision still applies even when the product
becomes more autonomous.

Keep four actions distinct:

1. **Continue:** another attempt in the same open obligation within existing bounds.
2. **Recover:** a linked attempt/successor after inspecting a supported failure, preserving
   old receipts, limits and effect history.
3. **Renew:** a recorded allocation change or new tranche under already-granted aggregate
   authority, without increasing that aggregate ceiling.
4. **Authorize new scope:** an owner decision to widen the outer resource or action boundary.

The current `retry_run` performs a bounded recovery role. It should not silently become
an allocator that resets exhausted time. A future renewal operation may compose existing
messages/attempts and a new allocation record, but it must make the changed authority
reviewable and auditable. Old failed messages remain failed even when a successor succeeds.

Cancellation wins over pending renewal and late replies. Project execution epochs, stopped
roots, deleted destinations and current grants must be rechecked atomically before admitting
any successor. Revoking authority is immediate; releasing process occupancy still waits for
drain. A watchdog cannot label an automatic expiry `user_stop` merely to reuse cancellation
code, because that destroys the distinction the recovery policy needs.

## 11. Interaction with foreground access and model choice

The owner must be able to discuss blocked work even when background allowance is exhausted.
That is the foreground entitlement from Handoff 1. Talking about the task does not itself
replenish autonomous resource accounts. The user may explicitly grant more scope in that
conversation; the host then needs the appropriate durable authorization transition.

A model change can improve the next tranche, but its cost and capability should be accounted
for explicitly. Reducing worker inference expense does not grant unlimited concurrency.
Escalating to a more capable model does not prove further effort is justified. The review
record should connect the change to a concrete failure or need and capture effective
configuration for the actual attempt.

Task-lived workers make accounting more important: spawning a new identity must not create
a fresh free allowance. Reusing a standing employee must not charge an unrelated assignment
merely because it shares the same Buddy ID. Purpose lineage and account allocation belong
to work, while identity remains the responsible actor.

## 12. Migration and acceptance

Do not reinterpret existing 20-run/3,600-second requests as automatically renewable. Ship
the new policy with explicit versioning and selected scope. Historical requests keep their
limits and recovery semantics. The UI must show requested and effective limits, consumed
resources, waiting reason, next eligibility and the controller able to act.

The meaningful boundary tests are concurrent reservation, idempotent renewal, failed/cancelled
consumption, restarted accounting, child lineage, model changes, delayed/unknown usage,
exhausted parent coordination, and cancellation racing a successor. A simulated difficult
task should obtain another authorized tranche without a human message while an unproductive
loop triggers intervention. A stopped root and genuinely exhausted hard ceiling must still
refuse new execution.

Evaluate the user outcome with a multi-stage assignment that waits on a child, reports a
useful failure, changes approach and completes. Observe real receipt and artifact evidence
across the whole journey. The aim is dependable continued work with intelligible limits,
not the appearance of autonomy produced by repeated new requests that erase their own cost.
