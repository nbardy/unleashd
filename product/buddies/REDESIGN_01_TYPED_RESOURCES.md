# Whole-Buddy redesign 1: typed resources and a durable execution queue

> Historical alternative, not a delivery claim. The September 9 owner correction removed
> hiring quotas; requested working teams enable the background capability without starting
> runs. See the [September 10 system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md) for the
> accepted core, implemented API and remaining gaps. Earlier recipes below are retained
> as decision history where they differ.

2026-09-09 · Comparison proposal · Implementation is paused.

This is the incremental alternative: keep explicit records for people, work, messages and
knowledge; run every input through one durable queue. The application coordinates reliable
execution. Buddies decide what to do, who to ask, what to remember and when a result is useful.

Read alongside [2: Event ledger](REDESIGN_02_EVENT_LEDGER.md) and
[3: Shared spaces](REDESIGN_03_SHARED_SPACES.md). They explore different sources of simplicity,
not three layers to implement together. This document recommends this first foundation for
the current application, subject to the comparison and unresolved deployment choices below.

## 1. Reference use case: a team running wave_sim

This records the owner's example as a design fixture. It does **not** provision employees,
search for a real inbox, authorize outreach, or assert that the simulator is ready to sell.

The workspace is `~/git/wave_sim`. The requested persistent team is:

```text
Project Lead
├── Go to Market Lead
│   └── Market Researcher ── collaborates with Product Lead too
├── Product Lead
│   ├── Product Engineer
│   └── Product Designer
├── Wave Simulation Lead
└── Frontier Research Lead
```

This is eight Buddies. The researcher reporting to GTM is a proposed default; “share an
employee” means one identity, one accountable manager and additional collaboration access.
An ephemeral helper inside a turn is a different, shorter-lived mechanism. No engineers are
invented under the simulation or research leads; they can be added later within approved
headcount. A company Chief of Staff can supervise this Project Lead and other workspace leads.
Chief of Staff is a role on an ordinary Buddy, not a special runtime or omniscient superuser.

| Role | Responsibility and observable handoff |
|---|---|
| Project Lead | Own the business outcome, prioritize competing leads, summarize progress and decisions for the owner |
| GTM Lead | Understand target segments, identify prospects, develop interview hypotheses and prepare outreach; send only after the demo prerequisite and action authorization are satisfied |
| Market Researcher | Produce sourced market/customer research for GTM and Product; retain one manager and a visible queue of accepted commitments |
| Product Lead | Understand the product goals and target users; turn evidence into a tight product scope and useful demos |
| Product Designer | Critically evaluate concrete workflows, reject speculative scope, and keep the product usable for selected target users |
| Product Engineer | Implement the accepted product slice and produce inspectable build/demo evidence |
| Wave Simulation Lead | Improve and validate the current simulator; integrate sufficiently mature research through an explicit engineering task |
| Frontier Research Lead | Explore sub-volumetric/non-volumetric simulation ideas and computational cost reductions; separate conjecture, theory and measured evidence; publish qualified handoffs to Simulation |

Target segments, recorded without prematurely choosing one: **wave pool design, surfboard
design, boat hull design, hydrofoil design and coastal engineering**. The owner believes
coastal engineering is the largest market. That is a research hypothesis, not a verified fact.
“Find the core use cases” is work for this team: a matrix of user, decision, current method,
required fidelity, inputs, output, demo and evidence should precede product prioritization.
This architecture review does not silently choose a market or fabricate customer research.

The inbox is an as-yet-unidentified shared integration/folder under `~/git/`. Its exact path,
provider, credentials, recipients and sending authority are deliberately unresolved deployment
inputs. A filesystem path is a location, not permission to send mail.

The essential scenario is: research target users → choose a narrow workflow → design → build
and validate → produce and accept demo videos → prepare customer interview messages → obtain
the required sending authority → send through the authorized inbox → ingest replies → update
product understanding. Research breakthroughs form an independent branch that can feed the
simulator without derailing near-term product delivery.

The owner wants to talk mainly to the Project Lead/Chief, with subordinate employees nested
under their managers. Routine team conversation remains inspectable without flooding that
main conversation. “Not top level” means navigation placement, not secrecy from the owner.

## 2. What the earlier work already gives us

The source baseline is not a clean release. The September 8 living contracts describe one
baseline; the September 9 coordination design and local implementation extend it. The
[integration handoff](../../agent_notes/2026-09-09_buddies-integration-handoff.md) records
mixed application changes, a schema-22 packaged snapshot and newer uncommitted package work.
Package provenance is evidence about an archive, not proof that the whole application ships
every behavior below. This review makes no fresh runtime-validation claim.

| Concern | Existing contract / local evidence | Change needed for this broader use case |
|---|---|---|
| Persistent people | One manager, quota, hire/retire, own soul/memory; canonical team projection | Separate collaboration and discoverability from employment; stable-key hiring instead of identity-by-name |
| Builder | Multiple keyed creations in one chat, scoped soul/profile edits and inline results | Whole-team setup recipe, existing-person attachment, hierarchy and explicit permissions; partial setup must be resumable |
| Work | Owned projects/todos; paused prototype adds parents, revisions, gates and handoff | Queryable prerequisites and collaboration; one work record for independently owned commitments |
| Coordination | Generic send/reply, bounded waits; prototype adds durable inputs, follow-up, source-thread return | Preserve request/run distinction, remove competing legacy paths after migration, specify disclosure |
| Repetition | Scheduler with bounded execution; prototype can target a current conversation | Finish one queue path and coalescing semantics; expose useful attention without mandatory polling |
| Memory | CAS working/long-term docs, owner-directed soul, append-only notes, bounded literal recall | Add explicit audience and workspace provenance; shared knowledge publication; prevent global-memory leakage across contexts |
| Notes | Workspace `agent_notes/` searched on demand | Do not reinterpret existing workspace notes as private employee data; private notes require separate storage and access enforcement |
| Logs | Audit activity, durable run state, provider transcript | Different read policies and UI projections; never use a model-written journal as the activity database |
| Visibility | Reports nested; archive filtering; owner messages and conversation links | Quiet team feed, scoped drilldown, history for archived staff, owner-specific presentation preferences |
| External actions | Tools/integrations exist outside the Buddy domain; narrow project approval prototype | Registered resource adapter, concrete immutable action, enforceable prerequisite and receipt/reconciliation |
| Authority | Scoped MCP/control server and per-run claims | No authority from prose, reporting badges or reused owner sessions; containment needed for strong isolation |

Primary starting points: [memory](PLANNING_MEMORY.md), [staffing](PLANNING_SUB_BUDDIES.md),
[messages](PLANNING_PRIMITIVES.md), [execution](AUTOMATION_OWNERSHIP.md),
[coordination proposal](DESIGN_BUDDY_COORDINATION.md),
[operation schemas](../../server/src/buddies/operations.ts),
[MCP registration](../../server/src/buddies/mcp-server.ts),
[Builder MCP](../../server/src/buddies/builder-mcp-server.ts),
[briefing assembly](../../server/src/buddies/integration.ts), and
[visibility projection](../../server/src/buddies/visibility.ts).

## 3. The smallest useful model

Use six domain concepts. Supporting constraints do not disappear just because they are not
top-level product nouns.

| Concept | Its one job | What it does not own |
|---|---|---|
| Buddy | Persistent responsibility, identity and employment | A provider process, a grant, or all knowledge in its manager's head |
| Work | A commitment with one owner, parent, evidence and prerequisites | The transcript or an automatic workflow program |
| Message | Addressed information or a request with one final reply | Work completion or execution success |
| Document | Versioned knowledge or immutable evidence | Task status or tool permissions |
| Run | One bounded attempt to process a durable input | A new employee or a reusable authorization |
| Schedule | Repeated production of an input at a time | A second executor or permanent authority |

Retain Workspace and Conversation from the application. Add fixed-purpose access rows,
command receipts and external-action receipts. Do not replace them with a generic graph, a
permissions expression language, or a `type: string, payload: any` database. Simple means a
small set of understandable guarantees, not an artificially tiny table/tool count.

The important non-equivalences are explicit:

| Question | Authority |
|---|---|
| Who employs this person? | Buddy.managerId |
| Who owns the deliverable? | Work.ownerId |
| Who may see a record? | Its scope and current access rows |
| Where does it appear in navigation? | Owner view preference and manager projection |
| Who should act on this message? | Message recipient and open request |
| Did computation finish? | Run terminal status after drain |
| Was the deliverable accepted? | Work completion with evidence |
| What did the team learn? | Explicit document/note content and provenance |
| What happened mechanically? | Server-authored audit/receipt history |
| May this email leave the application? | Current integration grant, accepted prerequisite, action decision and broker check |

### 3.1 Data model and common types

The TypeScript below specifies the proposed contract, not code already installed. IDs are
opaque strings validated for the referenced resource kind. JSON schemas must be strict and
generated once for HTTP/MCP/client use. Server-authored fields are never writable through a
client patch. Time is stored in UTC; schedule interpretation additionally stores its zone.

```ts
export {}; // contract module; domain Document is not the browser's global Document
type Id = string;
type Revision = number; // positive integer; 0 means absent only on create
type Instant = string; // validated ISO UTC timestamp
type Key = string;     // stable per logical command, bounded length
type Principal = { kind: 'owner'; id: Id } | { kind: 'buddy'; id: Id };
type Author = Principal | { kind: 'system'; integrationId: Id; externalEventId: string };
type Ref =
  | { kind: 'work'; id: Id; revision: Revision }
  | { kind: 'document'; id: Id; revision: Revision }
  | { kind: 'message'; id: Id }
  | { kind: 'run'; id: Id }
  | { kind: 'action'; id: Id };
type Evidence = { ref: Ref; explanation: string };
type Scope =
  | { kind: 'personal'; buddyId: Id; workspaceId: Id | null }
  | { kind: 'work'; workId: Id }
  | { kind: 'workspace'; workspaceId: Id };

interface Buddy {
  id: Id; revision: Revision; name: string; role: string;
  managerId: Id | null; homeWorkspaceId: Id;
  status: 'active' | 'paused' | 'archived'; hireQuota: number;
  profile: { provider: string; model?: string; reasoningEffort?: string };
}
interface Workspace { id: Id; name: string; rootDirectory: string }
interface Membership {
  buddyId: Id; workspaceId: Id; revision: Revision; epoch: number;
  directoryRead: boolean; readAllWork: boolean; dispatch: boolean;
  backgroundEnabled: boolean; backgroundHeldReason: string | null;
  limits: { activeRuns: number; startsPerHour: number;
            sendsPerHour: number; pendingInputs: number };
}
type Access =
  | { kind: 'work'; workId: Id; buddyId: Id;
      role: 'reader' | 'contributor' | 'supervisor' }
  | { kind: 'document'; documentId: Id; buddyId: Id; role: 'reader' }
  | { kind: 'publication'; buddyId: Id;
      source: { kind: 'work' | 'document' | 'message'; id: Id }; destination: Scope }
  | { kind: 'integration'; integrationId: Id; buddyId: Id;
      operations: ('read' | 'draft' | 'request_send')[] };
```

Access has one row per resource/subject/kind, with a revision, issuer and revocation epoch in
storage. No wildcard subjects, arbitrary conditions, delegation-of-grants or deny precedence
language in this version. Owner grants access; a delegated supervisor can manage work content,
not grant itself external credentials. Workspace membership alone never reads personal
documents/transcripts. A Chief gets explicit workspace work-read/dispatch memberships, not
implicit universal access because its role contains “Chief.”

A publication row permits one named publisher to disclose one source resource into one exact
destination scope. It still requires current source read and destination write access; source
references pin the version actually published. It conveys no right to publish adjacent private
records. Owner approval of this access row is durable, so every later permitted publication
does not need another permission question. Publishing within the existing source audience
needs only its normal write right; widening it requires the row or authenticated owner action.

The manager edge is acyclic and singular. Names are editable labels, not identity keys.
Keyed hire replay returns the same ID; reactivation explicitly names an archived ID. Reusing
an archived employee's name must not silently recover the wrong memory. Quota counts active
and paused direct reports. Reparenting, quota changes and top-level Builder hires are owner
operations; manager hiring remains limited by existing funded quota and conversation policy.

### 3.2 Work: ownership, composition and prerequisites

```ts
interface Work {
  id: Id; workspaceId: Id; parentId: Id | null; ownerId: Id;
  revision: Revision; title: string; objective: string; definitionOfDone: string;
  state: 'open' | 'done' | 'cancelled'; phase: string; // phase is descriptive
  nextAction: string | null; blockedReason: string | null;
  evidence: Evidence[];
  acceptancePolicy: { reviewerId: Id; minArtifacts: number; mediaTypes: string[] };
  acceptance: { receiptId: Id; workRevision: Revision; acceptedBy: Principal;
    evidence: Evidence[]; acceptedAt: Instant } | null;
  execution: 'enabled' | 'paused' | 'draining' | 'cancelled';
  epoch: number; pendingOwnerId: Id | null;
}
interface Requirement { workId: Id; requiresWorkId: Id }
```

“Project” and “task” are presentation sizes of Work. Small checklist items can remain embedded
todo values during migration; anything independently owned, gated or scheduled becomes Work.
Parent/child describes decomposition. Requirement describes a **hard prerequisite**; the two
graphs are separate, acyclic and bounded to visible work. A parent does not become done when
its children do. A completed prerequisite must have accepted evidence; a cancelled one does
not satisfy the edge. A parent cannot require its descendant or any work whose prerequisites
transitively require the parent: that would prevent the work needed to unblock it.

The named reviewer defaults to the work owner. Only that reviewer or the authenticated owner
may mark done; contributors publish candidate evidence and request review. Completion writes
an immutable acceptance receipt containing the exact work revision, actor and artifact/document
revisions, then sets state=done atomically. The policy's fixed artifact count/media-type checks
are optional (zero/empty for ordinary textual work); no arbitrary expression evaluator exists.
For `accepted-demo`, the owner chooses Product Lead as reviewer and requires at least one
supported video artifact. Subjective usefulness remains a review judgment. Changing that
policy is a supervisor/owner operation with a new revision and invalidates prior acceptance.

The default prerequisite gate blocks *execution of the dependent Work*, not all planning in
its parent. Thus outreach drafting is one work item; dispatch is a separate dependent item.
Dependencies do not evaluate model prose, create tasks or choose a next actor. When a gate
opens, an already accepted, never-started input becomes eligible; no new input is invented.
The scheduler is enough to observe this change. Closed→reopened prerequisites fence dependent
active runs and hold queued work; external effects already dispatched cannot be undone.

The gate predicate is: current membership/grants; target and all ancestors open; target and
ancestor execution enabled; all explicit prerequisites currently done with valid acceptance;
matching admission epochs. Done work admits no new work runs. Reject completing a parent
while any descendant is open or any other descendant run has not drained. The finishing run
may still publish its final reply and drain; returns execute in the requester's source work.
Done leaves never-started target inputs held as `work_closed`, inspectable for deliberate
reopen/retry. Cancel cancels them; pause holds them. Reject prerequisite edges between any
ancestor/descendant pair, in either direction, and reject cycles in the effective graph after
inherited parent gates are included, not just cycles within either raw edge table.

A run bound to Work may write there or to an authorized descendant; it cannot drop its Work
association to evade cancellation. Cross-workspace children/prerequisites require explicit
read membership for the accountable supervisors and recipient membership at dispatch. No
invisible blocker title, owner name or derived count leaks across that boundary.

### 3.3 Messages: ordinary purposes, explicit routes

```ts
type SendRoute =
  | { kind: 'new'; to: Principal; workspaceId: Id }
  | { kind: 'followup'; messageId: Id } // prior requester → prior recipient
  | { kind: 'return'; messageId: Id }   // prior recipient → prior requester
  | { kind: 'self' };                  // bound current Buddy/thread/workspace
interface Message {
  id: Id; from: Principal; to: Principal;
  workspaceId: Id; workId: Id | null;
  sourceConversationId: Id; sourceWorkId: Id | null;
  targetConversationId: Id | null;
  rootRunId: Id; causedByRunId: Id | null; route: SendRoute;
  purpose: string; body: string; evidence: Evidence[];
  expectsReply: boolean; notBefore: Instant | null; afterRunId: Id | null;
  state: 'open' | 'replied' | 'cancelled' | 'superseded' | 'informational';
  final: { outcome: string; body: string; evidence: Evidence[];
           repliedAt: Instant; repliedBy: Principal } | null;
  supersededBy: Id | null;
}
```

Message body and final reply are immutable after their respective commits. A request can be
open across several completed runs. A final reply settles that request once; it does not
mark Work done. Review, clarification, delegation, refusal and approval discussion are open
purpose/outcome strings, with no extra reviewer, review-task or sign-off engine.

New requests create fresh recipient sessions. Follow-up derives its route from an existing
message and retains that recipient session when still available and compatible. It does not
accept an arbitrary private conversation ID. Return sends informational progress; final reply
uses the recorded requester route. Self-send is informational and queues behind successful
drain of the current bounded run. Each route is validated against identity and current access.
The UI thread and the provider session are different IDs: a deleted session can be replaced
with an authorized bounded handoff in the same logical thread, with an explicit reset marker.

Message visibility is sender, recipient and authenticated owner. Being a manager does not
reveal every direct report's messages. A lead sees relevant work and published evidence, and
can ask for a summary. Copying a message into wider knowledge is an explicit publication,
which validates the destination audience and the publisher's disclosure authority.

### 3.4 Knowledge: one document family, different writing rules

```ts
type Content =
  | { kind: 'text'; markdown: string }
  | { kind: 'asset'; blobId: Id; sha256: string; mediaType: string;
      byteLength: number; title: string };
type DocumentKind = 'soul' | 'working' | 'long_term' | 'knowledge' | 'note' | 'artifact';
interface Document {
  id: Id; kind: DocumentKind; scope: Scope; owner: Principal;
  title: string; head: Revision; archivedAt: Instant | null;
}
interface DocumentRevision {
  documentId: Id; revision: Revision; content: Content;
  author: Author; sourceRunId: Id | null; writtenAt: Instant;
  reason: string; evidence: Evidence[]; contentHash: string;
}
```

This is shared persistence, not interchangeable meaning:

| Kind | Write/recall rule |
|---|---|
| Soul | One owner-directed identity/style revision stream per Buddy; same global identity across workspaces; no runtime authority in its prose |
| Working / long-term | Full bounded CAS replacement by that Buddy; workspace scope by default, plus explicitly portable personal long-term knowledge; never copy work status/blockers/assignees |
| Knowledge | Shared, versioned product brief, research synthesis, customer assumptions or operating procedure; explicitly scoped and edited by its work owner/contributors |
| Note | One immutable text revision; correction is another note citing it; append-only evidence of attempts/lessons, not a diary obligation |
| Artifact | One immutable byte reference; new bytes produce a new artifact; conclusions/acceptance live in Work/knowledge with exact revision references |

Keep the current dense caps (working 2,000 characters; long-term 4,000; soul 10,000), note cap
16,000 UTF-8 bytes, bounded recall and no silent trimming. Large research reports/files remain
artifacts opened on demand. These are proposal defaults, not promises about model quality.
Documents keep immutable revisions and one head. Storage of text and asset metadata belongs
to the authoritative store; exported Markdown and inbox folders are materialized views.

Private, work-shared and workspace-shared are explicit scopes. Existing `agent_notes/` content
is migrated as workspace evidence with original provenance, never silently relabeled private.
Personal documents cannot be stored in a directory mounted into every employee's process.
Facts used across projects are intentionally promoted to a knowledge document at the common
authorized scope. `personal.workspaceId=null` is a Buddy's portable long-term partition for
self-managed general lessons/preferences; it is not owner-edited soul and is never other
Buddies' shared memory. Preserve the earlier requirement that each Buddy learns for itself.
Portable+current-workspace long-term text share the 4,000-character injection cap; each write
checks that bound against affected partitions rather than silently clipping. Working memory
remains workspace-specific. The API rejects references to restricted source records in a
portable write without explicit source-owner disclosure permission. Free-text classification
still has the cooperative-agent limitation below. Arbitrary workspace/customer facts are not
automatically copied globally; common business knowledge uses a scoped shared publication.

At each new run, resolve the current soul and permitted dense-memory revisions plus current
work/inbox summaries. Append a server-labeled context update to a continued thread when those
heads changed. Do not silently rewrite historical messages. Evidence and tools remain data,
not a new instruction source. This changes the current creation-only memory snapshot policy.
No automatic transcript replay/compaction writes memory; optional closing capture spends the
same original run's remaining budget and already-granted permissions.

Detailed notes should retain the useful sequence of attempts, observations, failures and
exploration, not just compress everything into a few lessons. A long note exceeding the
bounded tool body can be published as a text artifact with a short indexed note linking it,
or as ordered notes with explicit predecessor references. Neither route silently summarizes
or truncates the original. These are authored explanations and evidence, not access to hidden
provider reasoning. Deleting a native transcript must not delete the referenced report,
accepted result or dense memory.

**Capture choice:** keep selective same-turn writing as the default. The optional owner setting
`captureOnSuccess` extends the existing automation mechanism to all successful eligible inputs:
one bounded closing capture phase in the same Run, reading only that run's permitted visible
transcript interval. Key it by run ID + interval end; preserve the exact interval and any note
receipt. Do not capture capture-generated turns again. Re-read current document heads, use CAS,
and report a capture error separately from successful work. No spare time/iteration allowance
means an explicit skipped capture, not a hidden new job. No material learning means no write.
Long authored notes can preserve details while dense memory stays small.

A separate cheaper model is a possible later adapter optimization, not a new persistent
employee: it would need its own bounded, memory-only Run with frozen source interval,
deduplication, scope, cancellation, budget and no outgoing messages/actions. This proposal
does not require that second path to fulfill team coordination, and does not pretend universal
per-turn capture already exists. Compare capture quality/noise before enabling it by default.

A provider session that has seen confidential material cannot later become a narrower-reader
session merely because an API ACL changed. On an access-domain change, revocation or workspace
switch, start a fresh provider session with only currently permitted handoff content. A shared
researcher keeps one employee identity, but distinct contexts for different disclosure scopes.
Provenance helps review; it cannot mechanically prove that model-generated prose contains no
private paraphrase. Stronger isolation and publication review are needed where that guarantee
matters. The single-owner workspace baseline is a cooperative-agent trust model.

### 3.5 Runs and schedules: one executor

```ts
type RunInput =
  | { kind: 'chat'; conversationId: Id; messageId: Id }
  | { kind: 'request'; messageId: Id }
  | { kind: 'reply'; messageId: Id }
  | { kind: 'tick'; scheduleId: Id; definitionRevision: Revision; dueAt: Instant }
  | { kind: 'notice'; failedRunId: Id }
  | { kind: 'inbound'; integrationId: Id; externalEventId: string; documentId: Id };
interface Run {
  id: Id; input: RunInput; inputKey: string; attempt: number;
  buddyId: Id; workspaceId: Id; workId: Id | null; conversationId: Id;
  rootRunId: Id; causedByRunId: Id | null; afterRunId: Id | null;
  readyAt: Instant; status: 'queued' | 'running' | 'stopping' |
    'complete' | 'failed' | 'cancelled' | 'interrupted';
  holdReason: string | null; deadline: Instant | null;
  retryOf: Id | null; startedAt: Instant | null; endedAt: Instant | null;
}
type Repeat =
  | { kind: 'interval'; seconds: number }
  | { kind: 'cron'; expression: string; timeZone: string };
interface Schedule {
  id: Id; revision: Revision; buddyId: Id; workspaceId: Id; workId: Id | null;
  conversationId: Id; prompt: string; repeat: Repeat;
  enabled: boolean; nextDueAt: Instant; archivedAt: Instant | null;
}
```

Private run storage additionally holds a random claim credential, policy snapshot, process
owner identity, work/ancestor/membership epoch snapshots, and deadline. Public schemas have an
explicit whitelist; they never serialize the private record or a token-bearing object.
The queue is a query over Runs; no mailbox delivery table owns competing execution status.
Unique input key+attempt, one nonterminal attempt per input, one active run per conversation,
and atomic slot reservation enforce ownership. A short claim/dispatch phase can be stored
internally; a failure after launch is never “queued and safe to replay.”

Schedule prompt, selected scope and definition revision are frozen into the occurrence input
transaction. Disable/archive prevents new occurrences and holds never-started ones; stopping
an active occurrence requires explicit cancellation or a work gate. Editing a schedule changes
future occurrences only. Advancing nextDueAt and inserting the occurrence are atomic. During
downtime, coalesce all missed ticks into one outstanding check, then advance to the first
future tick; do not replay hours of management meetings. Validate cron/timezone with the
existing parser and pin/test daylight-saving behavior before release.

### 3.6 External action: a typed intent and its receipt

An email that affects somebody outside the app deserves a durable receipt, even if all the
internal planning used messages. Do not claim an internal `reply(outcome:'approved')` can
authorize arbitrary shell commands.

```ts
interface MailDraft {
  to: string[]; cc: string[]; bcc: string[];
  subject: string; body: string; attachments: Ref[];
}
interface ActionIntent {
  id: Id; revision: Revision; requester: Principal; workId: Id;
  integrationId: Id; operation: 'mail.send'; args: MailDraft; argsHash: string;
  evidence: Evidence[];
  prerequisiteSnapshot: { workId: Id; acceptanceReceiptId: Id; revision: Revision }[];
  expiresAt: Instant; createdByRunId: Id;
  decision: 'pending' | 'approved' | 'rejected'; decidedBy: Principal | null;
  execution: 'not_started' | 'dispatching' | 'succeeded' | 'failed' | 'unknown';
  providerReceipt: string | null; supersedes: Id | null;
}
interface IntegrationPolicy {
  integrationId: Id; workspaceId: Id; revision: Revision;
  requiredWorkIds: Id[];
  requiredReviewers: { workId: Id; reviewerId: Id }[];
  approval: 'exact_owner_action'; enabled: boolean;
}
```

The integration registry binds an ID to a broker adapter and credential reference outside
model-visible storage. A granted `request_send` lets a Buddy propose an action; it does not
by itself approve it. Default for this sample: owner approves the exact prepared interview
batch after accepted demo videos exist. Future standing grants must be bounded by integration,
operation, audience, expiry and count; they cannot be inferred from “GTM does outbound.”
The initial typed IntegrationPolicy intentionally supports exact owner action approval only;
the standing-grant sentence describes a later bounded adapter extension, not an unimplemented
field that the current policy magically enforces. Other external operations can register
their own strict argument/receipt schema at this same adapter boundary without changing
Buddy messages, Work, knowledge or the executor. No arbitrary shell-command adapter is implied.

Integration configuration also specifies the exact `requiredWorkIds` for this operation. The
service derives prerequisite snapshots from these IDs plus the action work's requirements;
the requester cannot substitute a self-created “demo done” task. This is generic accepted-work
gating. There is no `demoReady` or `demoEvidence` field in the domain action API: video is the
output requirement of an ordinary Work item in this particular business setup.

Action arguments are immutable. Changing body, recipients, attachments, demo version or
prerequisite acceptance creates a new intent and needs matching authorization. Owner approval
and queue admission are atomic. Broker checks current grant, expiry, work gates and exact
accepted artifact digests immediately before dispatch. The prerequisite requires an authorized
reviewer's evidence-backed acceptance of retrievable video bytes for the intended demo; a
filename, model assertion or unchecked `done` label is insufficient. Review evaluates whether
it is a useful demo; software verifies the referenced acceptance/version and availability.

Each action has a stable adapter idempotency key. If the mail service supports idempotency,
reconcile with that key. If it does not and acknowledgement is lost after sending, persist
`unknown`; do not blindly send again. An owner inspects provider evidence and records whether
to abandon or create a new intent. Approval is consumed by this action, not reusable by a new
model run. Deleting an artifact or revoking permission before dispatch prevents the send.
After dispatch the action cannot be recalled by changing local state.

This guarantee requires credentials to remain exclusively at the broker and direct mail
connectors to be absent from gated Buddy execution. The current same-OS-user harness can
bypass application APIs via shell/files/network. Therefore app-level policy alone is not
adversarial containment. If the owner needs that protection, the execution adapter must also
isolate filesystem mounts, credentials and network egress. Until that exists, label the system
as cooperative local automation; do not advertise a hard security boundary it cannot enforce.

## 4. API and MCP surface

One typed service implements each operation. Owner HTTP, scoped MCP and scheduler internals
call that service with different **server-derived** authority. Never accept actor, claim token,
owner identity, grant list or source-conversation identity from a public tool argument.

### 4.1 Common results and bounded reads

```ts
type Page<T> = { items: T[]; nextCursor: string | null; snapshot: string };
type Result<T> = { ok: true; value: T; receiptId?: Id } | {
  ok: false;
  code: 'not_found' | 'forbidden' | 'conflict' | 'key_reused' | 'invalid' |
    'limit' | 'held' | 'stale_claim' | 'missing_destination' | 'effect_unknown';
  message: string; retryable: boolean;
  current?: { revision: Revision; content?: string };
};
type ReadRequest =
  | { kind: 'buddy' | 'work' | 'message' | 'run' | 'schedule' | 'action'; id: Id }
  | { kind: 'document'; id: Id; revision?: Revision }
  | { kind: 'own_document'; doc: 'soul' | 'working' | 'long_term'; workspaceId?: Id };
type ListRequest =
  | { kind: 'buddies'; workspaceId: Id; managerId?: Id; includeArchived?: boolean }
  | { kind: 'work'; workspaceId: Id; ownerId?: Id; parentId?: Id; state?: Work['state'] }
  | { kind: 'inbox'; workspaceId: Id; state?: Message['state']; after?: Instant }
  | { kind: 'runs'; workId?: Id; conversationId?: Id; status?: Run['status'] }
  | { kind: 'documents'; scope: Scope; documentKind?: DocumentKind }
  | { kind: 'schedules'; workspaceId: Id; buddyId?: Id }
  | { kind: 'activity'; workspaceId: Id; workId?: Id; after?: Instant };
interface DocumentView { document: Document; revision: DocumentRevision }
type InboxView =
  | { kind: 'message'; value: Message }
  | { kind: 'failure'; value: Run }
  | { kind: 'approval'; value: ActionIntent };
interface ActivityView { id: Id; actor: Author; at: Instant; operation: string; resource: Ref }
interface ResourceMap {
  buddy: Buddy; work: Work; message: Message; run: Run; schedule: Schedule;
  action: ActionIntent; document: DocumentView; own_document: DocumentView;
}
interface ListViewMap {
  buddies: Buddy; work: Work; inbox: InboxView; runs: Run;
  documents: Document; schedules: Schedule; activity: ActivityView;
}
```

`read` returns the public type corresponding to `kind`; `list` returns that kind's typed
projection, not an untyped union in every item. Generated discriminated response schemas
preserve this mapping. Cursor pages default to 25 and cap at 100; stable `(createdAt,id)`
ordering, access filtering **before** counting, bounded text and a snapshot/cursor prevent a
busy team from losing newer rows behind an oldest-100 limit. Revocation is checked per page;
a stale cursor returns restart guidance instead of leaked historical access.

### 4.2 Ordinary Buddy tools and signatures

These signatures show model inputs. Each mutation's `key` binds a canonical argument hash
inside actor+workspace scope. Same key/same input returns its receipt; a changed input returns
`key_reused`. CAS conflict is a real conflict, not permission to substitute the latest head.
Receipt replay rechecks current read authorization before returning stored content; a revoked
caller cannot recover confidential old results by replaying an old key. `own_document` resolves
the bound Buddy's soul/dense-document ID and current revision without guessing an ID. A missing
workspace selects portable long-term or soul; working memory requires the bound workspace.

```ts
declare function read<K extends keyof ResourceMap>(
  input: ReadRequest & { kind: K }): Promise<Result<ResourceMap[K]>>;
declare function list<K extends keyof ListViewMap>(
  input: ListRequest & { kind: K; cursor?: string; limit?: number }
): Promise<Result<Page<ListViewMap[K]>>>;

declare function create_work(input: { key: Key; workspaceId: Id; parentId?: Id; ownerId?: Id;
  title: string; objective: string; definitionOfDone: string; requires?: Id[] }): Promise<Result<Work>>;
declare function update_work(input: { key: Key; id: Id; baseRevision: Revision;
  patch: WorkPatch; evidence?: Evidence[] }): Promise<Result<Work>>;

declare function send(input: { key: Key; route: SendRoute; workId?: Id; purpose: string;
  body: string; evidence?: Evidence[]; expectsReply: boolean;
  notBefore?: Instant }): Promise<Result<Message>>;
declare function reply(input: { key: Key; messageId: Id; outcome: string;
  body: string; evidence: Evidence[] }): Promise<Result<Message>>;

declare function write_document(input: { key: Key; target: DocumentTarget; baseRevision: Revision;
  content: string; reason: string; evidence?: Evidence[] }): Promise<Result<DocumentRevision>>;
declare function append_note(input: { key: Key; scope: Scope; topic: string; kind?: string;
  body: string; evidence?: Evidence[] }): Promise<Result<Document>>;
declare function publish_artifact(input: { key: Key; scope: Scope; title: string;
  source: { kind: 'mounted_file'; relativePath: string } | { kind: 'upload'; uploadId: Id };
  evidence?: Evidence[] }): Promise<Result<Document>>;
declare function recall(input: { scope: Scope; query: string; since?: Instant; limit?: number;
  cursor?: string; regex?: boolean }): Promise<Result<Page<RecallHit>>>;

declare function set_schedule(input: { key: Key } & (
  { kind: 'create'; definition: ScheduleDraft } |
  { kind: 'update'; id: Id; baseRevision: Revision; definition: ScheduleDraft } |
  { kind: 'disable'; id: Id; baseRevision: Revision }
)): Promise<Result<Schedule>>;
declare function stop(input: { key: Key; target: { kind: 'run' | 'chain'; id: Id };
  reason: string }): Promise<Result<StopReceipt>>;
declare function retry(input: { key: Key; runId: Id; reason: string }): Promise<Result<Run>>;

declare function request_action(input: { key: Key; workId: Id; integrationId: Id;
  operation: 'mail.send'; args: MailDraft; evidence: Evidence[];
  expiresAt: Instant }): Promise<Result<ActionIntent>>;
```

Supporting input/output types are finite, not arbitrary patches:

```ts
type WorkPatch =
  | { kind: 'content'; title?: string; objective?: string; definitionOfDone?: string;
      phase?: string; nextAction?: string | null; blockedReason?: string | null;
      requires?: Id[] }
  | { kind: 'finish'; state: 'done' | 'cancelled' }
  | { kind: 'reopen' }
  | { kind: 'execution'; state: 'enabled' | 'paused' | 'cancelled' }
  | { kind: 'transfer'; ownerId: Id };
type DocumentTarget =
  | { kind: 'existing'; id: Id }
  | { kind: 'new_knowledge'; scope: Scope; title: string }
  | { kind: 'own_memory'; workspaceId: Id; doc: 'working' | 'long_term' }
  | { kind: 'portable_memory'; doc: 'long_term' };
interface ScheduleDraft {
  buddyId?: Id; workId?: Id; prompt: string; repeat: Repeat;
  target: { kind: 'current_conversation' } | { kind: 'existing'; conversationId: Id };
  enabled: false; // Buddy can draft/update disabled definitions, or disable
}
interface RecallHit { documentId: Id; revision: Revision; excerpt: string; evidence: Evidence[] }
interface StopReceipt { targetId: Id; state: 'draining' | 'stopped'; affectedRunIds: Id[] }
type MembershipSettings = Pick<Membership,
  'directoryRead' | 'readAllWork' | 'dispatch' | 'backgroundEnabled' | 'limits'>;
interface AccessReceipt { revision: Revision; access: Access; revoked: boolean }
```

`ResourceMap`/`ListViewMap` above are named mappings of the read/list discriminants, with
public run/identity/work/document/message/action schemas. `activity` is a filtered server
audit projection; `inbox` is messages plus actionable failure/approval pointers with explicit
variant tags. Neither view is a second writable source of status.

This is **14 ordinary operations**, plus conditionally exposed staffing and soul operations
below. Read/list reduce duplicated retrieval plumbing; the writes stay named and typed so a
model can understand their guarantees. Do not compress them into one “do anything” tool.
Provider-native ephemeral helpers remain provider capabilities, not another Buddy tool.

`publish_artifact` reads bytes only from an authorized mounted workspace-relative file or a
completed authorized upload, validates containment without following an escaping symlink,
and stores the bytes/digest before committing the immutable Document reference. A caller
cannot supply a trusted hash for unread bytes. Publication validates the target audience and
has a configured byte quota. Unreferenced staged bytes are garbage-collected after a safe
grace period. `write_document` cannot revise immutable notes/artifacts or target soul through
its general path; create/revise permissions depend on the declared document kind.

New MCP calls are asynchronous; reply is delivered durably. Preserve legacy `send(wait)` as
a compatibility adapter with its current bounded cancellable semantics, but do not expose it
in the new catalog by default. That avoids a blocked waiter and a background return both
processing the same reply. Retire compatibility only after old active conversations drain.

### 4.3 Owner, Builder and manager surfaces

```ts
declare function hire(input: { key: Key; name: string; role: string; soul: string; workspaceIds: Id[];
  profile?: Buddy['profile'] }): Promise<Result<Buddy>>; // manager is bound, quota enforced
declare function retire(input: { key: Key; buddyId: Id; baseRevision: Revision;
  reason: string }): Promise<Result<Buddy>>; // open work must already be transferred/cancelled
declare function update_soul(input: { key: Key; baseRevision: Revision; content: string;
  reason: string }): Promise<Result<DocumentRevision>>; // bound self, direct owner intent only

// Owner-authenticated HTTP / tightly scoped Builder service; never normal employee MCP:
declare function create_buddy(input: { key: Key; name: string; role: string; soul: string;
  workspaceIds: Id[]; managerId?: Id; profile?: Buddy['profile'] }): Promise<Result<Buddy>>;
declare function configure_member(input: { key: Key; buddyId: Id; workspaceId: Id;
  baseRevision: Revision; settings: MembershipSettings }): Promise<Result<Membership>>;
declare function set_access(input: { key: Key; access: Access; baseRevision: Revision;
  revoke: boolean }): Promise<Result<AccessReceipt>>;
declare function set_employment(input: { key: Key; buddyId: Id; baseRevision: Revision;
  managerId: Id | null; hireQuota?: number }): Promise<Result<Buddy>>;
declare function enable_schedule(input: { key: Key; id: Id; baseRevision: Revision;
  enabled: boolean }): Promise<Result<Schedule>>;
declare function decide_action(input: { key: Key; id: Id; baseRevision: Revision;
  argsHash: string; decision: 'approved' | 'rejected' }): Promise<Result<ActionIntent>>;
declare function configure_integration(input: { key: Key; baseRevision: Revision;
  policy: Omit<IntegrationPolicy, 'revision'> }): Promise<Result<IntegrationPolicy>>;
declare function set_acceptance_policy(input: { key: Key; workId: Id; baseRevision: Revision;
  policy: Work['acceptancePolicy'] }): Promise<Result<Work>>;
declare function repair_destination(input: { key: Key; runId: Id; conversationId: Id;
  reason: string }): Promise<Result<Run>>;
```

`MembershipSettings` is exactly the editable booleans/limits in Membership, excluding
identity/epoch. `AccessReceipt` is the saved access-row revision/revocation state. Builder
creation uses the existing keyed creation receipt; a normal manager cannot supply an arbitrary
manager ID or set its own quota. Builder can refine only its own creations unless a distinct
owner-authorized existing-employee operation is invoked. A team setup is a repeatable series
of ordinary keyed operations, with a result card per member and explicit partial completion;
do not invent a permanent TeamSetup workflow entity or rollback by deleting useful employees.

`repair_destination` is also conditionally available to the original requester for its own
held return run. It requires the old execution to be absent/drained and an existing compatible
conversation belonging to the same destination Buddy/workspace/work and permitted disclosure
scope. It records the old/new binding and resets no grant; it cannot redirect somebody else's
request or bypass cancellation. The owner may create that compatible thread first through
the ordinary conversation API. Route: POST `/runs/:id/destination`. Acceptance policy uses
PUT `/work/:id/acceptance-policy`. These controls are not exposed to every employee run.
`set_acceptance_policy` is conditionally exposed to an explicitly authorized work supervisor;
its server service is shared with the owner endpoint. Integration configuration remains owner
only via PUT `/integrations/:id/policy`. Credentials are configured separately in the host's
resource service and never included in these policy arguments/results.

| Mutation | Required authority in addition to current claim/scope |
|---|---|
| Create/assign work | Self; direct manager assigning its own report; or explicit work supervisor assigning a participating Buddy; owner can assign |
| Edit content/prerequisites | Work owner/contributor/supervisor; constraints and graph validation always apply; cannot edit done work without reopen |
| Finish done | Named reviewer or owner, accepted evidence and artifact policy; reviewer must have work read access |
| Reopen/cancel/pause/transfer/change acceptance policy | Work owner or explicit supervisor/ancestor supervisor in scope, or owner; review-policy changes invalidate acceptance |
| Accept an external action | Owner-authenticated decision or an exact already configured bounded standing grant; no ordinary work role suffices |
| Edit shared knowledge | Owner/contributor in its scope; widening publication additionally requires disclosure authority |
| Edit personal memory | Bound Buddy, permitted scope; no manager edit privilege |
| Hire/retire | Direct owner conversation, funded direct manager; unavailable in delegated/scheduled contexts even if named in an operation list |

An integration's pinned prerequisite/required reviewer policy is owner-configured. A work
supervisor changing that work's acceptance policy invalidates the action snapshot and cannot
change the broker's pinned expectation. Collaboration grants cannot silently override it.

HTTP maps these service methods onto resources: GET `/api/buddies/v2/read` and `/list` with
validated query discriminants, POST `/work`, PATCH `/work/:id`, POST `/messages`,
POST `/messages/:id/reply`, PUT `/documents/:id`, POST `/notes`, GET `/recall`,
POST `/artifacts`, PUT `/schedules/:id`, POST `/runs/:id/stop`, POST `/runs/:id/retry`,
and POST `/actions`. The existing upload transport supplies scoped staging IDs for `/artifacts`.
Creation of a new document/schedule uses POST to its collection with revision zero.
Owner mutations use `/memberships`, `/access`, `/employment`, `/schedules/:id/enabled` and
`/actions/:id/decision`. Chain stop uses `/chains/:rootRunId/stop`. These are adapters to the
same services, not independent authorization implementations. A versioned migration namespace
is temporary compatibility, not a permanent second backend.

### 4.4 Private runtime and integration ports

```ts
declare const privateHostProof: unique symbol;
type DrainProof = { readonly [privateHostProof]: 'joined_drain' };
interface PrivateClaim { runId: Id; credential: string; processOwner: Id; deadline: Instant }
interface RunResult {
  status: 'complete' | 'failed' | 'cancelled' | 'interrupted'; error?: string;
}
type InboundPage = Page<{ externalEventId: string; externalThreadId: string; documentId: Id }>;
interface ExecutorPort {
  claimNext(now: Instant, processOwner: Id): Promise<PrivateClaim | null>;
  begin(claim: PrivateClaim): Promise<void>;
  authorize(claim: PrivateClaim, operation: string, resource: Ref | Scope): void;
  settle(claim: PrivateClaim, drained: DrainProof, result: RunResult): Promise<void>;
}
interface IntegrationPort {
  readAuthorized(resourceId: Id, cursor?: string): Promise<InboundPage>;
  dispatchApproved(actionId: Id): Promise<ActionIntent>;
  reconcileUnknown(actionId: Id): Promise<ActionIntent>;
}
```

These are dependency-injected server ports, never public MCP tools or model JSON. PrivateClaim
includes the credential and epoch snapshot; DrainProof is produced by joined provider exit,
event consumption and session persistence, never accepted from a remote caller. RunResult is
a terminal status/error/usage structure, not a model outcome string. InboundPage contains
provider-stable event IDs and sanitized source references; ingestion validates adapter
authentication and deduplicates by integration+event ID before creating informational input.
Raw email content cannot authorize operations, change soul, or choose an unrestricted target.
Inbound body/attachments are immutable scoped Documents authored as system/integration data;
the inbound RunInput references them without impersonating a human or Buddy sender. Its
recipient/thread is taken from owner-approved integration routing configuration.

## 5. Execution, failure and concurrency

```text
Human input / message / reply / due schedule / authenticated inbound item
                      │
      validate scope + commit input and queued Run atomically
                      │
        gates + limits + conversation slot + private claim
                      │
               existing Conversation runtime
                      │
          scoped tools, artifacts and transcript stream
                      │
           process + event + persistence drain
                      │
           terminal Run and observable work state
```

1. **Persist before dispatch.** Request+queued run and final reply+return run are transactions.
   A crash between them cannot lose an accepted wakeup. Claim reserves all relevant slots.
2. **Per-input authority.** A return in the owner's current chat gets a fresh restricted
   background policy intersected with current grants. The next human input resolves its own
   policy. Old session context, an old approval or a manager relationship never supplies it.
3. **No provider execution in transactions.** Persist a reserved destination ID and claim,
   then create/resume through the existing conversation boundary. Recheck authority at dispatch.
4. **Healthy waiting.** Lead sends to engineers and ends the turn. Its request remains open.
   Later valid runs in that bound lead thread may settle it after inspecting replies.
5. **Source-scoped return.** Engineer work completion does not block its final reply. The
   return run belongs to the lead's original work/workspace, not the engineer's completed task.
6. **Serialization and fairness.** One active run per conversation, not one per employee.
   Owner inputs can precede background inputs at most three times while one is waiting.
   Independent conversations use work/document CAS and isolated coding worktrees as appropriate.
7. **Cancellation.** Fence tools and descendant admission immediately; signal provider stop;
   retain the slot until joined drain. A timeout is not proof of drain. Run terminal states
   are absorbing; delayed callbacks with stale claims cannot write or send.
8. **Project control.** Pause/cancel increments ancestor epochs for the subtree, fences active
   runs and blocks new children. Resume does not replay interrupted or stale inputs. Explicit
   retry rechecks grants/gates after confirmed termination and records a new attempt.
9. **Handoff.** Transfer records pendingOwnerId and drains the affected subtree. Then change
   the selected owner, retain explicit child owners, supersede open requests for the old owner
   and reissue with original source/return provenance. Never transfer a private provider session.
   Disable affected schedules for inspection. Interrupted child work stays visible for recovery.
10. **Crash recovery.** After a process is proven gone, classify its active attempts interrupted.
    Never auto-adopt or replay uncertain effects. A never-dispatched input can be safely retried
    after revalidation; lease expiry alone does not prove it never ran.
11. **Missing destination.** Keep an accepted reply and show a held run. Owner or authorized
    requester explicitly repairs the destination to a compatible same-Buddy scope; do not
    create a random private chat or navigate to a deleted transcript.
12. **Resource bounds.** Start from background off, 600 seconds/run, two active runs/Buddy,
    eight globally, 30 background starts/hour, 100 sends/hour and 100 pending inputs/Buddy.
    Reserve counters atomically, persist rolling-window accounting and show a held reason.
    Replies/failure receipts are durable even when execution is capped. Caps do not discard
    accepted information. Token/dollar caps are not advertised until adapters meter them.

Only one pending self-successor is allowed per run. It inherits root/work scope and is released
only on successful drain. Schedule inputs create independent roots but share membership/work
limits. A root stop blocks all future descendants of that conversation chain; a work pause
also reaches unrelated roots and schedules attached to that work. No special loop engine is
required. A failed notice does not spawn another failure notice recursively.

## 6. Visibility, memory and logs in the product

### 6.1 Explicit read matrix

| Surface | Owner | Buddy itself | Manager / Chief | Collaborator |
|---|---|---|---|---|
| Directory, name/role/reporting | All owned scopes incl archived history | Membership directory | Membership directory | Membership directory |
| Work/status/accepted evidence | All | Owned/authorized work | Supervised work or explicit work-read grant | Explicit work role |
| Internal request/reply | All via deliberate drilldown | Participant | Only participant or explicit published copy | Only participant or explicit published copy |
| Personal working/long-term/notes | Owner inspector | Own current permitted scope | No automatic read | No automatic read |
| Shared knowledge/notes | All | Scope access | Scope access | Scope access |
| Provider transcript/tool trace | Owner inspector | Its permitted session | No automatic read | No automatic read |
| Operational activity | Full authorized audit | Filtered own/work activity | Filtered supervised work | Filtered shared work |
| Credentials/claim tokens | Credential settings, never normal content views | Never | Never | Never |

“Personal” protects against other employees, not the owner of this local workspace. A future
multi-human tenant/private HR use case requires separate human identities, tenant boundaries
and policy; it is not achieved by hiding a sidebar row. Historical references to an archived
Buddy render a tombstoned label and authorized history, not recursive deletion of messages
mentioning it. Archive removes it from active dispatch/directory defaults, not accountability.

### 6.2 Four different things often called logs

- **Transcript:** what a specific human/Buddy/provider session said. Raw tool output can be
  large or sensitive. It is not a team knowledge base and is opened only with session access.
- **Run history:** queued, held, executing, interrupted, failed and drained attempts, resource
  use and links. It answers “is it cooking, did it finish, what needs recovery?”
- **Audit/action receipts:** server-recorded commands, revisions, decisions and external-effect
  outcomes. Store references/hashes and bounded metadata, not copied secrets or full documents.
- **Notes/knowledge:** intentional learning with source evidence. A bad attempt may deserve a
  note; routine tool calls do not. Recall never substitutes a narrative for canonical task state.

Owner UI provides a quiet default overview: top-level leads, work progress and items needing
the owner's attention. Expanding a lead shows all reports and accepted shared commitments;
search can find a subordinate directly. If its manager is archived, a surviving active report
appears at the visible top level until reassigned; the historical manager edge is retained.
Per-owner pins/grouping are view preferences. Open
work, pending replies, failed runs and approval cards show counts from authorized queries.

The Chief conversation receives purposeful summaries/questions, not every subordinate post.
An activity feed exposes team progress without injecting it into the conversation. Notification
delivery/read state is per viewer and does not claim the model consumed an input. Native tool
boundaries may surface bounded inbox headers, but do not execute untrusted message bodies in
an already owner-privileged run. Dedicated queued processing remains the authority.

Work detail links to its conversation chain, evidence, dependencies and relevant activity.
Memory has distinct personal/shared sections, source labels, revision history, CAS-conflict
review and explicit publish. A textually clean three-way merge is a review draft, not an
automatic semantic reconciliation. Soul changes preserve unrelated owner preferences.

Conversation links remain real availability-checked links in both desktop and mobile. A
missing transcript renders “unavailable” with the preserved run/message result, not a broken
Open button. The shared Buddy components consume canonical server projections; no second
client hierarchy, notification bus or conversation state store is introduced.

### 6.3 Retention and disclosure

Archive retains work, decisions and provenance. Export obeys the same current read policy as
UI/MCP; exporting all raw logs is not a manager privilege. An owner redaction operation removes
sensitive payload bytes and marks affected references unavailable while preserving minimal
event/action metadata needed to explain history. Never promise immutable bytes forever and
deletion of those bytes at the same time. Search results, snippets, counts, exports and error
messages must all apply authorization, not only the detail page.

Moving a document to a broader audience is a new publication/revision, with explicit source
references and disclosure permission. References are checked again when opened. Revocation
stops future reads but cannot unteach another person/model or retract an exported file. A new
restricted session and reviewed handoff are necessary after material scope changes.

### 6.4 Portable repository views without a second authority

Preserve the owner's earlier request for Git-readable profiles and memory. An explicit
`export_bundle({buddyIds, workspaceId, includeSharedNotes, destination})` owner/scoped CLI
service writes a consistent manifest, soul and permitted dense-memory Markdown views,
selected authored notes and referenced artifact metadata. It uses one read snapshot and
includes document IDs/revisions/hashes so a check can report stale or missing projections.
The destination must be an authorized directory; generated view failures are repairable.
Detailed notes are never automatically committed, and exporting does not perform `git push`.

The default portable bundle omits private transcripts, local credentials, claim tokens,
run queues, approvals, active integration bindings and operational grants. Including personal
memory is an explicit owner choice with a readable audience preview. A repository is not a
private vault simply because the app called a document personal. Optional historical work
snapshots are labeled evidence, not an imported live task authority.

`inspect_bundle({source})` is read-only validation. `import_bundle({key, source, selections})`
is an owner-authorized normal creation/update sequence: stable import keys prevent duplicate
identities, existing identities require explicit mapping and CAS, new staff consume the
applicable quota, proposed reporting links are cycle-checked, imported files remain untrusted
content, and all schedules/resources begin unbound or disabled. Never import permissions
or owner intent from a soul, manifest or old approval. This supports portability, not live
multi-machine synchronization. These export/import services are administrative capabilities,
not extra model-facing daily-work primitives.

## 7. Composing larger behavior from the atoms

The names below are example IDs, not real employees or execution instructions. Omitted keys
in the explanatory arrows still exist on every actual mutation.

### 7.1 Set up the team without a special team engine

Owner Builder: list workspaces/directory → create Project Lead with key `wave:lead` → set
the Project Lead's owner-funded quota to four via employment settings → create four leads
with distinct keys and that manager → set Product Lead quota two and GTM Lead quota one →
create Product Engineer, Designer and Researcher with their single managers → grant memberships →
publish the target-market product brief → grant Researcher collaboration on Product work.

Every step returns the persisted identity and revision. On a partial failure, list the Builder's
keyed results and resume missing steps. No duplicate staff, no automatic enablement of schedules,
no granted email permission hidden inside a soul. Existing Buddies can be attached through
owner employment operations after quota/cycle checks. A setup preview shows eight employees,
the manager tree, memberships, tool resources and initially disabled background behavior.

### 7.2 Chief → Project Lead → Product → Engineer + Designer

```text
Chief.create_work(owner=ProjectLead, workspace=wave, objective=demo business slice)
Chief.send(new ProjectLead, work=business, purpose=plan)
  ProjectLead.create_work(parent=business, owner=ProductLead, objective=validate one workflow)
  ProjectLead.send(new ProductLead, work=product, purpose=deliver)
    ProductLead.create_work(owner=Designer, parent=product, objective=critical workflow review)
    ProductLead.create_work(owner=Engineer, parent=product, objective=demo implementation,
                            requires=[accepted-design])
    ProductLead.send(Designer, work=accepted-design, purpose=review)
    ProductLead.send(Engineer, work=demo-build, purpose=implement) // held until ready
    ProductLead ends turn; its upstream request remains open
    Designer publishes evidence, marks accepted-design done, replies
    Engineer input becomes eligible; Engineer builds, publishes artifacts, replies
    Replies return to ProductLead's same logical conversation under fresh claims
    ProductLead inspects evidence, requests revisions or accepts product work, replies upstream
```

The “join” is Product Lead querying child work/replies. There is no join object or DAG runner.
An idempotent request settles once; CAS prevents simultaneous replies from accepting the same
work twice. A follow-up is another send referencing the engineer's prior request. Marking one
run complete alone cannot falsely tell Chief that the business outcome is complete.

### 7.3 Shared Market Researcher

GTM owns the researcher as an employee. GTM and Product publish questions into visible work
and send bounded requests. The researcher accepts/creates its own commitment or its manager
assigns it; Product's collaboration does not give it authority to silently reprioritize GTM's
staffing. Conflicting requests are visible in the researcher's work queue and escalated to GTM
or Project Lead. It can do multiple isolated research threads within concurrency limits.

Researcher appends sourced notes at the agreed shared work scope → writes a synthesis for
the five segments → replies to GTM and Product with the same authorized artifact. A published
finding can support both work items without duplicating an employee or leaking unrelated
personal memory. Private customer data stays in its restricted work/integration scope.

### 7.4 Frontier math → current simulator

Frontier Lead creates exploratory Work → records conjecture and failed attempts as notes →
publishes a theory report, limitations and verification artifact → asks Simulation Lead for
review → reviewer checks evidence and applicability → Frontier Lead replies with qualified
conclusions. If useful, Simulation Lead creates a separate integration Work with acceptance
criteria and a reproducible benchmark. A research note never automatically becomes a proven
fact or changes the production simulator. Product Lead decides whether the result belongs in
the current customer workflow. Rejected findings remain useful evidence without a workflow
type named “breakthrough.”

### 7.5 Prepare outreach while enforcing the demo prerequisite

GTM creates market-list and interview-draft Work, both runnable now. Product owns `accepted-demo`.
GTM creates `send-interviews` requiring `accepted-demo`, separate from drafting. Researcher
publishes prospect provenance at the permitted scope; GTM prepares an exact draft and audience.
Product reviewer accepts video artifacts with immutable byte references. GTM requests a typed
mail action; before that acceptance the service can store a draft intent but cannot queue a send.
Owner reviews the concrete recipients/body/demo/risk and decides that action. Broker rechecks
every gate and sends once or reports uncertainty. Customer responses enter through authenticated
deduplicated adapter ingestion, producing an informational message for GTM in its permitted
thread. GTM records findings and asks Product to reconsider priorities.

Changing a video, revoking its acceptance, pausing the outreach project, expiring the action or
removing the integration grant before dispatch holds/rejects the send. Drafting remains useful.
This is a reusable prerequisite + external intent, not an email-specific project state machine.

### 7.6 Recurring Chief wakeups in the current conversation

Chief drafts a schedule targeting the current conversation: “Read open requests, work changes
and failed runs; steer only when action is needed.” Owner enables it with a bounded allowance.
Each due tick creates one new run in that thread, behind any active user/provider turn. The
tick reads current state rather than trusting last week's context. It can send follow-ups,
write a note if something changed, or finish with no message to the owner.

Replies already wake their requester. Therefore frequent polling is optional; the recurring
check catches stalled/open work and work that changed outside the request chain. During long
server downtime, one catch-up tick is enough. Same-thread continuity does not mean a process
stays alive forever or that a sleeping laptop executes jobs. Remote continuous operation needs
an always-on server using the same queue, not a second cloud scheduling model.

### 7.7 Solo continuation, approval, stop and replacement

A Buddy doing extended research records progress in Work, appends any useful attempt note,
then self-sends a delayed informational continuation. Success releases it; crash holds it.
If a decision needs the owner, send an ordinary question and end the turn. A subsequent owner
reply queues a fresh restricted input; it does not resurrect the old process. Executable mail
approval uses ActionIntent instead of interpreting the reply's purpose string.

Owner pauses the business project → every attached descendant/root is fenced and drained →
queued requests remain inspectable → owner transfers one project to a replacement lead →
shared evidence/open obligations are reissued under the new owner → explicit recovery handles
interrupted effects → retirement preserves the old employee's history. Unrelated work and
explicitly owned child identities are not silently reassigned.

## 8. Implementation mapping and migration

This is an incremental design, but the scope is larger than “add three columns.” Keep exactly
one writer for each fact throughout the transition. Do not roll schema-22 data back to an old
archive or overwrite the paused implementation with an earlier worktree.

| Current location/shape | Proposed treatment |
|---|---|
| Package Buddy/workspace/membership/relationship tables | Preserve IDs; migrate one-manager edge into a canonical keyed employment relation; add bounded collaboration/access rows |
| owned_projects + buddy_todos | Preserve external IDs; introduce a Work mapping; promote independently owned/gated todos; add prerequisite edges; maintain legacy projection during client transition |
| buddy_messages plus legacy delegation/review adapters | Keep generic request/final reply truth; migrate references and remove legacy writers only after historical active runs drain |
| Prototype buddy_runs and automation run tables | Keep historical IDs/attempt evidence; normalize new admissions through one executor; archive old sequence/loop semantics as compatibility history |
| Automation prompt/sequence/loop definitions | New definitions are repeated inputs; simple sequences/loops become model decisions plus self-send; do not silently change an active legacy job's termination behavior |
| Memory revisions/heads and filesystem notes | Preserve revision ledger and hashes; classify legacy notes workspace-shared; introduce scoped personal docs and explicit knowledge publication without dumping global memory into every workspace |
| Conversation links/config/provider sessions | Preserve user-facing threads and server binding; introduce access-domain invalidation and per-run context revisions at the existing runtime seam |
| Approval records | Keep historical approvals read-only; only explicit typed action intents authorize registered effects; old prose approval does not become a mail grant |
| Audit/overview/inbox | Reuse filtered projections; preserve archived-person historical references instead of recursively removing whole historical records |
| API/MCP/Builder | Shared schemas/service contracts; strict per-input authority; temporary compatibility adapters; no `Record<string, unknown>` as the final domain API |
| Desktop/mobile Buddy UI | Shared components, routes and availability checks; owner view preferences separate from employment/access |

Stages for an eventual implementation decision:

1. Reconcile a reproducible source/package baseline, test existing invariants and snapshot
   migration fixtures. Keep the currently paused implementation's history intact.
2. Ship explicit read projections, stable identity keys, typed contracts and visibility tests.
3. Converge request/reply/chat/schedule admissions on one fenced executor. Do not introduce
   new scope-sharing while old owner/background authority is ambiguous.
4. Add scoped knowledge, publication and session invalidation. Migrate old notes without
   changing who could already read them; make uncertain provenance visible to the owner.
5. Add work prerequisites and external action broker with a deterministic mail fixture.
   Add the real inbox only after deployment resource and authority choices are resolved.
6. Complete owner visibility/controls and a small authorized live-team evaluation. Enable
   recurring work deliberately after measuring redundant wakeups and management quality.

Rollback of a UI release may retain read compatibility; never downgrade a migrated database.
Before cutover, backup/restore fixtures must prove IDs, requests, memory revisions, archived
staff and receipts survive. Markdown export failures remain repairable projection failures.

## 9. Acceptance scenarios and design pressure tests

Prefer a few scenario families through a real temporary store, private control service,
Conversation runtime, deterministic provider and fake integration adapter. The matrix names
observable behavior, not one test per field or source-text assertions.

| Scenario | Required evidence |
|---|---|
| Replayed eight-person Builder setup | Eight stable identities, one manager each, quota accounting, partial retry no duplicates; backgrounds remain disabled |
| Chief across two workspaces | Authorized work rollup succeeds; unrelated memory/transcript reads and dispatch without membership fail |
| Multi-level delegation and review | Lead ends while request open; later replies/revisions reach correct existing threads; final evidence reaches Chief |
| Shared researcher | One employee, competing commitments visible, collaboration does not grant reparent/hiring/private-memory rights |
| No demo / fake demo / changed demo | Drafting succeeds; no broker send until exact accepted available artifacts and action authority are valid |
| Mail acknowledgement lost | One attempted effect, visible unknown result, reconciliation/manual decision; no automatic duplicate send |
| Customer reply replay/injection | Duplicate inbound ID creates one input; body cannot alter authority, routing grant or soul |
| Recurring busy-thread wake | No concurrent provider runs, at most one catch-up occurrence, bounded fairness and current state on wake |
| Concurrent memory/soul edits | One CAS winner, other draft preserved with current revision; no task tracker copied into dense memory |
| Workspace/access change | Restricted new provider context; revoked documents cannot be fetched, searched, counted or exported |
| Stop during creation/tool/end event | Immediate fenced tools, eventual joined drain, no stale writes and no premature slot release |
| Pause/reopen prerequisite | No dependent new start; active dependent fenced on invalidation; irreversible prior effects remain visible |
| Transfer and retire with open work | Durable drain, reissued obligations, unchanged child owners, preserved old history and restricted sessions |
| Missing/deleted conversation | Stored result visible, honest unavailable link, explicit scoped repair; no silent lost wakeup |
| Failure after input commit | Accepted input remains; retry only when safe; idempotency keys prevent duplicate request and final reply |
| Rate cap or sleeping server | Held reason/catch-up visible; interactive owner inspection works; no claim that offline time executed work |
| Quiet owner experience | Team feed records activity; only purposeful escalation/digest reaches primary chat; hidden reports remain searchable |
| Historical migration | Old messages, owners, replies, notes and revisions remain readable under their original disclosure scope |
| Detailed notes / transcript cleanup | Long reports retain authorized original bytes and source references; transcript deletion leaves knowledge intact |
| Optional capture | At most one phase per source interval, bounded original budget, no recursive capture, CAS-safe writes, failure separate from work |
| Git export/import | Consistent readable revisions, no credentials/grants/active execution; scoped import replay creates no duplicate staff |

Mechanical correctness does not guarantee that a Frontier Lead discovers new math, the designer
chooses a good product, or GTM finds customers. Evaluate those behaviors separately using the
reference scenario: evidence quality, scope discipline, unnecessary messages, stuck obligations,
repeated work and useful owner decisions. No stored “complete” value proves business success.

## 10. Comparison, limits and recommendation

| Decision | 1. Typed resources | 2. Event ledger | 3. Shared spaces |
|---|---|---|---|
| Durable authority | Current typed rows + immutable document revisions/receipts | Typed event stream + deterministic projections | Scoped collaboration objects/posts and work state |
| Collaboration center | Addressed request with return route | Domain event/command causality | Shared work/thread and explicit attention |
| Strongest fit | Existing app and Chief→lead→employee chains | Rebuildable history and complex provenance inspection | Several peers sharing work/knowledge visibly |
| Cost most likely to grow | Access policy spread and compatibility adapters | Event versions, replay, projection consistency and redaction | Space membership, cross-space publication and attention rules |
| What to borrow | — | Causality IDs and audit discipline | Explicit shared knowledge scope and quiet collaborative feed |
| What not to combine | Do not add event sourcing and rooms just to avoid choosing | Do not duplicate row and event authority | Do not recreate a hidden message engine alongside every shared thread |

Recommendation: use **typed resources** as the base for this repository, keep the existing
send/reply contract, and add explicit knowledge scope plus a narrow external-action boundary.
This changes the fewest durable authorities while filling the real holes in the business-team
example. Borrow the other proposals' lessons without implementing all three architectures.

The new hard requirements are scoped knowledge/publication, shared employee collaboration,
queryable work prerequisites, inspectable quiet team activity, and brokered external actions.
The old coordination proposal deliberately excluded some of these; that was a scope limit,
not proof they were unnecessary. Recurring wakeups and subordinate conversations already have
a useful proposed execution foundation; a full business team needs the additional boundaries.

Not included as hidden promises: multi-human tenant privacy, guaranteed scientific discovery,
arbitrary provider-native live steering, transparent crash replay, measured dollar budgets,
distributed multi-host scheduling, and adversarial OS containment in the current local setup.
They either require a separate deployment capability or are outcomes software cannot promise.

This is ready for **architecture selection and a concrete implementation plan**, not a claim
that an implementation is complete or production-ready. Owner-visible privacy defaults are
proposed here (owner can inspect, employees need scope); the real inbox/provider, accepted-demo
reviewer, standing-vs-per-action outreach authority and process-isolation deployment remain
configuration decisions before enabling external execution. No real outreach is pending.

## 11. Source review coverage

Review date: 2026-09-09. This is a source appendix for three new whole-Buddy alternatives, not permission to resume the paused implementation. Historical notes and transcripts are evidence, not current instructions or authority.

### Coverage and limits

The review inventoried every matching Buddy/memory/soul/automation/direct-report/primitives Markdown document under `product/buddies/` and `agent_notes/`, read the living contracts and the decision/review sections of historical records, and located the earlier three design briefs in their original isolated worktree. Historical test/release counts were treated as dated evidence, not a present readiness claim. Build/runtime source review belongs to the main alternatives.

Read-only application conversation sidecars identified 22 relevant conversation records: 21 for Buddies Development Lead and the July Growth Lead proof. Of 21 records with provider-session bindings, 19 exact parent transcripts were present in the provider paths used by the repository adapters. Two old bound transcripts were missing from the searched current session roots (July Growth Lead; August 19 original Muse direct-report thread), and one record had no session binding. The August direct-report conversation is also quoted in a surviving fork, and July Growth Lead evidence is extensively recorded in the July design/audit notes. No live Buddy database was read or edited. No generic native conversation-search tool was available. This is a comprehensive review of located design records plus bounded conversation excerpts, not a claim to have found every historical chat ever created.

The extraction read only visible/user message structures and excluded provider reasoning/tool blobs, injected Buddy context, and subordinate session files. It found 140 user-role text records across the 19 parents; that set includes quoted forks and harness notification records, so it must not be described as 140 independent owner instructions. User-authored relevant messages were reviewed and separated from those artifacts. A provider-side `session_index.jsonl` was also checked but had inadequate historical Buddy coverage; exact app sidecar bindings were used instead. Paths were selected by stored session IDs, not decoded by replacing hyphens in lossy provider folder names.

### Requirement evidence that must survive all alternatives

| Requirement | Primary evidence | Implication |
|---|---|---|
| Ordinary conversations with accountable employees; user should not manually synchronize task state | July 28 retrospective / real-team redesign | One conversation runtime, native scoped tools, compact state views, evidence-backed closure |
| Chief knows authorized organization, delegates to leads/engineers, gets results in original thread | Chief conversation `7d9d117f-7a13-46e2-bf6a-95da591d6e2b` (Sept 9) | Discovery + scoped reads + durable addressed inputs + return route + fresh run authority |
| Small composable operations over reusable shapes, no hardcoded review type | Aug 21 primitives note; owner messages in `fe2e989b-c3fb-466b-9daf-95dbb9e489a0` and `b7735aa6-fe36-4a18-8d28-2a675ba1f099` | Open business-purpose labels; closed mechanical state machines; distinguish less naming from less actual complexity |
| Shared tasks and task-to-task references | `3ae36731-0f88-407e-8b10-11c19f448101`, Aug 19, user messages near transcript lines 596–624 | One accountable owner plus collaborators/readers; parent/reference/dependency semantics must be explicit, not several active task stores |
| Persistent reports hidden from main directory, visible under manager | Original `2429d826-0cd4-4f1f-ae4f-cc968edb5f5f` quoted in surviving `bb79c16e-4579-4523-9720-d90f9d72076b`; living direct-report contract | Display hierarchy is distinct from read authority; one persistent Buddy type with one canonical manager |
| Temporary task reviewers as ordinary harness subagents | `e61026c8-7c5e-41ce-ab5a-04a2485c2aaa`, Aug 20, near line 402; primitives contract | No third intermediate Buddy lifetime; provider capability may fan out within its own bounded run |
| Own working and long-term memory, detailed shared notes | `b7735aa6-fe36-4a18-8d28-2a675ba1f099`, Aug 20–22; `c884e6fc-a16b-411d-ac70-736a2b906adb`, Aug 22 | Keep working hypotheses/attempts/preferences distinct from current task fields; long-term is per Buddy |
| Notes retain detailed attempts, failures, exploration; no automatic note injection | Aug memory thread; Sept 9 `6978deed-b96f-48d0-94a6-2e338498ee08` near line 109 | Rich authored evidence journal is neither short dense memory nor immutable runtime audit; preserve useful detail without requiring raw reasoning dumps |
| Capture considered after each turn / cheap model; collision and noise concerns | Aug memory thread near lines 541/567; Sept 9 memory thread | Explicitly compare same-turn capture, optional queued capture and cadence. Current system does not run a universal per-turn background memory model. If proposed, specify source interval, dedupe, policy, batching, CAS, failure, recursion and budget |
| Memory survives frequent transcript cleanup | Aug memory thread near line 248; memory design G6 | No permanent dependence on native session files for authoritative knowledge or business results |
| Soul evolves on explicit user request, retains prior revisions and reasoning | Aug memory thread near lines 111/157; Sept 8 identity review | Preserve owner-requested direct-chat editing; don't reintroduce obsolete blanket prohibition on soul MCP. Soul cannot grant application permissions |
| Buddy definitions/current readable memory should live in repos and be shareable through Git | `91283c6e-4cd3-48c4-98c5-0004b03deb32`, Sept 7, near line 3719; owner accepted export consistency check at 4111 | Repo export/import must distinguish portable profile/evidence from local runtime identity/claims/grants; current acceptance was readable views + export check, not authenticated distributed sync |
| Active chat notices show sender/subject/message ID at sensible boundaries, continue unless relevant/urgent | `4ca1521f-99a3-4c47-9df5-9104cb27d38f`, Sept 8 | Notification is a lossy nudge over a durable message; handoff receipt is not read acknowledgment; avoid injecting arbitrary tool output or interrupting unrelated work |
| One Builder conversation can create a whole team | `4feb6c5d-32b9-4f4f-aae0-1a7f44c19538`, Sept 8 | Multiple idempotent creations, result recovery, manager/quota setup as explicit structural operations; no synthetic permanent Builder employee |
| Creation/update results inline, hidden setup stays hidden | `2a05de29-57f7-4a35-aa9e-a9fa29f8fc77`, `70e2e12e-39c9-4396-8c6d-9fb3ef9d4615`, Sept 8 | Typed durable events/cards, no magic result markers as authority, no briefing dump in chat |
| True routes/links; old threads remain findable; archived/deleted distinction | `57693f00-f9b1-480a-b3b2-3862b3ed1546`, Aug 20; AGENTS.md | Both shells share domain projections and navigation semantics; availability-checked thread links; archive preserves records without dead navigation |
| Wave_sim business team, shared market researcher, demo-gated outreach and research-to-simulator handoff | Current user message | Broadens design to collaboration/visibility/artifacts/external adapters, beyond prior pairwise coordination |

### Current contract versus superseded claims

1. July's typed delegation/review/approval mailbox and explicit prohibition on generic messages are historical. August 21 owner rejected growing review/approval type enums; September 8 living contract exposes generic `send`/`reply` with open purposes/outcomes. Preserve the lesson (inbox is a derived actionable query), not the old category tables.
2. The earlier memory review's “Buddy MCP must never write soul” was superseded by September 8 owner-requested direct-chat soul editing. Keep CAS and restricted-context denial; do not confuse a soul tool's existence with permission to follow changes requested by other Buddies or recalled text.
3. `memory/MEMORY.md` plus daily journal/compaction is the legacy design. Current two dense documents use SQLite revisions; `agent_notes/` is detailed append-only evidence; `remember`/`compact_memory` are removed for new operation flows.
4. The memory review correctly rejects task fields copied into working memory. The owner explicitly retained WORKING_MEMORY for cognitive context after that review; deleting it because current tasks are already available would repeat an already-corrected mistake.
5. August assertions that direct-report hiring, memory paths, generic wait or particular MCP providers are absent are dated checkpoint observations. September living contracts and source take precedence for present capabilities.
6. Old direct-report plans rendered archived reports dimmed and accessible. Current September 8 contract says public projections hide archives, detail URLs 404, and surviving reports of an archived manager appear top level. A redesign must consciously decide history/restore access instead of inheriting both contradictory UIs.
7. A normal model turn ending is not a request reply, work completion, acceptance, or conversation deletion. This failure recurred from July through the first September alternatives. Do not derive those states from provider success.
8. Old lease takeover suggestions were replaced by August 24 single-owner/no-ambiguous-adoption. Queue retry after uncertain side effects remains explicit. A durable pending input may be retried safely before execution; an expired running lease is not proof the old process died.
9. Budget fields are not budget enforcement. Current contracts enforce time/iterations and scoped operations; token/cost storage is compatibility intent without uniform metering. Headcount quotas and run limits are separate.
10. Role/soul/notes/repository instructions describe desired behavior, not authorization. Models run as the local owner user; app-level policies are not OS isolation. Sharing a folder cannot honestly promise confidential employees or constrained email credentials.
11. July/September implementation notes report specific tested snapshots. The September 9 handoff explicitly says app changes remain mixed/uncommitted; current installed package is schema22 while package worktree has further dirty changes. Do not label all prototype code released or use yesterday's test counts as today's proof.
12. Per-turn automatic note/memory capture remains a design question, not an already-implemented universal feature. Current successful eligible automation capture uses remaining existing budget; ordinary conversations use selective same-turn instructions.

### Earlier three briefs and what their review already learned

All three exist in `/Users/nicholasbardy/git/.codex-worktrees/unleashd/20260909T051209Z-74323/product/buddies/`:

| File | Core scheduling address | Useful property | Cost / corrected defect |
|---|---|---|---|
| `DESIGN_BRIEF_01_CONVERSATION_CONTINUATIONS.md` | Conversation | Smallest migration; parallel independent chats for a Buddy | Adds separate Continuation+Run; explicit routing needed; no-reply failure overclaim |
| `DESIGN_BRIEF_02_BUDDY_INBOXES.md` | Buddy within Exchange | One durable attention path per employee | Whole-Buddy serialization blocks other owner chats; Exchange+Envelope+Delivery+Run is not automatically minimal; no-reply failure overclaim |
| `DESIGN_BRIEF_03_DURABLE_WORK.md` | Work and responsible participant | Accountable assignee/progress; structured parent result flow | Casual questions forced into work; attention and participation rules; single-work lock constrains collaboration; original cross-workspace parents excluded |

The Chief transcript's review explicitly found that all three treated healthy turn completion without final reply as failure, preventing a lead from delegating, ending its turn and answering later. Consolidation removed a separate Exchange, used conversation IDs as bindings, made inbox a query, and serialized per conversation. The current `DESIGN_BUDDY_COORDINATION.md` additionally specifies queued runs, self-send continuations, project gates, ownership transfer, cross-workspace parents and scoped approvals. The three new alternatives should preserve these lessons and present materially different bases, not rename the same queue objects three times.

### Whole-system gaps the new sample exposes

- **Four visibility axes:** top-level directory placement; owner notification preference; team read/disclosure access; execution/action capability. A hidden report is not a secret employee. A supervisor's need to know progress does not imply full transcript or private memory access.
- **One manager, many collaborators:** Market Research can be one persistent employee managed by GTM but shared through project participation or explicit capability. A second manager should not be necessary to share its output. An ephemeral helper has no independent long-term identity/memory; expose that difference clearly in Builder language.
- **Team knowledge without memory flattening:** Product and GTM share market targets and interview facts; Research and Simulator share candidate math evidence. A shared authoritative brief/artifact with scoped references is different from copying one employee's private cognition into all souls.
- **Stable artifact identity:** a demo path existing today is weak evidence; policy gates need an approved immutable version/hash or explicit accepted artifact reference. A theoretical research result needs assumptions, derivation, validity range, counterexamples, benchmark/reproduction criteria, and an acceptance decision before simulation implementation.
- **Demo prerequisite is not send authorization:** gate scheduling/delegation separately from external mail capability and owner-approved recipients/content/campaign bounds. With raw same-UID shell access, don't claim a hard external send guarantee. If mandatory enforcement is promised, define a controlled adapter and its containment assumptions.
- **Shared inbox adapter:** select and authorize a real integration later; the sample mentions an unspecified folder under `~/git/`. Model messages are not emails. Need inbound identity/provenance, idempotency/dedupe, external thread/message IDs, outbound draft/approval/send result, attachment permissions and ambiguous-send recovery. No actual mailbox setup or email is requested in this design task.
- **Priority is not authority:** “urgent” can influence attention ordering, not bypass quotas/visibility/cancellation or preempt through an unsupported provider API. Bound starvation/floods/coalescing.
- **Long-lived threads:** fresh run grants and current work reads coexist with historical transcript context. State explicitly how an old memory snapshot is refreshed or fetched; do not silently append conflicting instructions.
- **Audit versus notes versus transcript:** machine audit records mutations/run transitions and trusted actor/provenance; authored notes preserve long-form evidence/attempts; dense memory selects useful knowledge; transcript holds discussion and native execution logs. Retention/deletion/export/search need separate policies per layer and clear links.
- **Owner oversight:** compact portfolio/activity/action-needed views should permit drilldown into evidence and authorized transcript details without spraying every tool log into the top-level chat. Read/handled/replied/accepted states have different meanings.
- **Imported/exported teams:** local grant authority, scheduler activation and credentials must not be created from repository prose or imported profiles. A read-only portable snapshot is not live state replication. Define archive and restore history as deliberate operations.
- **Acceptance:** test mechanical boundary reliability and evaluate live model behavior separately. The repeated historical failure is declaring design/implementation “done” from components existing while delivery, authorization, lifecycle and product closure disagree.

### Corpus inventory

- [2026-07-28_buddies-canonical-work-and-overview-proof.md](../../agent_notes/2026-07-28_buddies-canonical-work-and-overview-proof.md) — Buddies Canonical Work and Overview Proof.
- [2026-07-28_buddies-completion-audit-and-forward-plan.md](../../agent_notes/2026-07-28_buddies-completion-audit-and-forward-plan.md) — Buddies control plane — completion audit and forward plan.
- [2026-07-28_buddies-hardening-and-release-proof.md](../../agent_notes/2026-07-28_buddies-hardening-and-release-proof.md) — Buddies Hardening and Release Proof.
- [2026-07-28_buddies-implementation-program.md](../../agent_notes/2026-07-28_buddies-implementation-program.md) — Buddies Implementation Program.
- [2026-07-28_buddies-post-audit-closure-plan.md](../../agent_notes/2026-07-28_buddies-post-audit-closure-plan.md) — Buddies Post-Audit Closure Plan.
- [2026-07-28_buddies-real-team-control-plane-redesign.md](../../agent_notes/2026-07-28_buddies-real-team-control-plane-redesign.md) — Buddies Real-Team Control Plane Redesign.
- [2026-07-28_buddies-retrospective-and-gap-audit.md](../../agent_notes/2026-07-28_buddies-retrospective-and-gap-audit.md) — Buddies Retrospective and Gap Audit.
- [2026-07-28_buddies-scoped-operations-proof.md](../../agent_notes/2026-07-28_buddies-scoped-operations-proof.md) — Buddies Scoped Operations Proof.
- [2026-07-28_buddies-second-pass-quality-plan.md](../../agent_notes/2026-07-28_buddies-second-pass-quality-plan.md) — Buddies Second-Pass Quality Plan.
- [2026-07-28_buddies-server-refactor-coordination.md](../../agent_notes/2026-07-28_buddies-server-refactor-coordination.md) — Buddies / `server.ts` Refactor Coordination.
- [2026-07-29_buddies-design-review.md](../../agent_notes/2026-07-29_buddies-design-review.md) — Buddies design review — fresh-eyes audit.
- [2026-07-29_buddy-profiles-and-safe-backend-reload.md](../../agent_notes/2026-07-29_buddy-profiles-and-safe-backend-reload.md) — Buddy profiles and active-turn-safe backend reload.
- [2026-07-29_buddy-ui-memory-and-automation-proof.md](../../agent_notes/2026-07-29_buddy-ui-memory-and-automation-proof.md) — Buddy UI, memory, and automation proof — 2026-07-29.
- [2026-07-29_conversational-buddy-builder.md](../../agent_notes/2026-07-29_conversational-buddy-builder.md) — Conversational Buddy Builder.
- [2026-08-19_sub-buddies-design.md](../../agent_notes/2026-08-19_sub-buddies-design.md) — 2026-08-19 Direct Reports (Sub-Buddies) — Implementation Spec.
- [2026-08-20_buddies-sprint-handoff.md](../../agent_notes/2026-08-20_buddies-sprint-handoff.md) — Sprint Handoff — Direct Reports (Sub-Buddies).
- [2026-08-20_buddy-mcp-harness-boundary.md](../../agent_notes/2026-08-20_buddy-mcp-harness-boundary.md) — Buddy MCP: move harness encoding into agent-cli.
- [2026-08-20_direct-reports-handoff.md](../../agent_notes/2026-08-20_direct-reports-handoff.md) — HANDOFF — Direct Reports (Sub-Buddies) — Unleashd.
- [2026-08-20_direct-reports-plan-before-simplification.md](../../agent_notes/2026-08-20_direct-reports-plan-before-simplification.md) — PLANNING_SUB_BUDDIES.md — Direct Reports (Sub-Buddies).
- [2026-08-21_buddies-sprint-board.md](../../agent_notes/2026-08-21_buddies-sprint-board.md) — Sprint Board — 2026-08-21 — product / design / engineering.
- [2026-08-21_buddy-automations-reference.md](../../agent_notes/2026-08-21_buddy-automations-reference.md) — Buddy automations — the system as actually built.
- [2026-08-21_memory-architecture-research_buddies-development-lead.md](../../agent_notes/2026-08-21_memory-architecture-research_buddies-development-lead.md) — Buddy memory: as-built audit, measured evidence, and external comparison.
- [2026-08-21_memory-design-handoff.md](../../agent_notes/2026-08-21_memory-design-handoff.md) — HANDOFF_MEMORY.md — Buddy memory design, for review.
- [2026-08-21_primitives-and-the-wait-design.md](../../agent_notes/2026-08-21_primitives-and-the-wait-design.md) — Design: minimal primitives, and the one missing wait.
- [2026-08-21_primitives-design-before-simplification.md](../../agent_notes/2026-08-21_primitives-design-before-simplification.md) — PLANNING_BUDDY_PRIMITIVES.md — minimal primitives for Buddy coordination.
- [2026-08-21_rtk-diff-is-not-a-patch_buddies-development-lead.md](../../agent_notes/2026-08-21_rtk-diff-is-not-a-patch_buddies-development-lead.md) — `git diff > x.patch` produces an unappliable file in this repo.
- [2026-08-22_memory-design-before-simplification.md](../../agent_notes/2026-08-22_memory-design-before-simplification.md) — PLANNING_MEMORY.md — Buddy memory: two primitives, four layers, three verbs.
- [2026-08-22_memory-design-review.md](../../agent_notes/2026-08-22_memory-design-review.md) — Buddy memory architecture — pre-implementation review.
- [2026-08-22_memory-implementation-handoff_buddies-development-lead.md](../../agent_notes/2026-08-22_memory-implementation-handoff_buddies-development-lead.md) — Handoff to the memory implementation.
- [2026-08-24_automation-execution-ownership-design.md](../../agent_notes/2026-08-24_automation-execution-ownership-design.md) — Automation execution ownership — one owner, expiring authority, honest recovery.
- [2026-09-08_auto-youtube-buddy-handoff.md](../../agent_notes/2026-09-08_auto-youtube-buddy-handoff.md) — Buddy Handoff — auto_youtube video pipeline (Sep 8, 2026).
- [2026-09-08_buddies-simplification-implementation.md](../../agent_notes/2026-09-08_buddies-simplification-implementation.md) — Buddies simplification implementation.
- [2026-09-08_buddy-identity-soul-review.md](../../agent_notes/2026-09-08_buddy-identity-soul-review.md) — Buddy identity and soul editing review — 2026-09-08.
- [2026-09-09_buddies-integration-handoff.md](../../agent_notes/2026-09-09_buddies-integration-handoff.md) — Buddies integration handoff.
- [2026-09-09_soul-conflict-design.md](../../agent_notes/2026-09-09_soul-conflict-design.md) — Soul edit conflicts: decision and implementation plan.
- [20260906T150956Z_01M1VM9PG6M2JQYRRWJ5VFN2QR_memory-v2-has-zero-buddy-writes_builder-878fecca0a2ba9fe_fe6ef8cd.md](../../agent_notes/20260906T150956Z_01M1VM9PG6M2JQYRRWJ5VFN2QR_memory-v2-has-zero-buddy-writes_builder-878fecca0a2ba9fe_fe6ef8cd.md) — 20260906T150956Z_01M1VM9PG6M2JQYRRWJ5VFN2QR_memory-v2-has-zero-buddy-writes_builder-878fecca0a2ba9fe_fe6ef8cd.md.
- [20260908T044726Z_01M1ZNFA8PH0ZTZMBWEC4SZ70W_multi-buddy-builder_buddies-development-lead_fe6ef8cd.md](../../agent_notes/20260908T044726Z_01M1ZNFA8PH0ZTZMBWEC4SZ70W_multi-buddy-builder_buddies-development-lead_fe6ef8cd.md) — 20260908T044726Z_01M1ZNFA8PH0ZTZMBWEC4SZ70W_multi-buddy-builder_buddies-development-lead_fe6ef8cd.md.
- [20260908T045036Z_01M1ZNN46K6VP0VN9G4JM6RKXG_codex-setup-messages-hid-buddy-briefings_builder-878fecca0a2ba9fe_fe6ef8cd.md](../../agent_notes/20260908T045036Z_01M1ZNN46K6VP0VN9G4JM6RKXG_codex-setup-messages-hid-buddy-briefings_builder-878fecca0a2ba9fe_fe6ef8cd.md) — 20260908T045036Z_01M1ZNN46K6VP0VN9G4JM6RKXG_codex-setup-messages-hid-buddy-briefings_builder-878fecca0a2ba9fe_fe6ef8cd.md.
- [20260908T080157Z_01M200KG6974SNBM71TPRYBWWB_inline-buddy-builder-results_buddies-development-lead_fe6ef8cd.md](../../agent_notes/20260908T080157Z_01M200KG6974SNBM71TPRYBWWB_inline-buddy-builder-results_buddies-development-lead_fe6ef8cd.md) — 20260908T080157Z_01M200KG6974SNBM71TPRYBWWB_inline-buddy-builder-results_buddies-development-lead_fe6ef8cd.md.
- [20260909T060112Z_01M22C33VHM2CX59JCEPD2XJS8_message-notification-boundaries_buddies-development-lead_fe6ef8cd.md](../../agent_notes/20260909T060112Z_01M22C33VHM2CX59JCEPD2XJS8_message-notification-boundaries_buddies-development-lead_fe6ef8cd.md) — 20260909T060112Z_01M22C33VHM2CX59JCEPD2XJS8_message-notification-boundaries_buddies-development-lead_fe6ef8cd.md.
- [AUTOMATION_OWNERSHIP.md](AUTOMATION_OWNERSHIP.md) — Automation execution ownership.
- [DESIGN_BUDDY_COORDINATION.md](DESIGN_BUDDY_COORDINATION.md) — Buddy coordination: composable primitives and implementation contract.
- [PLANNING_MEMORY.md](PLANNING_MEMORY.md) — Buddy memory.
- [PLANNING_PRIMITIVES.md](PLANNING_PRIMITIVES.md) — Buddy coordination primitives.
- [PLANNING_SUB_BUDDIES.md](PLANNING_SUB_BUDDIES.md) — Direct reports.

### Located parent conversations

- `bb79c16e-4579-4523-9720-d90f9d72076b` — 2026-08-19, 2 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/d682b842-fcba-48fe-9634-c7b9d4f7a52c.jsonl`.
- `3ae36731-0f88-407e-8b10-11c19f448101` — 2026-08-19, 29 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/ab4e58e5-6f50-4ce7-a144-1141ce6c9bdf.jsonl`.
- `385c1c9a-3c3b-4881-a52c-2fedaf835935` — 2026-08-20, 1 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/7ab87f00-22a5-469b-b50c-89198a8939a8.jsonl`.
- `57693f00-f9b1-480a-b3b2-3862b3ed1546` — 2026-08-20, 6 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/fe83179b-8bd6-4457-940d-d6b391b60d66.jsonl`.
- `e61026c8-7c5e-41ce-ab5a-04a2485c2aaa` — 2026-08-20, 13 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/56a36661-ab79-4b5c-b9b0-dfead85fc2fc.jsonl`.
- `b7735aa6-fe36-4a18-8d28-2a675ba1f099` — 2026-08-20, 20 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/17e7c2e7-b017-4503-927a-e8003114655d.jsonl`.
- `fe2e989b-c3fb-466b-9daf-95dbb9e489a0` — 2026-08-20, 5 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/ed2d18f8-fb7d-4334-b2d9-cb34453f5ebc.jsonl`.
- `c884e6fc-a16b-411d-ac70-736a2b906adb` — 2026-08-22, 5 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/08/22/rollout-2026-08-22T16-25-13-01a0285c-01ec-78c3-b3ca-8f00d2fd3392.jsonl`.
- `f5373c97-35db-4c67-a14e-f28e4afe120b` — 2026-08-28, 18 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/08/28/rollout-2026-08-28T13-20-21-01a04698-e7d2-7902-b6f4-bb011af75bec.jsonl`.
- `44c9a8ab-4416-4858-b054-c581e2c738fe` — 2026-09-06, 2 extracted user-role text records; source `/Users/nicholasbardy/.claude/projects/-Users-nicholasbardy-git-unleashd/921e4d97-09c9-4e9e-bad2-9a6af5983da7.jsonl`.
- `3d1151cf-8547-42df-9bc1-472b28df682c` — 2026-09-07, 2 extracted user-role text records; source `/Users/nicholasbardy/.local/share/muse/sessions/2026/09/07/01a07b8a-58cf-7983-a6b0-d50b1522e7c4/session.jsonl`.
- `91283c6e-4cd3-48c4-98c5-0004b03deb32` — 2026-09-07, 5 extracted user-role text records; source `/Users/nicholasbardy/.local/share/muse/sessions/2026/09/07/01a07b95-660a-72d1-b6e6-d47670a992c0/session.jsonl`.
- `93d42b4f-e283-4852-b9b1-4d13bbf85740` — 2026-09-08, 3 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/08/rollout-2026-09-08T12-04-02-01a07f2f-ebff-74f0-89b0-295d1c5109f0.jsonl`.
- `4ca1521f-99a3-4c47-9df5-9104cb27d38f` — 2026-09-08, 8 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/08/rollout-2026-09-08T12-17-59-01a07f3c-b0f3-7930-9184-664ff0999364.jsonl`.
- `4feb6c5d-32b9-4f4f-aae0-1a7f44c19538` — 2026-09-08, 3 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/08/rollout-2026-09-08T12-27-48-01a07f45-ad51-76d1-b6e6-df441dbfa1d1.jsonl`.
- `70e2e12e-39c9-4396-8c6d-9fb3ef9d4615` — 2026-09-08, 3 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/08/rollout-2026-09-08T12-43-53-01a07f54-68d4-7d91-8719-637043edec04.jsonl`.
- `2a05de29-57f7-4a35-aa9e-a9fa29f8fc77` — 2026-09-08, 3 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/08/rollout-2026-09-08T15-21-04-01a07fe4-51f3-7871-9ce9-6a189c8b4707.jsonl`.
- `7d9d117f-7a13-46e2-bf6a-95da591d6e2b` — 2026-09-09, 9 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/09/rollout-2026-09-09T12-46-14-01a0847c-ed91-75e2-85fb-6a57cdc8bd54.jsonl`.
- `6978deed-b96f-48d0-94a6-2e338498ee08` — 2026-09-09, 3 extracted user-role text records; source `/Users/nicholasbardy/.codex/sessions/2026/09/09/rollout-2026-09-09T15-27-55-01a08510-f374-74f2-bd5a-81c51dfaf710.jsonl`.
