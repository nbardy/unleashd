# Foreground owner access, capacity and waiting

September 13, 2026 · design review of Handoff 1, with implications for Handoffs 2, 4 and 5.
Owner direction is reported in the supplied handoff; mechanisms below are recommendations.

## 1. Product problem and intended outcome

An owner opening an idle Buddy conversation should be able to talk to that Buddy while
autonomous work is busy. Background concurrency controls exist to regulate unattended
execution. They should not make the employee unavailable to the person directing it.

This is both a scheduling defect and an interaction defect. The reported failure made an
accepted owner message appear briefly, disappear, and leave an apparently empty conversation
with a generic queued indicator. Even if work eventually started, the interface gave the
owner no dependable account of whether the message had been received, what was blocking it,
or whether sending again would help. A later conversation winning capacity compounded the
impression that the original input was lost.

The target is a clear invariant: **background saturation cannot deny admission to an
otherwise eligible foreground owner turn.** Foreground classification must come from the
host's trusted input path. It cannot be a field a background agent sets on its own request
to escape controls. The owner can ask for extensive autonomous work from a foreground chat;
that request does not make every descendant foreground.

## 2. Reported incident and corroborating source

The handoff reports two active runs and a membership limit of two. Conversation
`89d40447-9d68-4b53-9688-67c154dbfae2` was created at 03:28:15.562 UTC. A newer conversation,
`fd2b4690-a228-47d4-82fd-8e81b6573098`, was created 16 seconds later and claimed the next
available slot at 03:29:35.278. By 03:36:16.049, the older conversation had accumulated 458
attempt records, 457 terminal `spawn_failed` records and no running provider attempt.
These counts are historical incident evidence, not new measurements. [S01](08-source-evidence.md#s01)

The inspected installed package still contains the relevant coupling:

- `coordinationActiveCounts()` combines active coordination rows and automation occurrences,
  projecting only `buddy_id`.
- `beginBuddyChatRun()` marks the run `foreground: true` and uses the shared claim path.
- Admission bypasses background enablement, pause and hourly-run checks for foreground,
  but applies the active global/per-Buddy count regardless of that flag.
- The global active threshold is eight in this path. A membership's `max_active_runs` is
  compared against all counted active rows for that Buddy.
- A failed foreground claim becomes a generic English error, losing the structured blocker
  reasons that admission computed.

The Unleashd runtime ends the attempted spawn as failed, removes the last user message for
this error, broadcasts the conversation and throws a local capacity exception. Queue
processing then restores a pending item, makes another attempt identity, and arms the
capacity retry timer. [S25](08-source-evidence.md#s25), [S28](08-source-evidence.md#s28)

This review confirms those source paths, not every reported UI rendering or the precise
current live run count. The old runtime test deliberately expected the capacity-wait-and-retry
behavior; it must be replaced with the desired foreground policy when implementation occurs.
[S33](08-source-evidence.md#s33)

## 3. Separate the constraints before changing admission

Several conditions can all look like “cannot start,” but they have different meanings:

| Constraint | Intended scope | Proposed foreground behavior | Background behavior |
|---|---|---|---|
| Same-conversation serialization | One destination transcript | Wait behind its active turn | Same rule |
| Per-Buddy background concurrency | Employee's autonomous execution | Does not deny foreground | Queue at limit |
| Global background concurrency | Autonomous processes sharing host resources | Does not deny foreground | Queue at limit |
| Background enablement and explicit pause | Autonomous permission/policy | Ordinary owner chat remains available | Preserve configured hold |
| Background hourly allowance | Autonomous activation or send activity | Does not consume owner-chat entitlement | Current latch; proposed timed wait for ordinary exhaustion |
| Invalid identity, audience or membership | Authority to act in the requested scope | Reject clearly | Reject clearly |
| Application startup or unavailable provider | Runtime readiness | Visible specific failure/wait policy | Same underlying infrastructure limitation |
| Actual hard host safety limit | Resource protection | Dedicated explicit policy required | Dedicated explicit policy required |

The first repair should not replace all these with “always allow.” Foreground exemption is
from background execution limits, while existing authority and same-thread serialization
remain. A sleeping worker identity consumes no active provider slot. A stopped but undrained
process still occupies resources until shutdown and event consumption finish.

The true host ceiling requires careful language. No finite machine can promise unlimited
simultaneous execution. The owner's rule can be met at the application-policy boundary by
reserving foreground headroom or treating background concurrency as a soft threshold below
a separate safety ceiling. The product must expose actual resource unavailability honestly;
it must not disguise a background quota as a host emergency.

## 4. Capacity accounting must retain classification and scope

Changing only the foreground candidate's guard is incomplete. If foreground runs remain in
the background count, owner conversations can still consume every autonomous slot. The
counter must distinguish at least foreground from background for both candidate admission
and occupancy inspection.

The existing query also deserves a scope decision. The limit lives on a workspace membership,
but the active rows are filtered by Buddy ID without workspace. A Buddy active in two
workspaces can therefore use one workspace's configured threshold against a cross-workspace
count. That may have been intended as total employee concurrency, or it may be accidental;
the source alone does not establish the rationale. The revised design must name the unit:

1. Per membership: Buddy plus workspace, controlling local autonomous capacity.
2. Per Buddy: total concurrency across workspaces, with a separate setting if needed.
3. Per host: global process/resource protection.

Do not silently change the scope as part of the foreground fix. Record a choice and include
a two-workspace fixture. If existing stored values become background-only, document that
semantic migration and how inspection displays it.

The model is not the admission class. A Luna owner turn remains foreground, and an Astra
autonomous review remains background. Model-dependent resource weights might eventually
improve host management, but the supplied material contains no measurements to justify a
weighted scheduler now. The memory maintenance queue is another real process consumer;
independent reviewer limits do not make its host footprint disappear.

## 5. Waiting should describe an obligation, not manufacture failures

The current loop conflates a scheduling wait with a failed provider start. A durable accepted
input should retain one identity while waiting. The system can record eligibility changes
without creating hundreds of failed execution attempts when no provider was invoked.

Proposed distinctions:

- **Accepted input:** the server has retained the owner's content and acknowledges it.
- **Waiting input:** retained content is not yet admitted, with a specific reason.
- **Admitted attempt:** a particular execution owns the input and its authority.
- **Running attempt:** the provider has actually started, separately observable from admission.
- **Terminal attempt:** success, failure, cancellation or timeout, with history retained.

These are conceptual facts. They do not mandate five new tables or a new event ledger. Reuse
the existing queue, turn-attempt journal and run receipt authorities, but stop using a failed
spawn record to represent normal scheduler patience. A pre-admission error such as an invalid
model is also different from waiting: retain the input and show a repairable error instead
of endlessly retrying the same invalid configuration.

Prefer wake-up from the canonical capacity-release/admission path for legitimate capacity
waiters. A low-frequency reconciliation pass may remain useful after missed notifications
or restart, but it must be idempotent and must not create a failure record on every scan.
The design should not add a second scheduler alongside existing coordination merely to
replace the conversation-local timer.

Durability needs a real boundary definition. Source comments call the app queue durable,
but the acceptance test should reopen persisted state to establish what survives restart.
Trusted owner-input provenance must not be reconstructed from an arbitrary serialized
foreground flag. Recovered input needs the same authorization discipline as fresh input.

## 6. Input visibility, titles and commands

The user should see a stable submitted message or queued card from acceptance onward.
Moving from pending to admitted should transfer or reconcile the same input, not create a
duplicate transcript message. A capacity failure must not turn an accepted nonempty
conversation back into `New conversation` merely because it temporarily has no admitted
transcript rows.

Useful presentation includes:

| Situation | User-facing wording | Useful action |
|---|---|---|
| Another turn in this conversation is active | “Waiting for this turn to finish” | Cancel this queued input or inspect the active turn |
| Background request waiting for a slot | “Waiting for background capacity” | Inspect work and effective limit |
| Future scheduled eligibility | “Scheduled for …” | Inspect or cancel the intended occurrence |
| Background explicitly paused | “Background work is paused” | Inspect the recorded pause and authorized controls |
| Provider/configuration failure | Specific failure with retained message | Correct configuration and retry the same input |
| Terminal root cancellation | “Stopped” with historical reason | Review saved effects; no automatic wake |

The same structured cause should drive desktop and mobile. Components should not infer
cause from `queue.length`. A field-name proposal such as `waitReason` is only a sketch;
the actual transport change should fit the existing conversation summary/queue contract
and one WebSocket message spine. Client list derivation, per-conversation subscriptions
and shared mobile-safe components remain repository invariants.

Controls must name what they stop. Cancelling one queued owner message is different from
stopping the active conversation turn or stopping an entire delegated root. A generic
“Stop” that changes meaning with the current selection would weaken the otherwise clear
separation of control and execution.

## 7. Fairness: resolve the apparent FIFO conflict

Handoff 1 asks that newer accepted work not overtake older waiters. It also asks for owner
chats to remain immediately available while background work is saturated. A single global
FIFO queue cannot express both requirements in all cases.

The recommended contract is deterministic admission **within an eligible class and scope**.
Foreground and background have explicit capacity policies. A foreground message need not
wait behind an older background request that cannot obtain a background slot. Within one
conversation, preserve submitted order. Within comparable background waiters, use a durable
sequence or timestamp plus stable tie-breaker, rather than whichever timer fires first.

Eligibility is important: an older request held by `notBefore`, missing authority or an
explicit pause should not block every younger runnable request. Fairness must not mean
head-of-line paralysis. If future priority classes are needed, specify aging or another
anti-starvation policy and show the reason for an overtaking decision. No such multi-priority
scheduler is selected by this review.

Foreground headroom also must not become arbitrary preemption. Killing an admitted worker
to answer an owner can lose work or leave effects uncertain. Reserving capacity, reducing
future background admissions, or giving an explicit operational error at a genuine hard
ceiling is more compatible with the existing drain contract than silently interrupting
healthy work. The exact hard-ceiling policy remains open.

## 8. Implementation seams and migration

The package is authoritative for coordination admission. Work in its source repository and
vendoring flow; editing an installed `node_modules` copy would create an unreviewable runtime
variant. The host runtime owns owner-input visibility, per-conversation sequencing and
turn-attempt lifecycle. The client displays the server's structured reason. The vendoring
tool records a clean source commit and archive provenance. [S25](08-source-evidence.md#s25),
[S28](08-source-evidence.md#s28), [S32](08-source-evidence.md#s32)

A useful staged change is:

1. Classify capacity and candidate admission in the package, preserving identity/scope checks.
2. Replace the foreground capacity-wait regression with real packaged-store admission tests.
3. Remove or narrow the runtime's capacity pop/retry branch; preserve input on all start errors.
4. Expose legitimate waiting causes through the existing transport and shared UI.
5. Verify persisted queues, duplicate prevention and package/runtime parity.

An existing failed attempt remains failed in history. Migration should reconcile still-pending
inputs into the revised waiting/admission behavior without rewriting historical attempts or
resending accepted content twice. Do not mass-clear live queues as a migration shortcut.

Preserve the separate September 10 foreground deadline fix: pass `TURN_MAX_RUNTIME_MS`
explicitly through foreground claims, and record timeout as `max_runtime_timeout`, not
`user_stop`. Capacity entitlement is not a reason to drop runtime deadlines or cancellation.
[S21](08-source-evidence.md#s21)

## 9. Evidence required to call the repair complete

One integration fixture should hold real package background runs at both local and global
thresholds, submit a foreground message through `Conversation`, and verify first-attempt
provider start, visible input, one admitted/running attempt and no failure storm. A second
background request must remain constrained. Include foreground occupancy exclusion and a
cross-workspace case once scope is selected.

Also verify same-thread FIFO, an ineligible older background request, simultaneous claims,
cancellation during drain, restart with retained input, and invalid identity/model failures.
Use a controlled provider for deterministic boundary tests and a bounded actual-provider
smoke check for rollout; these prove different things. No load-test claim follows from a
fixture that starts two mock processes.

The product acceptance is simpler than the internal matrix: the owner can reach an idle
Buddy while background work is full, sees their message continuously, understands any real
wait, and never has to send a duplicate to make the system notice it.
