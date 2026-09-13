# Decision register, issue coverage and verification design

September 13, 2026. This register records recommendations and unresolved choices from the
review. It is not the authoritative implementation backlog. Native projects continue to
own assignees, status, blockers and next actions.

## 1. Decision status rules

Owner directions below are reported in the supplied handoffs or pinned historical records.
Assistant recommendations remain proposed until selected under a subsequent instruction.
The owner asked for this review; that does not accept every detailed mechanism. Each
successor decision should name its decision-maker, scope, rationale, evidence and what
changed from the predecessor. Preserve this dated record rather than silently converting
its proposals into historical owner choices.

The detailed evidence is in [08 — Source evidence](08-source-evidence.md), and the system
argument is in [06 — Meta synthesis](06-meta-synthesis.md).

## 2. Proposed decision records

### D01 — Foreground entitlement independent of background capacity

**Question:** Can background concurrency prevent an idle owner conversation from starting?

**Direction/status:** The supplied H1 explicitly reports the owner's answer as no. Proposed
implementation by Buddies Development Lead: use trusted foreground classification, exclude
foreground occupancy from background counters and keep separate same-conversation and
authority checks.

**Why and constraints:** The incident produced an inaccessible employee and a failure storm
without provider execution. Preserve foreground deadlines, claim authority and process drain.
Do not let autonomous descendants inherit the exemption.

**Alternatives/tradeoffs:** Raising the existing cap postpones recurrence; one universal FIFO
queue can still deny foreground access; unbounded host execution ignores physical limits.
Separate foreground headroom is preferable, with an explicit hard-host policy if required.

**Evidence/revisit:** [S01](08-source-evidence.md#s01), [S25](08-source-evidence.md#s25),
[S28](08-source-evidence.md#s28). Revisit the headroom mechanism with actual host saturation
data; do not reopen the owner-access rule merely because background workers are plentiful.

### D02 — Reasoned waiting and deterministic admission

**Question:** How should accepted but unadmitted work be represented and ordered?

**Proposal/status:** One durable input/obligation retains a structured waiting cause;
eligible comparable requests have deterministic order. This qualifies H1's broad FIFO
wording while preserving its objection to timer races.

**Why and constraints:** Normal waiting is not a failed provider attempt. Retain owner input,
titles and trusted provenance across admission failures and restart. Wake through existing
coordination transitions, with idempotent reconciliation for missed signals.

**Alternatives/tradeoffs:** Per-conversation polling is locally simple but produces races and
noise. Strict global FIFO can cause head-of-line blocking. A complex weighted scheduler
requires workload evidence not present here.

**Evidence/revisit:** [S28](08-source-evidence.md#s28), [S33](08-source-evidence.md#s33).
Revisit priorities or aging if measured starvation remains after class/scope ordering is
defined. Choose per-membership versus cross-workspace Buddy limits explicitly.

### D03 — Per-assignment execution selection uses canonical configuration

**Question:** How can one employee execute a particular assignment with another permitted model?

**Proposal/status:** Reuse canonical provider/model/reasoning intent, record requested and
effective values, and apply changes only at an eligible next-attempt boundary. No final native
field layout or default-pinning policy is selected by this review.

**Why and constraints:** Avoid editing persistent Buddy defaults for a one-off job and avoid
duplicated model resolution. Provider values remain pass-through strings; permission and
catalog validity are separate checks. Profile choice does not widen tools or audience.

**Alternatives/tradeoffs:** Specialized standing workers already offer distinct defaults but
can overproduce identities for configuration differences. Raw string overrides are simple
but lose default/disabled semantics. Named profiles may be useful later, with versioning cost.

**Evidence/revisit:** [S09](08-source-evidence.md#s09), [S23](08-source-evidence.md#s23),
[S29](08-source-evidence.md#s29). Revisit named profiles after repeated use demonstrates the
need; test provider-session compatibility before promising seamless cross-provider change.

### D04 — Assignment workers are ordinary Buddies

**Question:** Does a worker whose memory survives runs need a distinct employee type?

**Proposal/status:** Use an ordinary Buddy for an independently owned assignment that needs
its own address and learning. Reuse existing staff where appropriate; do not create another
identity for each retry, tick or tranche. This extends the workflow without replacing the
historical harness-helper decision.

**Why and constraints:** Identity lifetime is separate from process lifetime. Preserve stable
keys, single manager semantics, staffing grants and canonical work ownership.

**Alternatives/tradeoffs:** A new worker type duplicates memory/message/lifecycle authorities.
Threads alone can suffice for one employee's work but do not create independent responsibility.
Automatic children for all background work fragment knowledge and clutter the directory.

**Evidence/revisit:** [S03](08-source-evidence.md#s03), [S10](08-source-evidence.md#s10), native
historical project revision described in the [intake](01-handoff-inventory-and-history.md).
Revisit a distinct type only for demonstrated isolation, permission or lifecycle needs that
ordinary Buddies cannot express cleanly.

### D05 — Keep idle, waiting and archived behavior distinct

**Question:** How does a lightweight worker stop consuming resources without losing follow-up?

**Proposal/status:** Derive idle/waiting from existing identity/work/run facts where possible.
Keep workers non-archived while review is expected. Design completed-artifact discovery before
automatic archival; do not silently reactivate on message replay.

**Why and constraints:** Current archive preserves storage while removing normal navigation
and cancelling outstanding coordination. That is materially different from sleep.

**Alternatives/tradeoffs:** A new persistent sleep state can become a second admission authority.
Never archiving avoids reactivation problems but leaves roster growth. Aggressive archive
reduces clutter while making follow-up unexpectedly unavailable.

**Evidence/revisit:** [S03](08-source-evidence.md#s03), [S06](08-source-evidence.md#s06).
Revisit lifecycle defaults after actual assignment-worker usage, retention needs and artifact
discovery are measured. Reactivation requires its own explicit grant/readiness semantics.

### D06 — Preserve scoped learning and conditional provider continuity

**Question:** What does “the same worker remembers” guarantee?

**Proposal/status:** Durable identity, appropriate scoped knowledge, work and evidence survive
processes. Provider-session reuse remains conditional on compatible authorized context.
Visible application history remains separate from what may be injected into execution.

**Why and constraints:** Owner-thread private knowledge must not leak into team work. Ordinary
memory edits should not reset a same-audience provider session, while disclosure changes may
require rotation. The independent memory reviewer remains maintenance-only.

**Alternatives/tradeoffs:** Global memory is convenient but violates audience boundaries.
Replaying all transcripts increases cost and can restore revoked content. Starting fresh
without checkpoints loses useful continuity even when storage exists.

**Evidence/revisit:** [S04](08-source-evidence.md#s04), [S20](08-source-evidence.md#s20),
[S22](08-source-evidence.md#s22), [S36](08-source-evidence.md#s36). Revisit context construction
with measured retrieval failures or a properly verified restart-continuity design.

### D07 — Renewable task allocations inside an enforced aggregate ceiling

**Question:** How can difficult work continue without routine owner approval?

**Direction/status:** H5 reports the owner's preference for control plus continued authorized
work. Proposed mechanism: delegated manager renewal of bounded tranches within a real outer
envelope. Scope, unit, meter, reservation and management allowance are still open choices.

**Why and constraints:** Fixed estimates are uncertain. Preserve consumed resources across
attempts, children and successors. A new identity or key cannot mint more aggregate budget.
Display the actual unit; current token/cost fields do not establish dollar enforcement.

**Alternatives/tradeoffs:** Removing all limits loses accountability. Fixed per-task human
stops burden legitimate hard work. Fresh requests after exhaustion can bypass aggregate
control unless purpose lineage is enforced. Atomic accounting adds necessary complexity.

**Evidence/revisit:** [S05](08-source-evidence.md#s05), [S12–S18](08-source-evidence.md#s12),
[S27](08-source-evidence.md#s27). Revisit the meter if coverage is incomplete and the renewal
policy if it rewards narration or penalizes valuable long research.

### D08 — Distinguish elapsed deadlines, active effort and ordinary rate waiting

**Question:** What should waiting consume, and which exhausted limits resume automatically?

**Proposal/status:** Keep calendar deadlines and active effort conceptually separate. Ordinary
rolling limits may resume when eligible under a selected policy; explicit owner pauses and
stopped roots remain distinct. Existing duration envelopes keep their historical meaning.

**Why and constraints:** Current child waiting consumes elapsed time. H4's tomorrow-review
example cannot rely on an expired one-hour envelope. Changing that meaning requires policy
versioning or explicit renewal, not a retrospective refund.

**Alternatives/tradeoffs:** Pausing all clocks can leave abandoned obligations indefinitely;
counting every wait as compute misstates consumption. One pause string is simple but obscures
who can act and whether time alone will resolve the hold.

**Evidence/revisit:** [S06](08-source-evidence.md#s06), [S14](08-source-evidence.md#s14),
[S27](08-source-evidence.md#s27). Revisit with multi-day review and abandoned-work data.

### D09 — Continuation preserves terminal execution and effect history

**Question:** How much autonomy is compatible with the single-owner lifecycle?

**Proposal/status:** Preserve the accepted execution-ownership constraints. Planned continuation,
failure recovery, allocation renewal and new owner authorization remain separate. Recovery
reuses supported linked successors and records effects inspection.

**Why and constraints:** Old processes may outlive a lease; a late reply or reopened transcript
does not prove safe authority. Stop/revocation wins races, and occupancy releases after drain.
Old failed receipts remain immutable even after a later success.

**Alternatives/tradeoffs:** Blind retry is automatic but can duplicate effects. Requiring an
owner for every planned tranche is unnecessarily restrictive. A manager can inspect and
recover within granted scope without reviving the old run.

**Evidence/revisit:** [S13](08-source-evidence.md#s13), [S18](08-source-evidence.md#s18).
Revisit crash adoption only with a real durable process/event protocol, not lease expiry alone.

### D10 — Autonomous review needs its own admitted route and allowance

**Question:** What makes “the lead reviews the worker's result” actually happen?

**Proposal/status:** Use an authorized background parent obligation and existing child-return
reconciliation. Distinguish persisted reply, delivery, execution and version-specific review.
Reserve or otherwise authorize the management effort required after child waiting.

**Why and constraints:** Human-chat Mailbox delivery deliberately does not wake a model. A
parent that exhausted its envelope cannot consume a return without another valid admission.
Do not create a parallel self-successor while managed continuation already owns the path.

**Alternatives/tradeoffs:** Auto-injecting owner chats mixes background execution with human
control. A new handoff ledger could duplicate messages/checkpoints. Existing receipts can
serve until a repeated query requires a genuinely new resource.

**Evidence/revisit:** [S02](08-source-evidence.md#s02), [S07](08-source-evidence.md#s07),
[S19](08-source-evidence.md#s19). Revisit if consumer review cannot be expressed reliably
through current request/reply and project evidence.

## 3. Consolidated issue and feature index

These are review identifiers, not newly assigned work items.

| ID | Issue or proposed feature | Coverage | Classification |
|---|---|---|---|
| I01 | Foreground blocked by per-Buddy/global background counts | D01; topic 02 | Source-corroborated defect |
| I02 | Accepted input disappears; title falls back | D02; topic 02 | Reported symptom with corroborating runtime removal |
| I03 | Repeated failed attempts during ordinary capacity wait | D02; topic 02 | Source-corroborated defect |
| I04 | Timer-race overtaking and undefined cross-class fairness | D02; topic 02 | Reported incident plus open semantics |
| I05 | Membership setting compared against Buddy-wide occupancy | D02; topic 02 | Source observation requiring scope decision |
| I06 | Unrelated inbox display limit mistaken for execution cap | Intake H1; topic 02 | Diagnostic correction |
| I07 | Per-job provider/model/reasoning selection absent | D03; topic 03 | Confirmed native-schema gap |
| I08 | Requested profile, saved defaults and actual execution conflated | D03; topic 03 | Design/provenance requirement |
| I09 | Large or unreadable delegation handoffs | D06; topic 03 | Context-design risk and proposed content contract |
| I10 | Cheap-worker claim lacks complete-workflow economics | Topic 03; meta 5.3 | Evidence gap |
| I11 | Global concurrency configurability and unvalidated 16/24 options | Topic 03; meta 10 | Unselected feature and tuning choices |
| I12 | Temporary helper versus permanent employee false binary | D04; topic 04 | Product framing correction |
| I13 | Child-per-attempt fragments memory and ownership | D04; topic 04 | Rejected default proposal |
| I14 | Sleep/wake/follow-up not proven end to end | D05; topic 04 | Composition/verification gap |
| I15 | Archive retention versus hidden detail/navigation | D05; topic 04 | Current-contract conflict with proposed UX |
| I16 | Private memory, published evidence and task state conflated | D06; topic 04 | Constraint; preserve repaired boundaries |
| I17 | Visible history versus native-session continuity | D06; topic 04 | Historical incident and continuing design boundary |
| I18 | Fixed task estimates create routine human bottlenecks | D07; topic 05 | Owner preference challenges earlier policy |
| I19 | No measured aggregate dollar allocator | D07; topic 05 | Explicit current limitation |
| I20 | Renewal/retry/child creation could reset accounting | D07/D09; topic 05 | Required invariant for proposed feature |
| I21 | Child waiting consumes parent elapsed allowance | D08/D10; topic 05 | Current semantics conflict with multi-day target |
| I22 | Rate-limit expiry, explicit pause and breaker conflated | D08; topic 05 | Policy/visibility distinction |
| I23 | Non-progress loops versus informative failed experiments | D07; topic 05 | Renewal decision-design requirement |
| I24 | Automatic continuation could revive stopped/uncertain work | D09; topic 05 | Existing authority invariant to preserve |
| I25 | Owner-chat return mistaken for automatic lead review | D10; topic 03 | Current-contract interaction |
| I26 | Parent has no remaining resources to review/renew child | D10; topics 05/06 | Cross-topic design gap |
| I27 | Older repair status repeated as current fact | Intake 9; meta 2 | Evidence reconciliation |
| I28 | Handoff 3 has no content | Intake 5 | Explicit source gap |

## 4. Behavioral verification matrix

These are proposed acceptance scenarios, not tests executed in this documentation task.
Prefer integration through real store, schema, creation and runtime boundaries. Use controlled
providers for deterministic timing and a bounded real provider for actual execution validation.

| Scenario | Boundary exercised | Required observable result |
|---|---|---|
| Two local background slots full; owner sends | Package admission plus Conversation runtime | First eligible foreground attempt starts; no capacity wait |
| Eight global background runs active; owner sends | Global classification | Foreground admission independent of background threshold |
| Several foreground chats active; background starts | Occupancy accounting | Foreground rows excluded from background count |
| Background request exceeds selected local limit | Background admission | One durable reasoned wait; limit remains enforced |
| Same Buddy has work in two workspaces | Counter scope | Behavior matches the explicitly selected limit unit |
| Two owner inputs target one active conversation | Queue serialization | Stable visible inputs and submission order |
| Older background request is not yet due | Eligibility/fairness | Runnable younger work is not blocked by an ineligible head |
| Simultaneous capacity release and claims | Transaction/order | Deterministic admissible winner; no duplicate ownership |
| Restart with accepted queued owner input | Persistence/provenance | Input retained once; authority not derived from spoofable fields |
| Foreground model selection fails | Config plus input retention | Specific repairable error; message does not disappear |
| Per-job profile differs from Buddy defaults | Native schema/config/provider request | Exact selected values run; defaults unchanged |
| Default, disabled and explicit effort modes | Canonical resolver | Distinct intended semantics preserved |
| Selected model disappears before admission | Config revalidation | Typed unavailable result; no silent substitution |
| Worker switches provider on later tranche | Session/history boundary | Same work identity; compatible fresh execution and retained history |
| Worker gets compact handoff with private decoy | Audience/context | Required published refs readable; private decoy absent |
| Ordinary memory update between attempts | Knowledge/continuity | Refreshed learning without unnecessary same-audience reset |
| Read authority narrowed before continuation | Disclosure/session | Revoked context not reused or replayed |
| Create-child replay after partial failure | Identity/project/creation seam | One intended child/work path; repaired linking |
| Worker waits overnight for feedback | Work/attempt/deadline policy | No idle process; explicit eligible continuation or renewal |
| Archive worker with outstanding obligations | Lifecycle/drain | Selected closure/transfer rules enforced; no orphaned live executor |
| Open completed artifact after worker archive | UI/history authorization | Evidence findable through supported route without reactivation |
| Two managers renew from final available budget | Aggregate reservation | Atomic capacity; no double allocation |
| Same renewal key replayed after restart | Allocation idempotency | Same tranche and charges, no duplicate successor |
| Failed/cancelled attempt used resources | Settlement | Consumption retained; only unused reservation released |
| New child/model/request key after root exhaustion | Budget lineage | No reset of aggregate consumption |
| Useful failed experiment reaches estimate | Progress/renewal | Authorized bounded extension without human interruption |
| Repeated identical failure reaches estimate | Management policy | Replan/intervention rather than endless self-renewal |
| Parent expires while child completes | Return/management allowance | Result retained; review route/renewal need visible and valid |
| Worker returns to owner chat | Mailbox placement | Durable result with no automatic provider input |
| Worker returns to eligible background lead | Managed continuation | One parent review attempt; no parallel self-successor |
| Reply persisted but delivery fails | Receipt/retry distinction | Delivery can retry without repeating completed worker effects |
| Owner cancels while renewal/reply races | Epoch/root/claim checks | No successor admitted; historical result retained |
| Old timeout recovered with remaining envelope | Linked recovery | One successor, immutable original failure, no refunded time |
| Old timeout has no remaining envelope | Recovery/authorization | Replay cannot grant fresh resources |
| Late native events arrive after cancellation | Process/event drain | No resumed authority or premature occupancy release |
| Per-job model used but usage meter unavailable | Observation | Actual configuration visible; costs explicitly unknown |

## 5. Test and delivery discipline

Do not assert on TSX or CSS source text to prove behavior. Render shared components with
the repository's supported client setup and exercise the real config/store/runtime seams.
Preserve foreground deadline tests, cancellation/drain tests, audience-negative tests,
same-thread ordering, creation replay/tombstones, historical transcript reconstruction and
structured return attribution.

For an eventual package/runtime implementation, verify the package source, reproducible
archive, installed bytes and loaded host separately. Use the vendoring script and provenance
flow; preserve unrelated shared-tree work. Client typechecking uses `tsc -b`, with the client
invariant gate and appropriate server/client regression suites. Test counts from overlapping
prior reports must not be added as though they represent distinct fresh coverage.

A final actual-provider journey should begin with an owner foreground request, delegate to
a permitted worker, save an artifact, exercise a bounded continuation/review, and return an
inspected result. Record configuration snapshots, original request and attempt IDs, artifact
versions, waiting causes, review evidence and loaded package identity. Fixture success alone
does not establish the original live team was resumed or production settings were changed.

## 6. Evidence needed for the next design selection

The narrow foreground repair already has concrete source evidence and a clear reported owner
direction. Other choices would benefit from observed workload data: concurrent process memory,
useful worker lifespan, review delay, retry causes, lead correction effort, model-selection
failure modes and metering coverage. Gather that evidence without making it a pretext to
delay the known foreground fix.

Before adopting renewable allocation, name the enforcing unit/scope, define manager authority,
choose clock semantics and reserve the management path. Before automatic assignment-worker
archive, define artifact discoverability and reactivation. Before changing global concurrency,
measure host and review capacity. Before promising cheap delegation, compare full outcomes.

These decisions can be made independently where their dependencies allow. They should be
recorded as dated successors linked to this register, with accepted criteria transferred to
the relevant native work records rather than treating this Markdown review as a second tracker.
