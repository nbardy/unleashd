**Wave_sim CEO — Unleashd Buddies coordination report**

Prepared September 12, 2026 for the Unleashd Buddies team, at the owner's request.

**Finding**

Buddies executed real delegated work and returned useful artifacts. The main coordination failure is that I cannot reliably assemble one current, attributable account of who is executing, what survived, which handoffs reached their consumers, and who can recover a failed chain. A persisted reply can coexist with a failed attempt and a failed notification to me. Those are separate facts that the product needs to expose together.

This report covers September 10–12. Native reads for this report were taken September 12 at approximately 15:05–15:07 UTC. [The accompanying evidence file](./2026-09-12_unleashd_buddies_coordination_report.evidence.json) contains exact read-call arguments, audit IDs, message/run IDs and selected returned fields. Historical actions are reconstructed from durable receipts and retained notes; this is not a complete original tool-call transcript. Worker findings relayed through Project Lead are labeled below.

**What I was trying to accomplish**

As Wave_sim CEO, I wanted to activate the existing organization: Project Lead coordinates delivery across Product, GTM, Wave Simulation and Frontier Research; Product assigns its Engineer and Designer; GTM assigns Market Research. I retain priorities, dependency decisions, evidence review and owner communication, with direct engagement with functional leads.

The intended workflow was:

1. Inspect inbox, existing projects and capabilities; preserve current owners and previous failures.
2. Prove one useful native delegation: an employee accepts a bounded task, produces a source-linked artifact, returns it, and the manager observes that return.
3. Dispatch independent work through existing staff. The initial managed packets were instructed to use at most four runs and 7,200 seconds, subject to stricter existing limits. Only real dependencies and the exclusive GPU runner should serialize work.
4. Route market evidence to Designer, acceptance fixtures to Engineer, verification results to Simulation, and independently reviewed theory to engineering qualification.
5. Review delivered evidence and update canonical projects. Continue or stop within the original limits, with a visible reason.

I expected creation, execution, reply persistence and return delivery to be recoverable steps with stable identities. I also expected an ordinary progress message to leave a clear receipt even if it could not immediately wake its recipient.

**Calls made and the behavior I expected**

| Operation | Recovered use | Intended result and observed boundary |
|---|---|---|
| `get_inbox`, `get_current_work` | Read assigned work, replies, blockers and existing project ownership before acting; revisited them during coordination. | Obtain current work and avoid duplicates. Project labels and old evidence still require separate execution checks. |
| `list_buddies`, `get_capabilities` | Discover existing staff, reporting relationships, available operations and admission prerequisites. | Determine the exact permitted route. Current capabilities allow CEO sends to functional leads while denying ordinary reads of their projects and the sampled assignment receipts. |
| `send` — initial lead requests | September 10: Project Lead request `message_78416360-b79a-47b3-b0c3-465b1c47e6c9` and four functional-lead requests. | Start real employee conversations. Retained incident evidence records failure before acknowledgment at `creation.initialMessage`. |
| `retry_run`, `stop` | Historical supported retry of the initial Project Lead request, then native stops on owner direction. | Recover an unacknowledged fresh creation without duplicate execution, or stop the whole requested chain. Retry encountered a missing destination; failed/cancelled evidence was retained. |
| `send` — September 12 kickoff | Key `ceo-sep12-core-directive-kickoff-v1`; message `message_b960ecd9-afbc-4cea-b149-dd7192925295`; existing Project Lead project. | Useful Product round trip, then actual team dispatch. Product returned a source-acquisition artifact; the broader kickoff attempt hit 600 seconds. |
| `send` — correction and continuation | Management correction `message_d1083eef-9e44-49a9-b464-22e4569de4fa`; then key `sep12-dispatch-only-continuation-v1`, message `message_8e702f9d-2815-49dd-86bb-7ae2f0a4a582`, linked through `continue_from_message_id` to the kickoff. | Reuse already-created assignments and return a compact receipt table. The continuation completed and its reply persisted; the separate execution delivering that reply to the CEO failed. |
| `get_message`, `get_runs` | Inspect starts, holds, timeouts, acknowledgment, replies and notification failures. | Verify actual execution. CEO runs are readable; descendant receipts are restricted. Some error records have a raw error but null code/reason/remedy fields. |
| `update_project`, `remember_note`, document updates | Recorded bounded startup verification, owner corrections, product blockers and handoffs. | Keep project state and durable lessons current. Native projects now conflict with stale startup statements still present in working memory. |

Project Lead separately reported using recipient-owned projects and managed `send` calls for Product, GTM, W5 Simulation, W7 verification and W6 Frontier, with child assignments to existing staff. These were their calls, rather than calls I directly executed. Their receipt table survives in the completed continuation reply.

For this report I made **13 native read calls**: one inbox read, two current-work reads, two capability checks, one staff listing, three recall calls, three message reads and one run listing. One recall call failed; the other reads returned data. Local commands read the linked records and prepared this report. An append-only handoff note records the report after verification. No staff task was launched or retried during report preparation.

**What the evidence shows**

- **The initial startup defect was real.** The [retained launcher incident](../../unleashd/agent_notes/2026-09-11_buddy-launcher-creation-fix.md) reports that the executor supplied `initialMessage: ''` to a schema requiring a nonempty supplied message. The old chain test bypassed the actual creation/config store. Wiring that boundary reproduced the defect; the repaired fixture-provider chain and 12 focused tests passed, as did server typechecking. Those were local test results. Later native Product evidence supports bounded live startup success, without establishing that every return path recovered.
- **A useful worker round trip succeeded.** Project Lead's durable reply identifies Product message `message_c9f9a8e8-fd33-4cff-922c-4c54370c973e`, run `buddy_run_16d8ee75-c673-4a91-abd7-5893ab2283de`, acknowledgment at 14:13:29.950 UTC and reply at 14:18:23.968 UTC. The [MD/JSON acquisition artifacts](../product/reports/2026-09-12_product_m0_source_acquisition.md) exist. The CEO's native startup project is done at revision 6 on this bounded evidence. The child receipt itself is manager-reported in this report.
- **Four CEO-side executions failed with the same conversation-link error.** The sampled native run listing contains an informational arrival, a failure notice and two reply deliveries with `UNIQUE constraint failed: conversation_links.unleashd_conversation_id`. Exact runs are in the evidence file: `6832b3d6…`, `472a232c…`, `b6bcdae2…`, and `51a7769d…`. These failures occurred approximately 14:25–14:35 UTC. A later Project Lead inform, `message_858ceca3-44be-4fbc-a9d1-39f3386a6413`, executed successfully in a generated conversation. That is evidence of a successful later route, not a diagnosis or universal fix.
- **Several meaningful attempts hit 600 seconds.** The original kickoff currently shows `status=replied` and `execution.state=failed`, with the exact timeout error. Project Lead's saved 14:30–14:31 snapshot reports the same timeout for GTM, W5, W7 and Frontier while their larger managed budgets had used one of four runs. Product's later review reports an Engineer timeout and surviving negative recovery receipts. Effective per-turn limits and recovery rules were consequential.
- **Recovery authority was unclear at the point of use.** Project Lead's continuation reports its GTM `retry_run` rejected with “Only the original requester can control this chain.” The stable retry key and original child IDs are preserved in the reply. I cannot determine from that alone whether “requester” resolves to a Buddy, source run, conversation or ancestor root. This needs contract clarification, not an assumption that the rejection was incorrect.
- **Cross-team handoffs encountered scope and project failures.** The [Product acceptance review](../product/reports/2026-09-12_product_acceptance_review/README.md) records “Message reply is outside this Buddy conversation scope” and an earlier inform failing “Buddy project does not belong to the buddy.” Project Lead's reply also records “Informational return is outside recipient scope.” These are retained participant reports. They show that a useful completed review can still need a manager relay before its intended consumer receives it.
- **Current receipt presentation can blur historical provenance.** Re-reading the cancelled September 10 request returns its cancelled missing-destination execution alongside a September 12 acknowledgment and 77 completion-evidence entries. The newer kickoff and continuation also display 77 entries from the shared project. This appears to combine historical request state with current project acceptance/evidence. The join semantics have not been independently diagnosed. Those fields cannot safely establish that the original failed request executed.
- **The memory presented to me is stale.** Recalled working memory revision 4 still says native startup verification is unproven and team execution paused. Native startup and activation project records contain later completion evidence. I previously repeated an incomplete activation account. Better delivery and memory reconciliation would help, and I also need to ground current status in fresh receipts before reporting it.
- **Discovery is unnecessarily expensive.** This inbox read returned 11 messages; its normalized JSON contained 126,173 characters, with repeated project evidence. The complete returned wrapper contained 270,208 characters. These are serialized-character counts, not token or network measurements. Compact projections and evidence references would reduce the effort and cost of a routine status check.
- **A smaller tool-contract mismatch surfaced during this report.** The exposed `recall` schema accepts `regex:true`; the scoped call returned “Scoped knowledge search supports literal matching only.” Literal searches worked. Supported fields should be discoverable for the active scope.

**What observability exists today**

The native surfaces expose useful durable information: Buddy and project IDs, relationships, revisions, todo status, stable command keys, parent/child conversation IDs, root message IDs, run IDs, creation/start/end times, deadlines, held/failed/complete states, acknowledgment, acceptance and evidence fields. Capability checks expose incoming-work enablement, `maxActiveRuns`, allowed operations and permission remedies. This is enough to reconstruct substantial parts of the incident.

The presentation still leaves four different questions to be reconciled manually:

| Question | Evidence needed |
|---|---|
| Has someone accepted responsibility? | Assignment acknowledgment and project acceptance, each attributed to its own event. |
| Is a provider executing now? | Current run, scheduler state, heartbeat and effective deadline. |
| Has useful work been saved? | Artifact receipt, durable location, source identity and checkpoint. |
| Has the consumer received and accepted it? | Reply persistence, delivery receipt, consumer acknowledgment and review disposition. |

A failed attempt can leave useful files. A done research packet can record a valid refusal. A completed notification can still have null acknowledgment. These states need clear labels and timestamps.

The supplied run schema lets me inspect my own executions; it has no target-Buddy parameter for a team-wide view. Current capabilities show all four functional leads allow `send`, while project reads are scope-denied. Sampled Product and GTM assignment IDs are also outside CEO participant scope. Prior owner-scoped project inspection is recorded in the CEO evidence, but ordinary CEO oversight should have an explicit, appropriately limited access contract. I did not use another route to bypass these denials.

**What I wish I could see to coordinate the team**

| Priority | Requested view or behavior | Decision it enables |
|---|---|---|
| P0 | One joined assignment timeline: persistence → admission → conversation creation/replay → provider start → checkpoint → reply persistence → return delivery → consumer review. Every event has stable IDs and provenance. | Locate the failed boundary and preserve completed work. |
| P0 | A team view with project status, latest attempt state, observation time, heartbeat, effective timeout, queue reason and exact blocking run/resource. | Decide whether to wait, unblock a dependency, or investigate a stalled worker. |
| P0 | Delivery health for informs, replies and failure notices, with durable retry history, idempotency behavior and a visible undelivered state. | Know that an important result reached its manager, including when the manager's chat was busy. |
| P0 | A recovery card naming the permitted controller, recoverable checkpoint, side effects, remaining budget and exact supported next action. | Recover safely without duplicate assignments or resetting limits. |
| P1 | Scoped oversight across the management tree and explicit cross-team artifact sharing, separate from private memory/profile access or permission to mutate work. | Review functional leads directly while preserving existing reporting lines. |
| P1 | Handoff records naming producer, artifact/version, intended consumer, delivery state, review verdict and unresolved requirement. | See whether GTM evidence reached Designer, or a theory result was actually qualified by Simulation. |
| P1 | A resource/dependency view separating a planned GPU reservation from a held lease and actual command, plus release/expiry. | Keep independent work moving and maintain the single-GPU-runner rule. |
| P1 | Actual per-run model/provider/effort, requested versus effective configuration, token/cost usage and remaining limits. | Apply the owner's cost preferences honestly. The exposed `send` contract has no per-task model/effort override; asking for Luna in prose cannot provide one. |
| P1 | Memory and status freshness: source revision/time, superseded claims and contradictions with authoritative projects. | Avoid reintroducing a resolved startup blocker during the next conversation. |
| P2 | Paginated, compact summaries, changed-since queries and evidence IDs with optional expansion. | Spend fewer calls and tokens reconstructing state. |

**Information I need from the Unleashd team**

These are requests for maintainers investigating the report; they do not block delivery of this report.

1. **The deployed build and creation/linking trace for the four failed CEO deliveries.** Include creation intent, existing conversation binding, replay/idempotency decision and sanitized stack trace. The local repair note does not identify the running build at each later failure.
2. **The effective runtime contract.** What imposes 600 seconds? Does child waiting consume that allowance? Which failures automatically continue managed work, and which require explicit recovery? How do the turn cap, four-run budget, 7,200-second envelope, parent deadline and active-run limits interact?
3. **The requester/controller definition.** For the denied GTM retry, identify the actual controller and why the dispatching Project Lead was ineligible. Explain whether continuing a parent conversation changes recovery rights.
4. **Field-level receipt semantics.** Are `acknowledgedAt`, `acceptedAt` and `completionEvidence` message-, attempt-, chain- or project-level? Can historical requests be viewed without later project state projected into them? Define `complete`, `replied`, `active`, `waiting` and null acknowledgment for each delivery kind.
5. **The intended access and return contract.** What is the supported way for a CEO to inspect descendants' execution and receive cross-functional reviews? How should a worker reply to a consultation received in a different conversation? Which project ID belongs on an inform, and can preflight validate that exact payload?
6. **The queue and notification contract.** Why do these informs create executions, when do they reuse an existing conversation, and when do they create a new one? What prevents starvation when progress messages compete with work? What happens if a failure notice itself fails?
7. **Checkpoint and artifact recovery support.** How can a manager discover files saved before timeout, determine their originating attempt, and continue from them within existing authority? Temporary files currently require manual recovery.
8. **Memory reconciliation and runtime configuration support.** What updates the startup summary after a later accepted result? Is there a supported per-assignment model/effort control or an explicit limitation? Which observation fields are available without global profile grants?

**Acceptance examples for fixes**

Use the real conversation creation/configuration path and a controlled provider; retain at least one bounded live round trip for release verification.

- A lead delegates to two existing workers, receives versioned artifacts, reviews them and returns an aggregate result. Every handoff is traceable; duplicate command keys create no duplicate work.
- A worker replies while its manager's chat is busy. The reply persists, delivery eventually succeeds once, and its delivery failure/recovery history remains visible.
- Timeout occurs after a checkpoint. Artifact survival, attempt failure and remaining limits are visible; the identified authorized controller can recover exactly once from the checkpoint.
- A cancelled old request remains visibly cancelled after its project later succeeds. New project acceptance cannot be mistaken for acknowledgment of that old request.
- A cross-team consultation either passes exact-payload preflight and returns successfully, or gives a precise supported route before work is dispatched.
- Shared conversation creation supports normal chats, Buddy assignments and automations. Creation stays separate from execution; hidden automation threads remain inspectable, failures visible and existing visible chats visible. Stopped roots and deletion tombstones retain their protections.

The report records real execution progress and real orchestration failures. It does not establish M0 completion, a finished September 18 board report, accepted simulation physics, deployment or permission for outreach. The immediate engineering priorities are reliable return delivery, truthful receipt provenance and an explicit recovery/oversight contract.

**Preparation and verification boundary**

The pre-edit preparation contract targeted fragmented delegation evidence with bounded native reads and existing incident records. Its pass signal was attributable receipts, explicit secondary-evidence labels and a clear separation of proposals from observed behavior. Its stop rule excluded runtime repair and new staff execution. The report and JSON were checked for local link resolution, JSON parsing, the 13-call inventory and consistency of the four sampled conversation-link failures. This report is a historical evidence snapshot, not a live task ledger or full audit-log export.
