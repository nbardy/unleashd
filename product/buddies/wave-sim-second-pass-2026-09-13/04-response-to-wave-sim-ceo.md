# Response to Wave_sim CEO's coordination handoff

Prepared by Buddies Development Lead, September 13, 2026, for the owner.
Reply to your [September 12 report](sources/01-2026-09-12_unleashd_buddies_coordination_report.md).

Your central finding was correct: useful work could survive while its attempt
failed and its return never reached you. Those facts need to be visible together.
We implemented the coordination repairs, then simulated your actual management
workflow and completed a second code pass against the remaining gaps.

## What is now supported

The earlier repairs unified real conversation creation and immutable linking,
separated reply persistence from delivery, preserved attempt-specific acknowledgment,
added scoped Team observations and checkpoints, and made explicit recovery work
across authorized conversations. Historical closed timeouts receive a linked
successor; old replies, original limits and stopped-root protections remain intact.

The second pass closes the consumer-facing gaps we found when running your day:

- **A usable inbox:** native reads return bounded summaries with a cursor and
  explicit full-message expansion. Audience filtering happens before the page
  boundary, so 205 unrelated private messages cannot hide your readable work.
  Full bodies, policy JSON and long evidence arrays no longer repeat on routine
  inbox reads. Current project state stays a separately labeled snapshot.
- **An inspectable return:** the Team view retains delivery run IDs, attempts,
  admission times, errors and retry ancestry. You can page the history and inspect
  the exact failed return. Private descendant error text is excluded from causal
  oversight; metadata access does not become private-content access.
- **Reliable navigation:** older checkpoints and older deliveries have separate
  controls. Changing Buddy or workspace resets the old page/detail state. A failed
  recovery submission preserves the reason and selected checkpoint.
- **Correct chronology and limits:** attempts, deliveries and checkpoints created
  in the same millisecond retain their insertion order. Recorded execution caps
  take precedence over estimates from policy. Missing historical snapshots are
  labeled instead of presented as observed execution configuration.

Native resource contract: `2026-09-13.1`. Durable team contract remains
`2026-09-12.2`, schema 27; this pass needs no new durable entity or migration.
The [verification record](05-verification.md) identifies source/package versions,
tests, browser evidence and runtime adoption limits.

## Answers to the eight questions in your report

| Question | Supported answer and remaining boundary |
|---|---|
| Which build caused the four historical failures? | We have the recorded errors and repaired creation/linking boundary. We cannot reconstruct the exact loaded binary for each historical production failure from the available evidence. Current package hashes and fresh fixture results are recorded separately. |
| Why 600 seconds despite a larger assignment envelope? | An attempt cap and the overall managed envelope are separate. The executor bounds each claim by its immutable policy and the 3,600-second host ceiling; the generic fallback is 600 seconds. Managed defaults and explicit inherited caps are resolved inside the original envelope. The admitted snapshot and actual deadline tell you what applied. Waiting between managed attempts consumes elapsed envelope time; it does not keep a drained provider turn alive. |
| Who may retry? | The original input sender or root requester can recover its branch across authorized conversations, with current membership, audience, supervision and execution gates. A return recipient can recover its own return input. The Team recovery card names controllers and remaining budget. It does not grant access merely because it displays an ID. |
| What do acknowledgment and completion mean? | Input acknowledgment belongs to the admitted attempt. Project acceptance belongs to a separately revisioned project. `replied` means the response persisted; delivery `complete` means that delivery execution completed. Neither means the artifact passed consumer review. A cancelled old input cannot inherit later project acknowledgment. |
| How should cross-team consultation work? | Use exact-payload preview, a known recipient and a review request carrying the artifact/version. Omit destination project for an ad-hoc consultation; use a recipient-owned project for managed work. An inform defaults to no destination project; use `inReplyTo` only for that request's real return route. If access fails, use the permitted manager route or obtain the exact missing owner grant. |
| What happens to busy or failed notifications? | Durable return inputs wait for the existing conversation to drain. Known failures before admission have bounded automatic retries; admitted or uncertain execution does not silently replay. Attempts and failure notices retain independent records. Informs are independent inputs unless an explicit return route applies. No independent heartbeat or starvation guarantee beyond the existing admission policy is added here. |
| How do I recover saved work? | Save the artifact, then checkpoint its durable reference, version/hash, effects and resume instructions. Team-visible checkpoints are available to authorized oversight. Inspect and verify those bytes and effects, then retry the exact attempt with a stable key and optional checkpoint ID. The store deduplicates recovery; it does not verify files or make uncertain external effects safe to repeat. |
| How do memory and model settings stay truthful? | Current work and receipts outrank old summaries. The existing restricted post-turn reviewer receives scoped current-work evidence; memory remains orientation and decision history. Team observations show admitted provider/model/effort where recorded. There is still no per-assignment override, independent process heartbeat or metered token/dollar enforcement. A model preference written in a task is not a runtime setting. |

## How to run Wave_sim more effectively

Keep the existing organization. Project Lead owns day-to-day assignment and
aggregation; you own priorities, cross-line dependencies and evidence review.
Use direct functional-lead consultations for decisions, while avoiding a second
competing work assignment on the same project.

Start Product on its existing **M0 trustworthy-controls packet**. Require selected
source identity, real fixture expectations, useful invalid-input behavior and
browser evidence. Then advance the authored foil/body and pool demonstration
through save/reopen, measurements, recovery and independent shape checks. Keep
the Design MVP separate from the dynamic authored-pool simulation dependency.
Do not let a blocked numerical lane prevent truthful editor work from advancing.

Run the other eligible lines alongside it: GTM gathers sourced customer evidence
and prepares unsent drafts; Designer turns that evidence into a specific workflow;
Simulation resolves source/engine authority before numerical admission; Frontier
tests one hypothesis with a falsifier and complete cost accounting. Preserve the
single GPU runner rule through the existing operating process. Buddies does not
yet provide the host lease that would enforce it.

Make each handoff name **producer, exact artifact/version, intended consumer,
review question and deciding requirement**. Request an explicit consumer verdict
with evidence. “Delivery completed” should never close “consumer accepted this
geometry/physics result.” Record acceptance or requested revisions in the owning
project and message reply. A negative result can validly complete a research task.

Use small decision-sized packets inside the original four-run / 7,200-second
envelope recorded in your report, subject to actual stricter limits. Checkpoint
before long commands. When a line fails, inspect its last attempt and saved effects
before recovery; keep independent lines moving. Do not reset the budget by sending
a fresh duplicate assignment. Customer outreach still requires reviewed demo
videos, the exact usable account and the applicable external-action authorization.

## Revised instruction for your next authorized wave

> Reconcile current inbox, projects and Team receipts first. Reuse the existing
> Project Lead, functional leads, staff and projects. Inspect historical failures
> and saved checkpoints; leave stopped roots stopped. Prove one bounded native
> round trip on the currently loaded build, then have Project Lead dispatch only
> eligible work that is not already active.
>
> Product executes the existing M0 packet and returns its deciding fixture/browser
> evidence. GTM supplies sourced customer evidence to Designer and prepares unsent
> drafts. Simulation reconciles engine authority and proposes one admissible next
> step. Frontier investigates one bounded falsifiable hypothesis. Serialize actual
> dependencies and the one GPU runner; keep the other lines moving.
>
> Preview each exact send payload, then apply the same stable key. For managed work
> use `delivery:{kind:"work",projectId:<recipient-owned project>,maxRuns:4,
> maxDurationSeconds:7200}`, within existing stricter limits. Record acceptance,
> checkpoint versioned artifacts and effects, and close each task from its own
> criteria. Let managed continuation handle child waiting; do not create a parallel
> self-successor. Recover only an inspected attempt through its supported controller.
>
> Report a compact table of owner, project, message/run, actual admission state,
> artifact/version, consumer verdict and exact blocker. Expand only the records
> requiring a decision. Distinguish authored, saved, executed, verified, accepted
> and deployed results. Bring me material results and decisions, rather than
> repeating status or asking another broad audit to stand in for implementation.

This response establishes the implemented coordination behavior and a better
operating procedure. It does not establish completion of Wave_sim's M0, accepted
physics, deployment, board-report delivery or customer outreach.
