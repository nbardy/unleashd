# Object inventory and responsibility reductions

September 13, 2026 · Assistant analysis of the [owner direction](../LATEST_HUMAN_DESIGN.md).
Evidence: [source excerpts](05-source-evidence.md), [native observations](native-observations.json).
This is the universe relevant to the Buddy employee workflow, including existing,
historical and proposed concepts. It is not a count of every application table.
Updated for the [Worker and Mail/Prompt successor](07-workers-mail-and-prompt-successor.md).
Worker ownership/name are owner direction; the messaging split and exact mechanics
retain the proposal status described there.

## Count responsibilities before counting names

The proposed model has five core content/identity types: **Buddy, Task, Mail
(correspondence Message), Document, Conversation**. **Prompt** is a distinct
execution operation with a durable pending input and attempt receipt. **Worker**
is a role/lifecycle of Buddy, not a sixth identity type. The repository Workspace
remains the enclosing boundary. This count must not hide the execution contract.

That is a product model, not a claim that five database tables suffice. Reliable
execution also needs attempts, pending inputs, claims, receipts and resource
accounting. Deleting their names while hiding all their states in Buddy metadata
would increase complexity. Each independent fact should have one authority.

The five domain objects answer different questions:

| Object | Sole primary responsibility | Does not own |
|---|---|---|
| Buddy | Who is accountable and addressable? | Whether a particular task is done, or a process is alive |
| Task | What outcome is owed, by whom, with what evidence? | Identity, provider-session history or execution liveness |
| Mail / correspondence Message | What communication was delivered to whom? | Model execution, task completion or permission to exceed scope |
| Document | What knowledge/artifact content exists at a named revision? | Live task status or tool authority |
| Conversation | What dialogue did a human initiate with this Buddy? | Autonomous scheduling or background ownership |

**Document means saved content**, such as “Buddy design, revision 4,” a shared
brief, bounded memory page or append-only decision note. Common revision and
reference infrastructure does not imply one editing policy: append-only notes,
private memory and published briefs retain their distinct permissions and modes.
A binary artifact or code commit can stay a versioned external reference. This
is not a new document service, a required editor or a mandatory navigation tab.
Documents describe knowledge and artifacts; authoritative Task records describe
current work status.

**Mail and Prompt answer different questions.** Mail asks for correspondence to
be delivered. Prompt asks for a model turn in a particular authorized context.
The proposed Prompt operation reuses execution inputs and receipts; an optional
wait/stream changes how the caller observes it, not whether execution was requested.
Mail may cause a separate policy-authorized review Prompt, but delivery alone
does not prove a model ran. Neither operation needs a second execution engine.

## Full mapping

| Current/proposed concept | Smallest home | Eliminate or unify | Boundary that must survive |
|---|---|---|---|
| Chief, main Buddy, lead, employee | Buddy | Role labels, one identity implementation | Responsibilities do not confer grants |
| Worker (owner's name for sub-buddy) | Ordinary Buddy + one parent edge + related task ownership + visibility/lifecycle policy | No second identity class, memory service or worker executor | Several tasks per Worker; survives provider exits; hidden from standalone roster, inspectable under parent |
| Standing direct report | Ordinary Buddy + manager edge | Same infrastructure; distinct staffing intent | Existing reports are not silently made temporary Workers |
| Background task/process shown to owner | Assigned Task + Buddy + execution summary | Remove anonymous long-work product objects | Actual attempt IDs remain inspectable |
| Team | Workspace membership and manager/collaboration edges | Derived roster; no autonomous Team entity | Acyclic manager relation; one direction stored |
| Manager / reports-to | One edge, inverse query | No paired inverse rows | Reassignment is revisioned and affects routing |
| Consults / peer collaboration | Existing collaboration edge and scoped task reads | No shadow second manager | Peer visibility does not expose private messages |
| Project, task, todo, goal, work item | One recursive Task family in the target model | Same ownership/criteria/evidence contract | Each executable child has one owner; no parent cycle |
| Project container / sprint / board | Task grouping or saved view | No second completion state machine | A required child differs from an optional grouping |
| Assignment / delegation / handoff | Task ownership change + Prompt input; optional Mail notice | Delete independent completion ledger | Explicit execution intent; atomic binding or repairable keyed composition |
| Related batch of work | Several Tasks assigned to one parent-owned Worker, optionally grouped under an existing Task | No mandatory Batch entity or task-to-worker lifetime binding | Per-task evidence and resource lineage remain explicit; no automatic scope expansion |
| Prompt / execute in context | Authorized pending input + attempt receipt | Reuse Buddy admission, context, provider and execution infrastructure | Serialize busy context, record queue/failure, keep automatic input out of human chats |
| Review request | Mail referencing task and candidate revision; linked Prompt when automatic review is requested | No dedicated Review identity/lifecycle | Verdict names exact artifact/criteria version; delivery does not prove review ran |
| Review verdict | Task revision evidence + response Message | One acceptance fact, communication links to it | Delivered does not mean accepted |
| Approval request | Typed request Message + host-verified decision receipt | Same communication transport | A purpose string never supplies owner authority |
| Inbox, mailbox, sent, notifications | Authorized Message queries + handled cursors | Views, not competing message stores | Seen, delivered and handled have distinct meanings |
| Progress report / final report | `report` composition over Task, checkpoint, Mail and linked lead-review Prompt | No new Report object/table | State and notification intent commit durably together; review execution remains observable |
| Checkpoint / resume packet | Attempt evidence referencing saved Document/artifact versions | Reuse current checkpoint record | Save first; reference is an attestation, not verification |
| Soul / role / style | Document kind on Buddy | Common revision/read/edit infrastructure | Owner-directed identity editing remains distinct |
| Working / long-term memory | Scoped Document kinds | Common storage, separate bounded heads | Knowledge differs from current task state |
| Decision note / lesson / investigation journal | Append-only Document mode | One evidence-writing path | Preserve author, date, rationale, source revision |
| Shared brief / plan / spec | Published Document | Reuse content storage and references | Explicit audience and exact published revision |
| Skill / playbook | Referenced instruction Document | Reusable content, no executor | Skill text cannot grant runtime rights |
| Artifact / test log / code commit / attachment | Versioned evidence reference, optional Document | One reference shape | External bytes, availability and permissions checked |
| Human conversation | Conversation | Preserve as its own object | Only trusted human input may start foreground turns |
| Background conversation | Internal execution transcript/session binding | Remove from human Conversation product semantics | Preserve historical URLs and transcripts during migration |
| Desk / message-response thread / lead wake | Bounded coordination attempt over pending messages | Desk is a UI name, no Desk entity | Never a second task owner or a hidden endless loop |
| Worker loop / continuation / retry | Existing execution controller over Task eligibility | One autonomous executor path | Clean continuation differs from uncertain-effects retry |
| Run / turn / attempt | Durable execution receipt and current claim | One execution authority; semantic modes remain | Immutable terminal history; stop fences before drain |
| Provider process / harness session | Attempt-owned runtime handle | One provider seam | Process exit and event drain are separate |
| Ephemeral sub-agent | Harness capability within parent attempt | No Buddy, inbox, memory store or roster entry | Parent lifetime, attribution, budget and cancellation |
| Queue item / wake / attention | Durable pending input referencing its cause | Reuse the run/input queue | Dedupe, acknowledgment, due time and lost-wake recovery |
| Watch / subscription | Task owner/lead routing, fixed event rules | Avoid general subscription objects initially | Retain unresolved notifications across restart |
| Schedule / automation / cron tick | Schedule definition that emits a bounded task/coordination Prompt or Mail-only notification | Remove separate prompt/sequence/loop execution engines in target | Exactly one durable occurrence per due key; execution intent is explicit |
| Memory reviewer / cleanup process | Restricted maintenance attempt | No employee identity for system housekeeping | Separate capability and allowance; no recursive reviews |
| Requested execution profile | Task execution selection value | Reuse canonical provider selection intent | Separate from Buddy defaults |
| Effective execution profile | Immutable attempt snapshot | Same configuration resolver | Record what actually ran, including unknown legacy data |
| Named model profile / role preset | Optional saved configuration preset | Defer a versioned Profile entity | Raw model strings remain provider-native |
| Reporting effort, total allowance, reservations, deadlines, concurrency and rate controls | One versioned [limits policy](../BUDGETS_AND_LIMITS.md) and its accounting/admission projection | Remove repeated defaults, calculators and editable balances | Distinct units and scopes survive; no new domain workflow object |
| Membership / grant / run policy | Explicit access policy records | One shared policy evaluator, different facts | Work supervision does not imply private-document access |
| Scope / audience | Explicit reference and policy boundary | Reuse owner-thread/project/workspace scope | Context reuse never widens disclosure |
| Workspace / repository / working directory | Existing Workspace plus execution directory | Do not invent a new Space to rename a folder | Worktree isolation does not create a new organization |
| Shared room / Space / Post | Optional future multiparty product | Defer; task messages/docs cover present brief | Reconsider for demonstrated shared discussion need |
| Event ledger / audit / activity | Machine audit and derived activity | Keep audit, defer event-sourced domain replacement | Audit facts differ from authored explanations |
| Change set / Builder setup / staffing plan | Bounded composition command + receipt | One setup service, no persistent Plan object | Preview effects; execution starts separately |
| External mailbox / connector account | Adapter configuration + effect receipt | Share internal delivery abstractions where valid | External send authority, idempotency and unknown outcome |
| GPU reservation / host lease / sandbox | Optional runtime integration | No Buddy noun for each resource kind | Actual leases and OS isolation cannot be invented in prompts |
| Archive / idle / waiting / pause / cancellation | Derived view or explicit owner transition on existing objects | Avoid a new Sleep object | Pause is reversible; stopped attempts remain terminal |

## The reductions worth doing

**Collapse the three work vocabularies first.** Expose one Task API. A project is
a task with required children; a trivial checklist row can remain inline until
it needs separate ownership, evidence or discussion. If inline todos are retained,
be honest that they are values with fewer capabilities, not a second task service.
Keep old IDs and criteria during migration; never run both old and new writers.

**Make report a composition, not another record system.** It should persist
progress and evidence through the task/attempt authorities, then create one
durable Mail and linked review Prompt for the lead. A report history is a query of those records.
Do not independently maintain `task.done`, `report.done` and `assignment.done`.

**Give human chats and machine attempts different navigation.** The owner sees
Conversations, Buddies, Tasks and Mailbox, with Workers inspectable under their
parent Buddy and work. Team and Mailbox are views; Documents is a content family,
not a required extra tab. Runs are an expandable explanation of task activity. Existing background
conversation rows can remain a storage compatibility detail while the product
stops calling them human conversations.

**Reuse one executor without flattening its authority.** Task, Desk, foreground
and maintenance attempts can share launch, claim, deadline, cancellation and
receipt mechanics. They have different admission and capability policies.
One code path is useful; one undifferentiated policy is the observed capacity bug.

## Things that look simpler but are not

Merging Buddy with Task makes reassignment, one person doing two successive jobs,
and long-term memory harder. Merging Task with Message conflates delivery with
completion. Merging Conversation with execution recreates the human-chat problem.
Merging budget with runtime conflates idle wall time with consumption. Merging
authorization with a team edge recreates unintended access. A generic `Object`
or `Event` envelope merely moves all these branches into consumers.

The honest count is **five core content/identity types, a distinct Prompt execution
contract, one existing workspace boundary and explicit supporting policy/runtime
records**. We can remove user-facing nouns
and duplicate implementations without pretending the supporting invariants disappear.
