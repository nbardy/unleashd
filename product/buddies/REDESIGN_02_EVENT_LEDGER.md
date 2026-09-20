# Buddy redesign 02: a typed event ledger

> Historical alternative, not a delivery claim. The September 9 owner correction removed
> hiring quotas; requested working teams enable the background capability without starting
> runs. See the [September 10 system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md) for the
> accepted core, implemented API and remaining gaps. Earlier recipes below are retained
> as decision history where they differ.

2026-09-09 · Comparison proposal · Design only; not selected or implemented

This alternative makes the history of accepted domain changes the durable authority. Current
work, the inbox, memory heads, team charts, and activity feeds are deterministic views of that
history. Models still call ordinary typed operations. They cannot append arbitrary events.

Its strongest property is explainability: the owner can trace an assignment, a change of
belief, or an email decision back to the exact authorized inputs and evidence. Its cost is
substantial: replay, event compatibility, payload retention, and projection correctness become
permanent engineering responsibilities. Fewer authoritative storage mechanisms do not mean
fewer domain rules. Choose this direction only if historical reconstruction is a core product
requirement, not merely because an event log looks like a small schema.

The companion proposals are [typed relational resources](REDESIGN_01_TYPED_RESOURCES.md) and
[shared collaboration spaces](REDESIGN_03_SHARED_SPACES.md). Each is an alternative whole-system
design, not a layer to install on top of the others.

## 1. Reference case: the wave_sim company

The following is a normalized record of the owner's proposed setup. It is a sample use case,
not an instruction to create employees, locate credentials, or send email during this design
review.

```text
Owner
└── Project Lead                                  workspace: ~/git/wave_sim
    ├── Go to Market Lead                         outbound and customer discovery
    │   └── Market Researcher                     persistent employee, shared on work
    ├── Product Lead                              product direction and usability
    │   ├── Product Engineer
    │   └── Product Designer                       critical, narrow scope, usable outcomes
    ├── Wave Simulation Lead                      current simulator and practical integration
    └── Frontier Research Lead                    radical computational reductions
```

The Project Lead is the owner's main contact for this business. A future Chief of Staff can
coordinate this lead alongside leads in other workspaces. Neither title creates a special
runtime class or an automatic right to read everyone else's conversations.

The five initial product segments are wave pool design, surfboard design, boat hull design,
hydrofoil design, and coastal engineering. The owner's belief that coastal engineering is the
largest market is a hypothesis to test, not a market fact established by this brief. Product
and Go to Market need a shared, versioned description of the segments and evidence for choosing
the first usable product. They should not independently reconstruct priorities from private
memory.

The Product Designer should challenge vague use cases, keep scope tight, and connect proposed
work to a usable customer workflow. The Product Engineer builds that workflow. The Wave
Simulation Lead owns practical improvements to the existing simulator. The Frontier Research
Lead explores “sub volumetric” or “non volumetric” fluid-simulation approaches and other
mathematical reductions in computational cost. A promising claim becomes an engineering
handoff only after its assumptions, derivation, limitations, and validation evidence are
explicitly reviewed.

Go to Market researches potential customers and interview hypotheses for those segments. It
can prepare lists and drafts before a demo exists. **Customer interview emails may be sent
only after demo videos exist and the owner has authorized the actual sending scope.** The
team should reuse a shared inbox integration associated with a folder under `~/git/`, once
the owner selects that integration. A filesystem path is not an email permission.

Market Researcher has one employment manager, proposed here as Go to Market Lead, and can
contribute to Product work through an explicit work membership. The user also used “sub
agent” in this context. This proposal distinguishes a durable employee who learns over time
from a temporary harness helper who exists only inside a parent's run. Use the durable form
for shared, ongoing research; use a temporary helper for a bounded one-off search.

The top-level directory shows the Project Lead and other chosen entry points. Its employee
tree expands to show leads and specialists. A collapsed employee remains discoverable to
authorized collaborators. Directory placement, information visibility, and execution rights
are three separate decisions.

## 2. What prior work establishes, and what this changes

The current contract documents establish useful mechanisms rather than a blank slate:

| Existing contract | Preserve | Change proposed here |
|---|---|---|
| [Coordination primitives](PLANNING_PRIMITIVES.md) | Generic `send`/`reply`, open purposes, bounded wait, scoped dispatch | Requests remain open across healthy turn endings; explicit return inputs and history |
| [Direct reports](PLANNING_SUB_BUDDIES.md) | One manager, persistent identity, hiring quota, archive/history | Collaboration membership separated from management and directory placement |
| [Memory](PLANNING_MEMORY.md) | Bounded dense documents, CAS, append-only evidence notes, selective capture | Typed revisions in the ledger; explicit workspace scope and deliberate publication |
| [Execution ownership](AUTOMATION_OWNERSHIP.md) | Private current claim, absorbing terminal states, deadline, drain | Every admitted chat or background input uses the same run contract |
| [Coordination design](DESIGN_BUDDY_COORDINATION.md) | Fresh recipient sessions, follow-up routing, source-thread returns, project gates | Adds whole-system knowledge, collaboration, output prerequisites, and brokered external effects |

The July [team control-plane review](../../agent_notes/2026-07-28_buddies-real-team-control-plane-redesign.md)
documents why turns and assignments cannot share a completion state. Its old review-specific
operations and implementation-status statements are historical. The August
[memory review](../../agent_notes/2026-08-22_memory-design-review.md) explains why memory needs
one current head, why work status should not be copied into it, and why automatic capture is
an execution feature rather than an invisible free hook. The September
[message notification note](../../agent_notes/20260909T060112Z_01M22C33VHM2CX59JCEPD2XJS8_message-notification-boundaries_buddies-development-lead_fe6ef8cd.md)
is additional historical evidence; it does not override the current source contracts.

The paused September 9 implementation has shared run/message types, a queue executor,
per-input execution scope, project controls, and owner UI work. Those are partial prototype
changes, not evidence this alternative is shipped or end-to-end ready. The relevant seams are
[message schemas](../../shared/src/buddy-message.ts),
[run schemas](../../shared/src/buddy-coordination.ts),
[run executor](../../server/src/buddies/run-executor.ts), and
[visibility projection](../../server/src/buddies/visibility.ts).

Two baseline distinctions matter. Current dense memory is captured when a conversation is
created; resuming a conversation does not automatically refresh it. Existing workspace notes
are workspace-scoped evidence accessible through authorized recall, not a new private employee
notebook. This proposal must migrate those semantics honestly rather than retroactively
promise privacy or silently broaden existing records.

The joint historical review also located the earlier three briefs and 19 readable parent
conversation transcripts through application session bindings. Its full inventory and access
limits are in the [source-review appendix of alternative 01](REDESIGN_01_TYPED_RESOURCES.md#11-source-review-coverage).
This proposal carries forward requirements recovered there: detailed authored exploration
notes, optional bounded per-turn capture, Git-readable export/import, whole-team Builder
results, and visible notifications at sensible turn boundaries. Missing historical transcripts
are not treated as reviewed, and quoted fork text is not counted as fresh owner authorization.

## 3. The small semantic parts

There are six user-facing concepts and a separate authority boundary:

1. **Buddy:** a persistent employee identity, employment relationship, and workspace membership.
2. **Work:** one accountable owner, a desired outcome, progress, prerequisites, and accepted outputs.
3. **Message:** an addressed communication, optionally an obligation requiring an explicit reply.
4. **Record:** a typed piece of durable content: document, note, artifact, or action draft.
5. **Schedule:** a rule that repeats a bounded input into a conversation.
6. **Run:** one admitted execution attempt for an input under a bounded policy.

Authorization is application policy over those resources. It is not a paragraph in a soul,
an extra employee, a project status, or a promise made in a message.

One typed event envelope records every accepted change. This is a common persistence
mechanism, not a seventh user-facing workflow primitive. A review is a message with evidence.
A team is an employment view plus work memberships. An inbox is a query. A queue is the set
of eligible run projections. A research-to-engineering handoff is accepted output plus new
assigned work. A Chief of Staff is an ordinary Buddy with explicitly granted oversight.

Do not collapse the six concepts into a single `{ kind: string, data: unknown }` entity. A
message being answered, an artifact being accepted, and a process being drained have different
invariants. They should share storage and routing infrastructure without pretending their
lifecycles are interchangeable.

## 4. Storage: ledger first, synchronous authority views

Use one SQLite database and its existing transaction boundary. This proposal does not require
a distributed message broker, remote event bus, or separate query database.

```text
MCP / owner HTTP / authenticated connector
                    │
              typed command service
                    │ validate identity, current grants, revisions, gates
             one SQLite transaction
                    ├── append domain events
                    ├── update synchronous authority projections
                    └── store command receipt
                    │
       existing scheduler + one run executor
                    │
       existing conversation runtime / provider adapter
```

The durable tables have distinct purposes:

| Table family | Role | Rebuildable? |
|---|---|---|
| `domain_events` | Ordered accepted domain transitions, stream/version, actor and causation | No; historical authority |
| `event_payloads` | Bounded content or references to separately retained blobs | No, except disposable artifact caches |
| `command_receipts` | Actor/scope/key/hash and committed result references | Derivable in principle; retained for efficient idempotency |
| Typed `*_view` tables | Buddy/work/message/record/schedule/run/approval current state and indexes | Yes, from compatible event history |
| `active_claims` | Private executor credentials, fence, conversation occupancy, shutdown ownership | No blind replay; loss fails closed |
| Existing transcript/config storage | Provider sessions, full transcripts, durable conversation identities | Existing provider persistence contract |

`active_claims` is deliberately not described as another event projection. A replay must not
regenerate live credentials or pretend a process has died. The ledger records that a run was
claimed or drained; the private claim store and runtime establish whether that executor may
still act. A missing private claim interrupts admission until recovery establishes shutdown.

All state used for authorization is updated synchronously in the command's transaction.
Do not make a message visible as accepted before its queued run exists. Do not authorize an
operation using a lagging search index. Optional search and activity rendering may lag, but
their responses include a cursor and are never the source for permission decisions.

Event order is commit order, not a claim about real-world causality or the order two providers
performed external actions. Cross-stream commands append all related events atomically. A
reply therefore appends its final response and the source conversation's queued input in one
transaction. No eventual consumer has to discover that a reply should wake its requester.

Rebuilding projections executes pure reducers only. It never launches a model, sends mail,
re-runs authorization against today's permissions, or invokes a tool. After a verified
rebuild, the live dispatcher considers only pending inputs whose current gates permit
admission. Historical side effects remain historical.

## 5. Data model and types

These TypeScript signatures specify the proposed wire/domain contract. Branded IDs represent
opaque strings; validators enforce bounds, strict object shapes, and referenced-resource
authorization. Optional fields mean omission; public patches use explicit `null` to clear a
nullable value. No actor, claim token, authority level, or server timestamp comes from a model.

### 5.1 Identity, scope, and references

```ts
type Id<K extends string> = string & { readonly __kind: K };
type BuddyId = Id<'buddy'>;
type WorkspaceId = Id<'workspace'>;
type WorkId = Id<'work'>;
type MessageId = Id<'message'>;
type RecordId = Id<'record'>;
type ScheduleId = Id<'schedule'>;
type RunId = Id<'run'>;
type ConversationId = Id<'conversation'>;
type EventId = Id<'event'>;
type CommandKey = Id<'command-key'>;
type ISODate = string;
type Version = number; // positive integer; zero only for expected absence

type Principal = { kind: 'owner' } | { kind: 'buddy'; buddyId: BuddyId };
type IntegrationOrigin = {
  kind: 'integration'; connectorId: string; externalEventId: string;
  externalMessageId: string; externalThreadId: string | null; senderLabel: string;
};
type ResourceRef =
  | { kind: 'buddy'; id: BuddyId }
  | { kind: 'work'; id: WorkId }
  | { kind: 'message'; id: MessageId }
  | { kind: 'record'; id: RecordId }
  | { kind: 'conversation'; id: ConversationId }
  | { kind: 'schedule'; id: ScheduleId }
  | { kind: 'run'; id: RunId }
  | { kind: 'connector'; id: string };
type EvidenceRef = {
  recordId: RecordId;
  version: Version;
  excerpt?: string; // bounded quotation, not a substitute for read permission
};
type Audience =
  | { kind: 'employee'; buddyId: BuddyId; workspaceId: WorkspaceId }
  | { kind: 'portable_employee'; buddyId: BuddyId }
  | { kind: 'work'; workId: WorkId }
  | { kind: 'workspace'; workspaceId: WorkspaceId };
```

The authenticated owner has administrative inspection under the local single-owner model;
“employee” means private from other Buddies, not secret from that owner. If multiple human
owners become a requirement, human principals and grants must become explicit before claiming
that boundary. The current shared-secret local product is not a multi-tenant authorization
system.

```ts
type Buddy = {
  id: BuddyId;
  version: Version;
  name: string;
  role: string;
  managerId: BuddyId | null;
  employment: 'active' | 'paused' | 'archived';
  hireQuota: number;
  profile: { provider: string; model?: string; reasoningEffort?: string };
};
type Membership = {
  buddyId: BuddyId;
  workspaceId: WorkspaceId;
  version: Version;
  directory: 'entry_point' | 'team_only';
  readAllWork: boolean;
  dispatch: boolean;
  portableMemory: 'disabled' | 'read' | 'read_write';
  background: 'disabled' | 'enabled' | 'limits_paused';
  limits: {
    maxActiveRuns: number;
    maxBackgroundStartsPerHour: number;
    maxSendsPerHour: number;
    maxPendingInputs: number;
  };
};
```

One Buddy may belong to several workspaces; every model run still has one primary workspace.
Cross-workspace reads and sends are explicit operations with current membership checks.
Changing `directory` neither grants nor revokes any data access. Archiving hides ordinary
directory entries but leaves a historical actor label in authorized work/message history.
Do not remove a whole audit record because one referenced employee is archived.

### 5.2 Work and bounded dependencies

```ts
type WorkMember = { buddyId: BuddyId; role: 'contributor' | 'reader' };
type RequiredOutput = { workId: WorkId; output: string };
type AcceptedOutput = {
  output: string; // open name, for example "demo-video" or "research-package"
  evidence: EvidenceRef;
  acceptedBy: Principal; // server stamped
  acceptedAt: ISODate;
};
type Work = {
  id: WorkId;
  version: Version;
  workspaceId: WorkspaceId;
  parentId: WorkId | null;
  ownerId: BuddyId;
  pendingOwnerId: BuddyId | null;
  title: string;
  objective: string;
  definitionOfDone: string;
  status: 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  control: 'enabled' | 'paused' | 'draining' | 'cancelled';
  epoch: number;
  members: WorkMember[];
  requires: RequiredOutput[];
  outputs: AcceptedOutput[];
  todos: { id: string; text: string; done: boolean }[];
  nextAction: string | null;
  blockedReason: string | null;
};
```

The parent relation groups responsibility and propagates execution control. `requires` means
the named output of another work item must currently be accepted and readable before this
work may admit execution. These are separate relations. Both are acyclic; prerequisite cycles
are rejected transactionally. An output may be accepted before its whole project is done.
This allows a usable demo while unrelated improvements remain open.

There is no expression language, arbitrary predicate, or DAG runner. Required-output edges
are an admission gate, not a scheduler that chooses staff or marks downstream work complete.
They are inherited by descendant work so a new child cannot bypass an ancestor's gate.
Creating preparation work separately lets customer research and draft writing proceed while
outreach execution remains blocked on the demo.

Validate cycles in the effective admission graph after expanding inherited ancestor gates,
not just in each raw relation. In particular, a parent cannot require an output from its own
descendant: that would block the descendant needed to satisfy the parent's gate. Bound graph
traversal and reject an overlarge relation update rather than partially validate it.

Output acceptance pins an immutable artifact/document version. A replacement does not inherit
acceptance. Withdrawal, revocation of relevant access, missing artifact availability, or a
changed accepted version fences dependent execution. Reverse-dependency indexes identify the
affected subtree; the same transaction increments its effective gate generation. Running
dependent inputs lose scoped mutation/effect authority and drain. Completed historical work
does not revert automatically; the owner sees that its cited prerequisite was later withdrawn.

One accountable owner is simpler than several assignees. Product and Go to Market share the
researcher's work membership, not managerial ownership. Contributors can append proposals,
notes and allowed artifacts; changing the objective, ownership, control state, accepted
outputs or final status remains with the owner/supervisor under explicit scope.
Marking work done requires current evidence, completed required checklist items and no open
child commitments. Accepting a named output early remains independent of completing the whole
parent. This prevents “done” from hiding unfinished staff work while allowing a valid demo to
unblock interviews before every product improvement is finished.

### 5.3 Messages and conversations

```ts
type DeliveryTarget =
  | { kind: 'new_conversation'; buddyId: BuddyId; workspaceId: WorkspaceId }
  | { kind: 'follow_up'; requestId: MessageId }
  | { kind: 'self'; conversationId: ConversationId }
  | { kind: 'owner' };
type MessageContent = { purpose: string; body: string; evidence: EvidenceRef[] };
type Message = {
  id: MessageId;
  version: Version;
  sender: Principal | IntegrationOrigin;
  recipient: Principal;
  source: null | { workspaceId: WorkspaceId; conversationId: ConversationId;
    workId: WorkId | null; runId: RunId | null };
  destination: { workspaceId: WorkspaceId; conversationId: ConversationId | null };
  workId: WorkId | null;
  rootId: MessageId;
  causedBy: MessageId | null;
  followsUp: MessageId | null;
  supersedes: MessageId | null;
  content: MessageContent;
  expectsReply: boolean;
  state: 'open' | 'replied' | 'cancelled' | 'superseded' | 'informational';
  response: null | {
    outcome: string;
    body: string;
    evidence: EvidenceRef[];
    eventId: EventId;
  };
};
```

A message's state describes a communication obligation. Run states describe attempts to
handle it. Normal provider completion does not reply. A failed attempt does not fabricate a
negative answer. A later valid run of the assigned Buddy in the assigned conversation can
answer an open request. A second final answer is rejected; a correction is a follow-up message
referencing the original, preserving both facts.

Conversation identity and provider transcript persistence remain in the existing conversation
system. The Buddy ledger references them. Do not copy every transcript token into the ledger.
The application conversation is durable context; a provider turn is a bounded execution; a
request may outlive many turns. A new addressed request creates a fresh recipient conversation
unless its authorized `follow_up` route selects the previous recipient conversation.

For a source-thread return, the service routes to the recorded source, not a caller-supplied
conversation ID. `self` is allowed only for the current Buddy's current conversation. No generic
`send_to_any_conversation` tool exists. Peer and subordinate dispatch use the same mechanism;
authorization determines who may be addressed and which work may be assigned.

Only the authenticated connector ingestion service can create an `IntegrationOrigin` sender.
Such a message has no internal source conversation and is informational; responding externally
requires an action draft and broker permission, not `reply` impersonating the owner. Deduplicate
inbound events by connector plus external event/message identity and retain external thread
identity for display/reconciliation. A model cannot supply this sender union to `send`.

### 5.4 Records: memory, notes, artifacts, and action drafts

```ts
type RecordContent =
  | {
      kind: 'document';
      document: 'soul' | 'working_memory' | 'long_term_memory' | 'shared_brief';
      body: string;
    }
  | { kind: 'note'; topic: string; classification: string; body: string }
  | {
      kind: 'artifact';
      mediaType: string;
      locator: string; // validated connector locator or workspace-relative artifact URI
      sha256: string;
      bytes: number;
      description: string;
    }
  | { kind: 'action_draft'; action: ExternalAction };
type RecordVersion = {
  id: RecordId;
  version: Version;
  audience: Audience;
  content: RecordContent;
  sources: EvidenceRef[];
  createdBy: Principal | IntegrationOrigin;
  conversationId: ConversationId | null;
  runId: RunId | null;
  reasoning: string;
};
type ExternalAction = {
  kind: 'mail.send';
  connectorId: string;
  fromAccountId: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments: EvidenceRef[];
  workId: WorkId;
  prerequisites: { required: RequiredOutput; accepted: EvidenceRef }[];
};
```

These records share versioning, content bounds, references, provenance, and access checks.
Their write permissions differ. A note is append-only evidence; correcting it creates another
note with a source reference. Dense documents are complete CAS replacements. An artifact is a
reference to verified bytes; an arbitrary file URL is not proof that the file exists or is
safe to read. A changed artifact is a new version with a new digest. An action draft is a
typed proposal for a registered connector operation; arbitrary command strings are excluded.

Soul retains owner-directed identity, role and style. Initial hiring can author the approved
initial soul within quota; later edits need the existing authorized owner-chat/owner-UI path.
An employee cannot transform a note that says “the owner approves” into that authorization.
The broad document storage mechanism does not give `update_memory` permission to edit souls.

Working memory is keyed by Buddy and workspace. Long-term memory remains the Buddy's own
self-managed learning, partitioned into a portable personal head and current-workspace heads.
Generic reusable lessons can be written by the Buddy into its portable head; they do not have
to become owner-edited soul text. A run receives portable long-term content plus its permitted
current-workspace content within the existing combined 4,000-character long-term envelope.
The write policy allocates fixed sub-budgets initially (2,000 portable, 2,000 per workspace),
so their composition fits without silent trimming. Working retains its separate 2,000 limit.

Portable does not mean shared with other employees. It means allowed to follow this employee
across its execution contexts. A portable write requires disclosure-compatible sources and
the current run's explicit portable-memory permission. Workspace/customer secrets remain in
their workspace head or a scoped shared record. Restricted runs cannot read unrelated
workspace memory merely because the same Buddy owns it. Source labeling and review help,
but cannot mechanically prove that a generic-sounding model paraphrase contains no private
information. Where that guarantee matters, deny portable writes from restricted contexts and
use an authorized publication review. This preserves per-Buddy generic learning while making
the cross-workspace contamination tradeoff explicit.

Notes default to current-work visibility for collaborative evidence, or current-employee and
workspace visibility for personal learning. The caller chooses only among audiences it is
allowed to write. Existing workspace notes retain their workspace audience on import. New
shared briefs hold team goals, segment definitions and accepted decisions. They are not private
memory copied into every employee's soul.

`publish_record` creates an explicitly authorized new version/copy for a wider audience and
records its sources. Widening access is a disclosure action checked against the publisher's
right to disclose those sources. A contributor may publish their original shareable research;
they may not publish the owner's private notes simply because they can read an excerpt in a
restricted request. No automatic summarizer declassifies restricted source content. Human or
model-authored summaries can still leak information; provenance checks cannot infer all
semantic derivations, so the UI and prompts must show source scope and the process boundary
must match the promised protection.
The `portable_employee` audience is restricted to authorized personal long-term memory; it is
not a generic destination for publishing team records. A general record for another employee
uses a workspace-bound employee audience or an authorized shared-work audience.

Detailed exploration deserves more space than dense memory. Keep an authored research journal
with attempted approaches, observations, failed experiments, derivations, alternatives and
reproducible evidence. This is useful written reasoning prepared for readers, not a demand to
store hidden provider reasoning. A note exceeding the current note-body bound becomes a linked
Markdown artifact or a sequence of explicitly titled sections with a manifest; never silently
reduce it to a short summary to fit `remember_note`. Dense memory can cite the journal while
retaining only the lesson. Deleting its original conversation must not delete the journal,
accepted business outputs, or memory revisions.

### 5.5 Scheduling and runs

```ts
type ScheduleTiming =
  | { kind: 'interval'; seconds: number; anchor: ISODate }
  | { kind: 'cron'; expression: string; timezone: string };
type Schedule = {
  id: ScheduleId;
  version: Version;
  buddyId: BuddyId;
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  workId: WorkId | null;
  prompt: string;
  timing: ScheduleTiming;
  enabled: boolean;
  nextDueAt: ISODate;
};
type RunInput =
  | { kind: 'owner_chat'; ownerMessageId: string }
  | { kind: 'message'; messageId: MessageId }
  | { kind: 'inbound'; messageId: MessageId; connectorId: string; externalEventId: string }
  | { kind: 'reply'; messageId: MessageId; replyEventId: EventId }
  | { kind: 'schedule'; scheduleId: ScheduleId; scheduleVersion: Version; dueAt: ISODate }
  | { kind: 'failure_notice'; failedRunId: RunId }
  | { kind: 'continuation'; messageId: MessageId; afterRunId: RunId }
  | { kind: 'capture'; sourceConversationId: ConversationId; policyVersion: Version;
      fromSourceMessageId: string | null; throughSourceMessageId: string };
type RunState =
  | { kind: 'queued'; readyAt: ISODate }
  | { kind: 'held'; reason: string }
  | { kind: 'claimed'; deadline: ISODate }
  | { kind: 'running'; startedAt: ISODate; deadline: ISODate }
  | { kind: 'draining'; reason: string; requestedAt: ISODate }
  | { kind: 'succeeded'; endedAt: ISODate }
  | { kind: 'failed'; endedAt: ISODate; code: string }
  | { kind: 'cancelled'; endedAt: ISODate }
  | { kind: 'interrupted'; endedAt: ISODate; externalEffectMayHaveOccurred: boolean };
type Run = {
  id: RunId;
  version: Version;
  input: RunInput;
  inputKey: string;
  attempt: number;
  retryOf: RunId | null;
  buddyId: BuddyId;
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  workId: WorkId | null;
  state: RunState;
  gates: { workId: WorkId; epoch: number }[];
  policy: { operations: string[]; maxRuntimeSeconds: number };
};
```

The public run contains no credentials. A private claim holds a random capability, a fence,
and the provider/process ownership needed to establish drain. Operations require a matching
current claim, permitted operation, current resource grants, current ancestor/prerequisite
epochs, and unexpired deadline. A schedule repeats a prompt; it does not carry fresh grants
or reset rate budgets. The effective authority is the intersection of the saved ceiling and
current policy, never the union.

### 5.6 Event envelope and accepted event vocabulary

```ts
type DomainEvent = {
  id: EventId;
  schemaVersion: 1;
  sequence: number; // private global commit ordering, not exposed as an unfiltered feed
  stream: ResourceRef;
  streamVersion: Version;
  committedAt: ISODate;
  actor: Principal | { kind: 'system'; service: 'scheduler' | 'executor' | 'importer' | 'connector' };
  commandId: string;
  causedBy: EventId | null;
  workspaceId: WorkspaceId;
  payload: EventPayload;
};
type EventPayload =
  | { type: 'buddy.created'; buddy: Buddy }
  | { type: 'buddy.changed'; buddy: Buddy; reason: string }
  | { type: 'membership.changed'; membership: Membership }
  | { type: 'connector.grant_changed'; grant: ConnectorGrant }
  | { type: 'work.created'; work: Work }
  | { type: 'work.changed'; work: Work; reason: string }
  | { type: 'work.handoff_requested'; from: BuddyId; to: BuddyId; fencedEpoch: number }
  | { type: 'work.handoff_completed'; from: BuddyId; to: BuddyId }
  | { type: 'message.sent'; message: Message }
  | { type: 'message.replied'; messageId: MessageId; response: NonNullable<Message['response']> }
  | { type: 'message.closed'; reason: 'cancelled' | 'superseded'; replacementId?: MessageId }
  | { type: 'record.revised'; record: StoredRecordVersion }
  | { type: 'record.published'; source: EvidenceRef; published: StoredRecordVersion }
  | { type: 'record.payload_removed'; version: Version; reason: string }
  | { type: 'schedule.changed'; schedule: Schedule }
  | { type: 'schedule.advanced'; nextDueAt: ISODate; skippedOccurrences: number }
  | { type: 'run.queued'; run: Run }
  | { type: 'run.transitioned'; state: RunState }
  | { type: 'capture.requested'; policyVersion: Version; throughSourceMessageId: string }
  | { type: 'capture.checkpointed'; policyVersion: Version; throughSourceMessageId: string }
  | { type: 'capture.policy_changed'; policy: CapturePolicy }
  | { type: 'action.decided'; draft: EvidenceRef; decision: 'approved' | 'rejected'; expiresAt: ISODate }
  | { type: 'action.reserved'; draft: EvidenceRef; effectKey: string; runId: RunId }
  | { type: 'action.settled'; draft: EvidenceRef; effectKey: string; result: EffectResult };
type EffectResult =
  | { kind: 'confirmed'; externalId: string; receipt: EvidenceRef }
  | { kind: 'rejected'; reason: string }
  | { kind: 'uncertain'; reason: string };
type StoredRecordVersion = Omit<RecordVersion, 'content'> & {
  contentKind: RecordContent['kind'];
  payload: { id: string; sha256: string; bytes: number };
};
```

Full resource snapshots in change events keep the first reducer simple. They are an explicit
storage tradeoff, not a requirement to encode every future event that way. Content remains
bounded or referenced; high-frequency transcript deltas and provider heartbeat chatter do not
enter this ledger. A later compact event encoding must preserve deterministic replay and
schema-version compatibility. Event payload types are internal service outputs, never public
MCP arguments.

Record text/bytes live behind `StoredRecordVersion.payload`; the immutable descriptor retains
identity, version, audience, provenance and digest. Removing retained content therefore does
not require rewriting the event or accidentally restoring its bytes during replay. A read of
removed content returns a typed `payload_removed` error with its authorized descriptor. This
mechanism applies to record content; deleting a transcript or redacting another domain's
history follows that domain's explicit retention operation and is not implied by it.

## 6. Public APIs and MCP tooling

The public surface should be semantic and discoverable. A single `execute({ json })` tool is
shorter on paper and worse for validation, policy, and model selection. Keep established names
where they map cleanly; add only capabilities the broader use case requires.

Every mutation takes a `key`; edits additionally take the relevant `baseVersion`. Keys are
bounded and scoped to authenticated principal plus workspace. Reusing a key with the same
canonical command returns the original result; changing operation or arguments conflicts.
Canonicalization is schema-defined: normalized UTC dates, sorted object keys, ordered arrays,
and explicit handling of omitted versus null fields. It is not a hash of arbitrary model JSON.
Idempotent replay still checks current permission to read the original result; a revoked
caller cannot use an old receipt to retrieve newly restricted content.

```ts
type Page<T> = { items: T[]; cursor: string | null };
type ReadOptions = { cursor?: string; limit?: number };
type CommandResult<T> = { value: T; commandId: string; events: EventId[] };
type Mutation = { key: CommandKey };
type Versioned = Mutation & { baseVersion: Version };

declare function list_buddies(input: ReadOptions & {
  workspaceId?: WorkspaceId; includeTeam?: boolean; query?: string;
}): Promise<Page<Buddy & { membership: Membership }>>;

declare function get_current_work(input: ReadOptions & {
  workspaceId?: WorkspaceId; buddyId?: BuddyId; workId?: WorkId;
  includeDescendants?: boolean; includeClosed?: boolean;
}): Promise<Page<Work>>;

declare function new_project(input: Mutation & {
  workspaceId?: WorkspaceId; ownerId?: BuddyId; parentId?: WorkId;
  title: string; objective: string; definitionOfDone: string;
  requires?: RequiredOutput[]; members?: WorkMember[];
}): Promise<CommandResult<Work>>;

type WorkEdit =
  | { action: 'content'; patch: Partial<Pick<Work,
      'title' | 'objective' | 'definitionOfDone' | 'status' | 'nextAction' | 'blockedReason'>>;
      evidence?: EvidenceRef[] }
  | { action: 'todos'; operations: Array<
      { kind: 'add'; text: string } | { kind: 'set'; id: string; done: boolean }
      | { kind: 'remove'; id: string }> }
  | { action: 'membership'; members: WorkMember[] }
  | { action: 'requirements'; requires: RequiredOutput[] }
  | { action: 'accept_output'; output: string; evidence: EvidenceRef }
  | { action: 'withdraw_output'; output: string; reason: string }
  | { action: 'control'; state: 'enabled' | 'paused' | 'cancelled'; reason: string }
  | { action: 'transfer'; ownerId: BuddyId; reason: string };
declare function update_project(input: Versioned & {
  workId: WorkId; edit: WorkEdit;
}): Promise<CommandResult<Work>>;

declare function send(input: Mutation & {
  to: DeliveryTarget; workId?: WorkId; content: MessageContent;
  expectsReply?: boolean; notBefore?: ISODate;
  wait?: { timeoutSeconds: number };
}): Promise<CommandResult<{ message: Message; runId: RunId | null }>>;
declare function reply(input: Mutation & {
  messageId: MessageId; outcome: string; body: string; evidence: EvidenceRef[];
}): Promise<CommandResult<Message>>;
declare function get_message(input: { messageId: MessageId }): Promise<Message>;
declare function get_inbox(input: ReadOptions & {
  conversationId?: ConversationId; state?: 'open' | 'replied' | 'attention';
}): Promise<Page<InboxItem>>;
type InboxItem =
  | { kind: 'message'; message: Message }
  | { kind: 'run_attention'; run: Run }
  | { kind: 'blocked_work'; work: Work }
  | { kind: 'approval'; draft: RecordVersion; decision: 'pending' | 'approved' | 'rejected' };
```

`update_project` is a discriminated operation rather than an ambiguous bag containing both
transfer and content edits. Multi-resource requirements such as an atomic handoff are owned
by the service. The API does not let a model supply a transaction containing arbitrary events.

```ts
declare function get_memory(input: {
  doc: 'working' | 'long_term'; partition?: 'current_workspace' | 'portable';
}): Promise<RecordVersion>;
declare function update_memory(input: Versioned & {
  doc: 'working' | 'long_term'; partition?: 'current_workspace' | 'portable';
  content: string; reasoning: string;
  sources?: EvidenceRef[];
}): Promise<CommandResult<RecordVersion>>;
declare function remember_note(input: Mutation & {
  topic?: string; kind?: string; body: string; audience?: Audience;
  evidence?: EvidenceRef[];
}): Promise<CommandResult<RecordVersion>>;
declare function recall(input: ReadOptions & {
  pattern: string; audience?: Audience; since?: ISODate;
}): Promise<Page<RecordVersion>>;
declare function get_record(input: {
  recordId: RecordId; version?: Version;
}): Promise<RecordVersion>;
type RecordWriteTarget =
  | { action: 'create'; recordId?: never; baseVersion?: never }
  | { action: 'revise'; recordId: RecordId; baseVersion: Version };
declare function write_record(input: Mutation & RecordWriteTarget & {
  audience: Audience;
  content: Extract<RecordContent, { kind: 'action_draft' }>
    | { kind: 'document'; document: 'shared_brief'; body: string };
  sources: EvidenceRef[]; reasoning: string;
}): Promise<CommandResult<RecordVersion>>;
declare function publish_artifact(input: Mutation & {
  audience: Audience; description: string;
  source: { kind: 'workspace_file'; relativePath: string }
    | { kind: 'staged_upload'; uploadId: string };
  evidence?: EvidenceRef[];
}): Promise<CommandResult<RecordVersion>>;
declare function publish_record(input: Mutation & {
  source: EvidenceRef; audience: Audience; reasoning: string;
}): Promise<CommandResult<RecordVersion>>;
declare function get_activity(input: ReadOptions & {
  resource: ResourceRef; includeDescendants?: boolean;
}): Promise<Page<PublicActivity>>;
type PublicActivity = {
  id: EventId; at: ISODate; actorLabel: string; summary: string;
  resource: ResourceRef; evidence: EvidenceRef[];
};

type ScheduleEdit =
  | { action: 'create'; targetBuddyId?: BuddyId; conversationId?: ConversationId;
      workId?: WorkId; prompt: string; timing: ScheduleTiming }
  | { action: 'update'; scheduleId: ScheduleId; baseVersion: Version;
      prompt?: string; timing?: ScheduleTiming }
  | { action: 'disable'; scheduleId: ScheduleId; baseVersion: Version };
declare function set_automation(input: Mutation & ScheduleEdit): Promise<CommandResult<Schedule>>;
declare function get_automations(input: ReadOptions & {
  targetBuddyId?: BuddyId;
}): Promise<Page<Schedule>>;
declare function get_runs(input: ReadOptions & {
  workId?: WorkId; messageId?: MessageId; conversationId?: ConversationId;
}): Promise<Page<Run>>;
declare function stop(input: Mutation & {
  target: { kind: 'run'; runId: RunId } | { kind: 'message_root'; messageId: MessageId };
  reason: string;
}): Promise<CommandResult<{ state: 'draining' | 'stopped' }>>;
declare function retry_run(input: Mutation & {
  runId: RunId; reason: string;
}): Promise<CommandResult<Run>>;
```

`write_record` does not accept half-specified edits. `get_soul`/`update_soul` retain their separate scoped contract. Hiring and retirement
retain `hire_direct_report`/`retire_direct_report`; neither becomes available to restricted
or background runs simply because the common command service can handle the event.
Memory validators reject `working + portable`; portable exists only for the employee's generic
long-term lessons. Omitting partition means current workspace. Reads and writes never accept
an arbitrary target employee through these memory operations.

`publish_artifact` resolves the source within the current authorized workspace/mount or a
completed scoped upload, rejects escaping symlinks/traversal, reads/verifies actual bytes,
and copies them to immutable content storage before committing the record. Its server-authored
locator references that stored version. The server computes media type, digest and byte count;
a caller-supplied hash or mutable URL cannot certify acceptance. Upload/size quotas and staged
blob cleanup bound storage. Connector imports use the same ingestion port after authentication.
Changing source bytes creates a new artifact/version; it cannot mutate the accepted old one.

```ts
declare function get_soul(): Promise<RecordVersion>;
declare function update_soul(input: Versioned & {
  content: string; reasoning: string;
}): Promise<CommandResult<RecordVersion>>;
declare function hire_direct_report(input: Mutation & {
  name: string; role: string; soul: string; additionalWorkspaceIds?: WorkspaceId[];
  provider?: string; model?: string; reasoningEffort?: string;
}): Promise<CommandResult<Buddy>>;
declare function retire_direct_report(input: Mutation & {
  buddyId: BuddyId; reason: string; reassignOpenWorkToManager?: boolean;
}): Promise<CommandResult<{ buddy: Buddy; state: 'draining' | 'archived' }>>;
```

The mailbox adapter exposes `mail.get_messages`, `mail.get_message`, and `mail.execute_draft`
only when the connector capability is bound to this context. The last accepts a pinned
`{ recordId, version, key }`, not fresh arbitrary recipients/body. The draft creation operation
is harmless preparation; execution requires current gates and the exact approved version.
Received mail enters as connector-authenticated evidence and an optional ordinary message to
the responsible Buddy. It does not alter soul, grants or execution policy.

### HTTP and privileged operations

MCP and HTTP adapters call the same command service and validation schemas. Use existing
resource route families, with `/api/buddies/:id/messages`, `/projects`, `/records`,
`/automations`, `/runs`, and their detail routes. `Idempotency-Key` carries the same mutation
key. Conditional revisions are required on edits; stale versions return `409` with the
authorized current resource. Reads paginate at 20 by default and at most 100.

Owner-authenticated routes additionally provide:

| Command | Required behavior |
|---|---|
| Create/reparent/reactivate/archive employee | Preview affected work, validate one-manager acyclic tree and quota; drain retirement |
| Change workspace grants, directory placement, limits | Explicit fields, CAS, audit, immediate revocation fences |
| Enable schedule/background | Preview prompt, timing/timezone, target thread, operations and limits |
| Resolve action draft | Exact version/content/hash, expiry and one execution; no purpose-string approval |
| Configure connector | Account and secret references kept server-side; scoped read/send capabilities |
| Repair destination | Explicit held inputs only; verify Buddy/workspace and preserve source history |
| Remove retained payload | Explicit content/history impact, retained tombstone, no false claim to erase external copies |

The owner-only service signatures make those controls concrete:

```ts
type MembershipSettings = Pick<Membership,
  'directory' | 'readAllWork' | 'dispatch' | 'portableMemory' | 'limits'>
  & { background: 'disabled' | 'enabled' };
declare function configure_membership(input: Versioned & {
  buddyId: BuddyId; workspaceId: WorkspaceId; settings: MembershipSettings;
}): Promise<CommandResult<Membership>>;
declare function set_employment(input: Versioned & {
  buddyId: BuddyId; managerId: BuddyId | null; hireQuota?: number;
}): Promise<CommandResult<Buddy>>;
declare function enable_schedule(input: Versioned & {
  scheduleId: ScheduleId; enabled: boolean;
}): Promise<CommandResult<Schedule>>;
declare function configure_capture(input: Versioned & {
  buddyId: BuddyId; workspaceId: WorkspaceId; policy: Omit<CapturePolicy, 'version'>;
}): Promise<CommandResult<CapturePolicy>>;
declare function configure_connector_grant(input: Versioned & {
  grant: Omit<ConnectorGrant, 'version' | 'epoch'>;
}): Promise<CommandResult<ConnectorGrant>>;
declare function decide_action(input: Mutation & {
  draft: EvidenceRef; expectedActionHash: string;
  decision: 'approved' | 'rejected'; expiresAt: ISODate;
}): Promise<CommandResult<{ draft: EvidenceRef; decision: 'approved' | 'rejected' }>>;
declare function repair_destination(input: Mutation & {
  runs: Array<{ runId: RunId; baseVersion: Version }>;
  conversationId: ConversationId; reason: string;
}): Promise<CommandResult<Run[]>>;
declare function remove_record_payload(input: Mutation & {
  record: EvidenceRef; reason: string;
}): Promise<CommandResult<{ state: 'removed' }>>;
```

Owner routes map these to PUT `/api/buddies/:id/memberships/:workspaceId`, PATCH
`/api/buddies/:id/employment`, PUT `/api/automations/:id/enabled`, PUT
`/api/buddies/:id/capture/:workspaceId`, PUT `/api/integrations/:id/buddy-grants/:buddyId`,
POST `/api/records/:id/versions/:version/decision`, POST `/api/buddy-runs/repair-destination`,
and POST `/api/records/:id/versions/:version/remove-payload`. The request shapes are the typed
arguments above minus IDs bound by the route. These operations are absent from ordinary Buddy
MCP. `background: 'limits_paused'` is server-authored; an owner enables/disables or explicitly
resumes it, and cannot forge its observed reason/history by posting that state.

Private executor APIs are `claimNext`, `bindConversation`, `start`, `requestDrain`,
`confirmDrain`, `settle`, and connector `reserveEffect`/`recordEffectResult`. They are not MCP
tools and never accept identity through prose. Conversation creation has stable command and
conversation IDs so a repeated bind cannot create two destination threads.

Public errors distinguish `scope_denied`, `not_found_or_unreadable`, `revision_conflict`,
`idempotency_conflict`, `already_replied`, `superseded`, `gate_blocked`, `limits_paused`,
`destination_missing`, `stale_claim`, `effect_uncertain`, `payload_removed`, and `transition_draining`. Where
revealing existence would leak data, callers receive `not_found_or_unreadable`. Public errors
must not serialize private token/policy internals.

## 7. Lifecycle contracts

The baseline authority rules are deliberately explicit:

| Operation | Allowed principal/scope |
|---|---|
| Read directory | Current workspace member; directory preference only changes default presentation |
| Read work | Accountable owner, scoped ancestor supervisor, work member, or workspace `readAllWork` grant |
| Change work outcome/control/acceptance | Owner, accountable Buddy, or authorized ancestor supervisor with workspace membership |
| Contribute evidence | Work contributor within current run policy; does not grant final acceptance |
| Assign another employee | Owner or that employee's direct manager; destination workspace membership required |
| Send peer/ad-hoc request | Sender dispatch grant, destination membership, shared content scope; does not reassign ownership |
| Reply | Assigned recipient in recorded destination context under a valid current run |
| Read private messages/transcripts | Participants and authenticated owner; no inference from management title |
| Revise own dense memory | Current employee/current workspace, allowed run operation, CAS; no unrelated workspace writes |
| Publish record | Current source read plus disclosure right to proposed audience; source provenance retained |
| Hire/retire/reparent | Existing quota and owner-context rules; background/delegated tools cannot obtain these rights |
| Enable background or authorize external effect | Authenticated owner or already registered exact authorization; never model purpose text |

Supervision follows the explicit project parent hierarchy within authorized workspaces, rather
than granting a manager blanket access to every descendant employee's private resources.
Membership removal/reparenting revalidates affected supervision, queued inputs and schedules;
changing an organization chart never silently carries old authority into a new run.

### 7.1 Dispatch, replies, and follow-ups

`send` validates the sender's scope, addressed Buddy's membership, work association, disclosure
rights for evidence, pending limits and idempotency. It appends `message.sent` and `run.queued`
atomically. Owner-addressed messages create owner attention, not a synthetic owner model run.
The executor binds a fresh recipient conversation and admits only one active turn there.

The recipient receives its own soul and permitted memory, the request, current work, cited
evidence, and the restricted run policy. It does not inherit its manager's private transcript.
The recipient may ask for clarification, delegate authorized child work, save progress and end
its turn. The request remains open. A final evidence-backed `reply` settles it once and queues
a new input to its recorded source conversation under a fresh restricted policy.

The return run uses the message's frozen source workspace/work reference and source policy
ceiling, intersected with current grants. It is not attached to the recipient's completed
child work. Marking owned work done prevents new execution for that finished work, but does
not prevent the current valid recipient run from issuing its final reply/settling. Closing
work never manufactures a reply, and stale/expired claims still cannot reply.

A source conversation already handling an owner message finishes or drains before the return
input starts. Never inject a late reply as a new owner instruction into a running broad-authority
turn. Keep its origin visible. A later follow-up references the original request and resumes
the recipient's existing context if it is still available and authorized.

A low-noise in-turn notice can expose an authorized sender/subject/message-ID header at a
supported tool/turn boundary. It is a lossy nudge over the durable inbox, not a read receipt or
another executor. The agent continues its current work unless the information changes what is
needed. An “urgent” label can affect attention ordering but cannot add permissions, bypass
limits, or promise provider-independent live preemption. Full untrusted bodies remain in the
scoped read/queued-input path, and owner visibility preferences do not change team access.

Bounded wait is a compatibility read over the same durable request, not another workflow.
Reject self-waits and active wait cycles. A wait timeout does not cancel the request. In the
simple first version, even a waiter that observes a reply retains its queued return input;
that may cause one redundant source turn but cannot duplicate the final reply or assignment.
The UI labels both with the same request ID. Do not hide this tradeoff behind an unreliable
claim that the model definitely read the synchronous result.

### 7.2 Recurring check-ins and self-continuation

The existing scheduler clock is the only timing loop. A schedule occurrence has a stable key
`schedule:<id>:<version>:<due-instant>`. In one transaction it advances the cursor past all
missed instants and either appends one queued input or records that an outstanding occurrence
already covers the check. At most one queued/claimed/running/draining occurrence exists per
schedule. Repeated polling and restart cannot create another for the same instant.

The schedule prompt should ask the Chief/lead to inspect current inbox/work and act on material
changes, rather than replay its previous instructions blindly. Explicit replies already wake
the source immediately. A recurring check is a backstop for missing replies, blocked work and
stale requests; it does not manufacture completion from a finished provider turn.

Editing a definition requires it to be disabled. Disabling stops new ticks and cancels its
queued occurrence; an active occurrence is fenced and drained. Re-enabling starts from a new
calculated due time, without replaying missed ticks. Manual “run now” uses its own command key
and still respects the schedule's one-outstanding-occurrence and global/Buddy limits.

A delayed self-message is an ordinary informational message whose input is gated on successful
drain of the current run. Only one pending self-successor is allowed per run. Failure/cancel
holds it for explicit inspection. It consumes normal admission/rate limits. Returning a reply,
writing memory, or emitting an activity event does not itself create another self-continuation.
No generic “subscribe to every event and run the Buddy” mechanism is added.

Cron uses the existing validated scheduler implementation and named timezone. Persist due
instants in UTC, display timezone and next occurrences in owner preview, and retain the
scheduler's specified daylight-saving behavior. Adoption requires tests for that behavior;
this brief does not invent a second cron parser. The server must be running for wakeups to
execute; machine sleep/downtime produces coalescing, not cloud availability.

### 7.3 Optional per-turn capture without a hidden unlimited worker

Default behavior stays selective same-turn capture, plus existing eligible automation capture
within its original remaining policy/budget. An owner can optionally enable a bounded capture
policy for a Buddy/workspace. It is explicit configuration, visible in Automation/Knowledge;
there is no assertion that the current implementation universally reviews every turn.

```ts
type CapturePolicy = {
  version: Version;
  mode: 'off' | 'after_successful_turn';
  provider?: string;
  model?: string;
  minimumIntervalSeconds: number;
  maxRuntimeSeconds: number;
  maxStartsPerHour: number;
};
```

Successful eligible source turns append `capture.requested` with the last visible application
message ID. A derived cursor tracks requested-through and successfully-processed-through for
that conversation/policy version. One capture input at a time takes an immutable source
interval. It contains authorized visible user/assistant content and selected cited evidence,
not hidden provider reasoning, arbitrary tool logs or another Buddy's transcript. The source
range is a durable snapshot/reference with bounded size; if too large, split at message/section
boundaries and record the remaining interval. If source bytes were already deleted, record a
visible skipped/held capture rather than fabricate knowledge.

The common run queue executes capture with memory/read-only-source operations and its own
owner-enabled budget ceiling, intersected with current grants. A cheaper model is a selectable
provider profile only after capability validation; selecting one does not change access.
Successful completion appends `capture.checkpointed`. If more source turns arrived meanwhile,
the service can enqueue the next bounded interval after the minimum cadence. While queued or
running, new requests only advance requested-through; they do not create one model call per
event. Failures hold the interval for explicit retry or the next configured reconciliation,
with the same rate ceiling, not an immediate retry loop.

Capture-created turns, notes, memory changes and activity events are ineligible source events,
so capture cannot capture itself. CAS conflicts reconcile against the current memory head;
they never overwrite it with a stale summary. No material learning is a valid no-write result.
Capture cannot alter current work status, publish to a wider audience, send messages/mail or
enable itself. This feature costs real queue/cursor/configuration complexity; if observation
shows same-turn capture is sufficient, keep it off instead of treating it as mandatory noise.

### 7.4 Stop, pause, transfer and retirement

Stopping a run first revokes its private claim and enters `draining`. The runtime stops the
provider and joins process exit, event consumption, and session persistence. Only confirmed
drain releases its conversation slot and terminalizes it. Expiry of a timestamp alone is not
proof of shutdown. A watchdog signal does not become successful completion.

Project pause/cancel fences the whole subtree, regardless of the message roots that created
its runs. Pause preserves obligations but holds queued inputs with stale epochs. Resume
enables new admission; interrupted inputs need explicit retry. Cancel additionally closes
pending obligations and disables schedules. A model cannot escape by creating an unbound
project during project-bound execution: new work must retain its authorized project ancestry.

Transfer writes `pendingOwnerId`, fences the subtree, and drains affected work. The completion
transaction changes the selected work owner, preserves explicitly owned children, supersedes
unanswered requests assigned to the old owner for that work, and creates replacement requests
with original source provenance to the new owner. Completed replies remain intact. The new
owner receives shared work/evidence and their own fresh private context. Project schedules are
disabled for inspection. Never transfer the old employee's soul or private session.

Never-dispatched queued child inputs can be revalidated and restamped during transfer; inputs
that may have executed remain held. A failed drain is a visible pending transition, not a
successful reassignment. Retirement uses this same drain boundary and requires explicit
transfer/cancellation of open work. Paused employees hold hiring seats; archived histories and
identities remain available in authorized historical views.

### 7.5 Crash and retry

| Boundary | Durable result |
|---|---|
| Before command commit | Nothing accepted; same key may retry |
| After commit, before response | Same key returns committed result |
| After queued event, before runtime creation | Stable destination creation key permits safe bind retry |
| Claimed, with unknown process state after crash | Held/interrupted; no automatic second provider |
| Reply committed, then provider fails | Preserve reply; show independent failed run |
| Cancellation requested, provider still emits tools | Reject claim; continue draining |
| Conversation deleted | Hold destination, keep request/history, offer explicit repair |
| Unknown connector result | Record `uncertain`; reconcile before any resend |

An explicit retry creates a new run attempt for the same logical input, after old-process
shutdown is established. It does not erase the old attempt or automatically repeat an already
confirmed external action. A once-only failure notice references the failed request-processing
run; failure of that notice never generates another notice. A failure notice is attention,
not a final response on behalf of the recipient.

## 8. Knowledge, logs, and visibility

The ledger makes distinctions visible; it does not merge every kind of information into an
undifferentiated timeline.

| Surface | Answers | Default Buddy audience | Durable authority |
|---|---|---|---|
| Soul | Who am I, what is my role/style? | Owning employee in authorized contexts | Owner-directed document revisions |
| Working memory | What hypothesis or fragile context should I retain? | Employee + workspace | Explicit bounded document head |
| Long-term memory | What durable lesson has been established? | Portable personal + permitted workspace partition | Explicit bounded document heads |
| Shared brief | What goals/decisions should this team use? | Work or workspace audience | Explicit versioned shared document |
| Note | What was observed, attempted or learned, with evidence? | Declared employee/work/workspace audience | Immutable note record |
| Work | Who owns the outcome; what is its current state? | Owner, scoped supervisor and members | Work projection from accepted events |
| Message | What was asked, answered and still owed? | Participants, owner, expressly shared evidence | Message projection/history |
| Transcript | What did this application conversation contain? | Its authorized participants/owner | Existing transcript store |
| Activity | What materially changed? | Resource-reader, content filtered | Ledger projection |
| Operational log | What failed in transport/processes? | Owner/operator; sanitized Buddy error | Bounded diagnostic retention |

No automatic activity-to-memory promotion occurs. Models decide whether a material correction
is worth preserving using `remember_note` or `update_memory`. Memory may cite work IDs and
explain a belief; it cannot become a second source for status, owner, blockers or next action.
This preserves a single answer to “who is working on it?”

Fresh conversations use the latest allowed dense-memory versions, shared-brief references,
and current work snapshot. Resumed conversations retain their original injected snapshot;
new scheduled/reply inputs include a compact current-state delta and version references, and
the Buddy can explicitly read/recall current data. Do not silently replace provider history
or replay the whole transcript to “refresh” memory. Native forks must follow the existing
identity/configuration-generation rules; changed scope requires a fresh safe context.

The total briefing envelope is bounded by section and measured in one documented unit. Retain
the current 2,000-character working and combined 4,000-character long-term envelope using the
partition sub-budgets above, the 10,000-character soul limit, and existing note/body limits.
Include full permitted dense documents; paginate
work and shared references with explicit omission counts. Never concatenate then silently
truncate the tail. A reference can become unreadable after grant revocation; show the fact
without leaking its title/body.

Directory access reveals authorized employee names/roles and collaboration routes. Work
oversight grants reveal work state and accepted shared outputs. They do not reveal private
memory, private requests, or transcripts. A Chief can have `readAllWork` in `wave_sim` and a
second workspace while receiving only the shared outputs of each. The model's broad title is
not an access rule.

Message evidence is rechecked at send and read time. When recipient membership is insufficient,
the sender must publish an authorized excerpt/artifact to the recipient's employee audience
or an explicitly shared work audience. `publish_record` supplies this resource-level disclosure;
it does not require an additional generic ACL language.
Passing an ID does not grant access. A shared researcher receives only the current assignment's
work context and allowed workspace memory, not the union of all customer/employee secrets from
every project where they ever participated.

Previously disclosed provider context cannot be narrowed by an ACL edit. On workspace switch,
material access-domain change or revocation, start a fresh provider session with only currently
permitted handoff content; preserve the application's historical thread with an explicit reset
marker if its participant visibility remains valid. Do not resume a session containing now
forbidden material and claim that fresh tool checks make the model forget it.

### History retention and privacy limits

An append-only ledger is valuable for audit and awkward for deletion. Keep immutable event
metadata separate from deletable sensitive payloads. Owner-authorized removal appends a
tombstone and removes the retained payload/attachment according to configured retention;
historical projections then show “content removed,” not the old text. Backups and exported
copies need their own retention policy. Do not claim local deletion can recall content already
read by another model, saved in a transcript, exported, or sent by email.

The first implementation's payload-removal operation covers Record content only. Work/message
events above contain full bounded snapshots, so their text remains in retained history unless
an explicit later migration separates those payloads too. Removing a Record cannot redact a
quotation already copied into a Work objective or Message. Exports and owner history views
must state this retention boundary. If full-message/work erasure is a product requirement,
introduce tombstonable payload references for those domains before accepting that requirement;
do not ship an “erase everywhere” button over the record-only mechanism.

Activity APIs must authorize each resource before projecting its events. They expose opaque,
scope-bound cursors rather than raw global sequence numbers, unfiltered event counts, SQL or
payload search. Search indexes contain only the permitted retrieval scope; shared activity
does not show a private note's title just because its append changed a Buddy's memory generation.

App ACLs are logical controls under the existing local architecture. Provider processes run
as the owner's OS user and may otherwise read files or use other connectors. Strong privacy
against an adversarial or confused shell-capable agent requires separate process identities
or equivalent sandboxed mounts, credential isolation and egress controls. This redesign can
implement correct app permissions without claiming the current host process model supplies
that stronger containment.

### Git-readable definitions, knowledge and evidence

Offer a deliberate repository export of Buddy names/roles/provider preferences, soul and
selected dense-memory heads, shared briefs, authored notes/artifacts, and a portable team
manifest. The export declares schema version, stable export-local references, source versions,
digests, selected audiences and omitted items. Markdown views are readable, diffable and
shareable. They are exports of accepted state, not a second writable authority while the
application is running. An export consistency check compares current heads and file digests;
it never certifies that an edited repository file is already authoritative.

```ts
type ExportSelection = {
  buddyIds: BuddyId[];
  workspaceIds: WorkspaceId[];
  records: EvidenceRef[];
  includePrivateMemory: boolean; // owner-only deliberate selection
};
// Owner-authenticated API/CLI, not background Buddy MCP:
declare function export_team(input: Mutation & {
  selection: ExportSelection; destination: string;
}): Promise<{ manifestPath: string; digest: string; omitted: string[] }>;
declare function preview_import(input: {
  manifestPath: string; workspaceId: WorkspaceId;
}): Promise<{ previewId: string; changes: string[]; warnings: string[] }>;
declare function apply_import(input: Mutation & {
  previewId: string; expectedDigest: string;
}): Promise<CommandResult<{ buddyIds: BuddyId[] }>>;
```

An owner chooses and reviews the export destination/audience; the service validates it within
that authorization and avoids secrets or implicit filesystem traversal. No credential, claim
token, active run, executable approval, local external-account permission, or enabled schedule
is exported. Scheduling intent can be represented only as disabled templates. Runtime work
history may be separately exported as evidence, clearly labeled historical and not active
obligations that should resume on another machine.

Import is preview -> owner acceptance -> typed commands using current quota/membership rules.
It creates or maps local identities deliberately, preserves imported provenance, and never
reactivates schedules or external rights from repository prose. A changed source manifest
invalidates the preview. Existing Buddy edits use CAS against the versions captured during
preview. An imported soul cannot grant permissions; private memory is restricted until the
owner assigns its workspace scope. Direct edits to exported Markdown become proposed imports,
not a background two-way sync system. No commit, push or automatic publication follows merely
from export.

## 9. The demo-video and email boundary

This use case needs more than a sentence in a Go to Market soul. It needs a deterministic
condition at the place that performs the external effect.

The owner configures a fixed connector grant independently of employee-authored work:

```ts
type ConnectorGrant = {
  connectorId: string;
  buddyId: BuddyId;
  workspaceId: WorkspaceId;
  accountId: string;
  enabled: boolean;
  workRoots: WorkId[];
  operations: ('mail.read' | 'mail.draft' | 'mail.execute_approved')[];
  requiredOutputs: Array<RequiredOutput & {
    acceptedBy: Principal[];
    mediaTypes: string[]; // finite allowed MIME types; empty only for non-asset prerequisites
  }>;
  version: Version;
  epoch: number;
};
```

For this account, `requiredOutputs` names the owner's chosen demo work/output. The generic
field can express other accepted prerequisites in other use cases. The Buddy cannot remove
it, select a different work root, or create its own fake prerequisite to avoid the rule.
Action drafts pin the currently accepted versions; they do not choose the effective mandatory
gate. The broker always adds current grant requirements and checks their allowed acceptance
authority, verified artifact availability and version before dispatch.
For the sample, the owner chooses Product Lead/owner as accepted reviewers and concrete video
media types. An accepted text file named `demo-video` cannot satisfy that grant. Prerequisite
review quality is still human/model judgment; the broker enforces the recorded contract.

1. Create `Demo for initial customer segment` work, owned by Product Lead, with a named output
   `demo-video`. Store the actual video as an artifact with verified bytes, media type, digest
   and accessible locator. Product Lead or an explicitly authorized reviewer accepts a pinned
   version as meeting the definition of done. The owner can require owner acceptance for this
   first demonstration. A path ending in `.mp4` is insufficient.
2. Create separate research and draft-preparation work, which does not require the video.
   Create outreach execution work requiring the accepted `demo-video` output. Its descendants
   inherit the gate. Do not block every useful GTM activity while the product team is building.
3. Write immutable email drafts under the outreach work. Each draft pins sender account,
   recipients, subject/body, attachments and accepted prerequisite version. The shared inbox
   folder is connected through an owner-configured adapter; it is not interpreted as a grant
   to discover/use every local mail credential.
4. The owner approves an exact draft version with expiry and maximum one execution. A batch
   can be one reviewed set of concrete recipient/draft pairs, never “all future customers.”
   This initial proposal excludes open-ended automatic sending grants. Prior authorization
   for an exact action should be reused rather than asking again merely because a run changed.
5. `mail.execute_draft` checks current run/grants, work/ancestor/prerequisite gates, exact draft
   version/hash, approval expiry and consumption, approved sender account and recipient set.
   It atomically appends an effect reservation with a stable connector idempotency key.
6. The mail broker rechecks cancellation/authorization immediately before sending, performs
   the action using credentials unavailable to the Buddy, and records the provider receipt.
   On an ambiguous network result it records `uncertain` and reconciles against provider
   history/idempotency support. It never blindly retries the SMTP/API call.

Consuming an approval and reserving a local effect can be atomic. Committing a SQLite event
and making an arbitrary external service deliver mail cannot be one local transaction.
Exactly-once delivery is claimed only where the chosen connector supplies and verifies that
guarantee. Otherwise the supported contract is one reserved logical action with explicit
uncertainty and reconciliation. If the provider cannot safely reconcile, the owner resolves
the uncertain action before another send is possible.

Withdrawing the demo or pausing outreach before effect reservation rejects the send. Revocation
after an external service has already accepted it cannot retract that email. The owner UI must
distinguish queued, reserved, sending, confirmed, uncertain and cancelled-before-send states.
This is the irreducible effect boundary; renaming the email a “message” does not remove it.

Enforcing the gate against all possible paths requires mail credentials only in the broker,
no direct ungated email tool in this Buddy's capability set, and process isolation that stops
shell/native-connector bypass. In the current owner-UID local runtime the app can guarantee
its own broker checks, but cannot honestly guarantee that arbitrary shell code cannot send
mail elsewhere. Shipping “cannot email before demo” as a strong product guarantee therefore
includes containment work, or the product must explicitly promise only gated app operations.

Inbound email and external attachments are untrusted data. They may create a research note or
an ordinary request for the GTM Lead. They cannot enable a schedule, approve an action draft,
widen audience, or modify soul. Customer lists/drafts remain shared only with the authorized
GTM/product work, not automatically every employee in the workspace.

## 10. Composing the whole team

### A. Create the team and shared direction

```text
Owner/Builder: preview identities, one-manager tree, quotas, workspace rights and entry points
Owner accepts setup -> typed create/hire operations -> Buddy and membership events
Project Lead: write_record(shared_brief = product goals + five segment hypotheses)
Project Lead: new_project(Product discovery, owner = Product Lead)
Project Lead: new_project(Market evidence, owner = Go to Market Lead)
Project Lead: share/publish the brief to those work audiences
Project Lead: send(Product Lead, "propose narrow first usable workflow", shared brief)
Project Lead: send(GTM Lead, "research customers and interview hypotheses", shared brief)
```

Initial setup is previewable and idempotent. A Builder retry does not hire another employee
with a new identity. One transaction can accept the staff configuration, but filesystem/profile
provisioning remains repairable through stable IDs; partial provisioning is visible and blocks
admission until repaired. The owner can speak to any authorized employee even if only the
Project Lead appears at the top level.

### B. Share a researcher without giving them two managers

```text
GTM Lead: new_project(Segment research, owner = Market Researcher)
GTM Lead: update_project(membership = Product Lead as reader)
GTM Lead: send(Market Researcher, purpose = "research", required questions)
Product Lead: send(Market Researcher, purpose = "clarify", explicit shared-work context)
Researcher: remember_note(observations, audience = Segment research, evidence)
Researcher: write_record(segment comparison, audience = Segment research)
Researcher: reply(original request, evidence = comparison)
Product Lead: read shared comparison -> send Designer a bounded customer-workflow critique
```

The researcher and its manager resolve conflicting priorities; the software does not infer
resource allocation from who sent the most recent message. If two new commitments conflict,
the researcher reports the conflict and the accountable leads negotiate. A workload projection
can expose open commitments without inventing a scheduling optimizer.

### C. Product iteration and critical design

```text
Product Lead: select a segment based on research, record decision and contrary evidence
Product Lead: assign Designer a specific workflow and scope constraint
Designer: reply with proposed flow, objections, success criteria and excluded scope
Product Lead: assign Product Engineer child work using accepted design artifact
Engineer: finish bounded slice -> publish runnable artifact/demo -> reply
Product Lead: send Designer a review request with only necessary evidence
Designer: reply("changes requested", concrete gaps)
Product Lead: reopen child work -> send follow-up referencing Engineer's original request
Engineer: revise -> reply with new artifact version
Product Lead: accept demo-video output -> report progress to Project Lead
```

There is no `design_review` or `revision_round` table. Review outcome is open text; decisions
that matter to execution become explicit work/output changes. A model saying “approved” in a
review cannot consume an owner-only mail approval.

### D. Frontier research becomes practical simulation work

```text
Frontier Lead: research under its own project and bounded recurring inputs
Frontier Lead: notes separate conjecture, derivation, test and limitation
Frontier Lead: publish research package with assumptions, reproducible checks and cost claim
Frontier Lead: send(Wave Simulation Lead, purpose = "technical assessment", package)
Simulation Lead: evaluate validity and practicality -> reply with evidence
Project Lead: accept named research-package output only after the agreed review
Project Lead: create Simulation Lead integration work requiring that accepted output
Simulation Lead: assign implementation/benchmarks -> publish measured results
Product Lead: assess whether results improve the chosen customer workflow
```

A completed research run is not a mathematical breakthrough. The system preserves claims,
evidence, review and ownership; it cannot prove the research is sound merely by tracing the
events. Incorrect research is corrected with new records and withdrawn acceptance, preserving
why downstream work was originally started.

### E. Customer interviews after a real demo

```text
GTM Lead -> Researcher: build candidate list and interview hypotheses
GTM Lead: draft concrete emails while outreach execution gate is blocked
Product Lead: accept verified demo-video v3
GTM Lead: read accepted output -> produce pinned action drafts referring to v3
GTM Lead: send owner an approval request referencing exact drafts
Owner: inspect draft, recipients, account, video and scope -> approve exact versions
Fresh GTM run: mail.execute_draft(approved version)
Broker: revalidate gate -> reserve effect -> send/reconcile -> record receipt
GTM Lead: update interview work -> capture customer learning as scoped evidence
Product Lead: read published synthesis -> update shared product decision
```

Approving a demo does not approve an email. Approving an email does not grant permanent access
to the account. Receiving an interview answer does not automatically publish customer details
to the full team. These are composable actions with separate facts and scopes.

### F. One Chief of Staff conversation across workspaces

```text
Owner grants Chief directory/work oversight and dispatch in selected workspaces
Owner talks in Chief conversation C
Chief: list_buddies(workspace A/B) -> get_current_work(A/B)
Chief: create parent program and authorized workspace-specific child work
Chief: send each Project Lead a bounded request -> end healthy turn
Each Project Lead coordinates their team through the same messages/work operations
Lead replies -> a fresh restricted input queues in C
Chief reads current work and shared output -> follows up or reports material completion
Chief's enabled schedule periodically checks open obligations in C
```

Cross-workspace parent work requires the accountable supervisors to have the relevant
memberships. It does not merge the workspaces. Chief needs shared summaries and accepted
outputs, not engineers' private memory. If a sensitive project cannot be exposed to Chief,
its authorized lead can publish a bounded status summary; Chief cannot drill through that
summary into its private sources.

### G. Long work, human interruption and operational recovery

An engineer records progress in work, adds one self-continuation, and ends successfully. The
next input starts after drain. If the owner pauses the project first, the continuation is
held. The owner can speak in the same conversation while background inputs wait. If the owner
transfers the work, the new supervisor receives shared state and chooses which interrupted
inputs to retry. A scheduled manager check notices held/uncertain work and asks for a concrete
decision; it cannot auto-clear an unknown email effect or a failed provider process.

## 11. Owner experience

The default overview should answer “who is accountable, what changed, and what needs me?”
without becoming a wall of every tool call.

| View | Required behavior |
|---|---|
| Organization | Entry-point cards, expandable staff tree, shared collaborators shown on work; archive history separate |
| Chief/Project Lead chat | Human inputs, team replies and scheduled check-ins visibly labeled by origin; one conversation |
| Work | Accountable owner, members, current outcome, accepted outputs, prerequisites, blockers and execution controls |
| Inbox | Unanswered requests separated from queued/running attempts, approvals and failures |
| Knowledge | Private workspace memory, shared briefs and notes separated; source/version/audience visible |
| Activity | Meaningful changes with cause/evidence links; drill into run diagnostics when needed |
| Automations | Prompt, destination, next due times, effective limits, last outcome, enable/disable and run-now |
| Approval | Exact email content, recipients, account, prerequisites, expiry and execution receipt/uncertainty |
| Privacy/sharing | “Who can read this?” and “Who may act?” shown separately from directory placement |

Desktop and mobile use the same APIs, derived state and Buddy components. Preserve route-based
Buddy sections, the single WebSocket bridge, and availability-checked conversation links.
Show a missing/deleted thread as a held destination with a repair action; do not navigate to
an unavailable conversation and bounce to the list. Current shared-client rules still apply;
this proposal needs no second streaming store.

Owner-visible activity may include private items because the owner can inspect them, but team
activity is filtered by the viewing Buddy/resource grants. Log verbosity and confidentiality
are independent: hiding a tool event from the overview is not an access-control mechanism.

## 12. Budgets and conservative defaults

Retain the coordination design's initial measurable bounds: background disabled until enabled,
600-second maximum run runtime, two active runs per Buddy, eight globally, 30 background starts
per rolling hour per Buddy, 100 sends/hour, and 100 pending inputs. Admission reserves these
atomically from persisted history/current claims. Owner interactive work uses the same active
slots but remains available when background hits its hourly cap.

At a start/send cap, latch background paused and show the reason until owner resume. Internal
reply/failure delivery must remain durable even when new-request limits are full; hold its
execution rather than discard accepted communication. Fair admission prevents one busy team
from indefinitely starving other eligible conversations. A simple oldest-eligible queue with
per-Buddy active caps is sufficient initially; measure starvation before adding priorities.

Runtime and count limits are enforceable in this design. Token/cost fields are not called
enforced monetary budgets until the provider boundary measures them reliably and admission
uses the measurement. A periodic schedule does not imply a financial authorization, a new
hiring seat, or permission to keep retrying an uncertain external effect.

## 13. Migration from current code and the paused prototype

This alternative is a larger persistence change than the typed relational proposal. Do not
apply it by changing current tables into writable caches while old paths continue mutating
them independently. The moment two paths own current state, replay becomes fiction.

| Current/prototype mechanism | Ledger equivalent | Migration caution |
|---|---|---|
| Buddy/profile/reporting/membership rows | Imported creation/current-state events and identity views | Preserve immutable IDs, quota, archival history and profile paths |
| Owned projects/todos | Imported work streams and typed work views | Preserve parent/gate revisions; add membership/output requirements explicitly |
| Messages/replies | Message streams plus derived inbox | Preserve original source/destination and already-settled outcomes |
| Dense memory revisions | Record revision streams | Retain CAS generation; classify workspace scope conservatively |
| Workspace note files | Imported note records with original provenance/content digest | Existing workspace audience remains; files become documented projections only after cutover |
| Audit rows | Legacy audit references/import markers | Do not fabricate precise domain transitions that old data never recorded |
| Automation definitions/runs | Schedule and run streams | One scheduler cursor and one executor; no dual active schedule |
| New queued run prototype | Run view/claim contract | Reuse drain, private authority and per-input runtime seam; do not replay providers |
| Approval records | Action-draft/decision/effect streams | Legacy prose approvals grant no new executable action |
| Conversation links/config/transcripts | References to existing authoritative conversation store | Do not duplicate transcript storage or infer missing provider sessions |
| Shared inbox folder | Explicit connector configuration and action drafts | No inferred account secrets, email rights or automatic sending |

Migration proceeds in bounded stages:

1. Inventory the actual package archive, source worktree, dirty main changes and migration
   versions. The paused prototype and current archive may differ. Preserve all work; no source
   rewrite should assume either is a clean release baseline.
2. Add the typed command service seam around existing mutations. Prove one validated service
   behind MCP and owner HTTP before changing persistence authority.
3. Pause mutation admission at a drain boundary. Import a deterministic snapshot with IDs,
   versions and original provenance. Create explicit `imported` metadata for older history;
   do not claim the import reconstructs every past event.
4. Build projections and compare public reads against current records. Verify membership,
   unresolved obligations, memory heads, schedules, and private boundaries. Preserve old store
   snapshots read-only for recovery and investigation.
5. Cut over one authority: commands append ledger events and synchronously maintain projections.
   Old CLI/HTTP entry points become adapters or are disabled. No direct package-store write may
   bypass the command transaction after this point.
6. Reuse the existing scheduler/runtime with the new run view. Adopt current-thread returns and
   project gates only after the real boundary scenarios pass. Legacy sequence/loop occurrences
   either finish before cutover or resume only as explicitly reviewed new attempts.
7. Add workspace-scoped memory, work memberships, accepted-output prerequisites and the mail
   broker as separate verified slices. Imported global memory stays restricted pending owner
   classification; do not copy it into every workspace automatically.
8. Expose source/audience/history and failure controls in both shells. Enable one small team
   trial after owner authorization; sending real customer emails is a separate exact action.

Rollback after accepting new commands requires replaying/exporting those accepted changes into
a compatible store, or fixing forward. Restoring a pre-cutover snapshot would lose obligations
and approvals; it is not a safe routine rollback. This operational cost is a reason to prefer
the relational alternative unless the ledger's product benefits justify it.

## 14. Acceptance matrix and readiness

Use a real temporary database, the authenticated private tool boundary and actual conversation
runtime with a deterministic provider fixture. Prefer scenario families that cover expensive
invisible failures over mocked reducer tests that only restate implementation. Pure reducers
still need a replay equivalence test because replay is this alternative's central promise.

| Scenario | Required observable result |
|---|---|
| Wave_sim team setup retried | One identity per intended employee, one manager each, correct quota and entry-point tree |
| Shared researcher | Product can read/contribute only to shared work; does not gain GTM private notes/mail credentials |
| Lead -> engineer -> review -> revision | Explicit replies return to original threads; healthy waiting leaves request open |
| Chief across two workspaces | Authorized rollup/dispatch succeeds; private memory/transcripts and unrelated work remain unreadable |
| Request/reply command repeated | Same result and one queued logical input; changed payload conflicts |
| Busy source thread | Owner turn and return input serialize; return does not borrow owner-turn authority |
| Schedule repeated polling and downtime | One outstanding occurrence, advanced cursor, visible coalescing, no catch-up storm |
| Self-continuation after failure/cancel | Held, no automatic restart or new allowance |
| Missing conversation/repaired destination | Durable held input; repair cannot reroute private context to another identity/workspace |
| Pause/child-create race | No child bypass; descendant claims fenced before further scoped effects |
| Handoff while active | Drain first, replacement requests preserve provenance, child ownership/private identities preserved |
| Prerequisite withdrawn/replaced | New dependent effects rejected; stale running authority revoked; completed history unchanged |
| Dense CAS from two conversations | One winner; loser receives current authorized version; no dropped change |
| Memory learned in workspace A | Not automatically injected/read in restricted workspace B context |
| Publish restricted evidence | Denied unless source disclosure permits target audience; no title/body leak in activity |
| Maximum briefing sizes | Dense documents intact, deterministic omission metadata, no tail truncation |
| Rich exploration note beyond dense limits | Full authored content retained as linked sections/artifact; only explicit summary goes into dense memory |
| Optional capture during rapid turns | Bounded immutable source intervals, one outstanding capture, CAS reconciliation, no self-trigger recursion |
| Export/import through Git | Readable consistent records; changed preview conflicts; no secrets, grants, active runs or enabled schedules restored |
| Archived employee in old work | History remains legible; ordinary directory omits employee without deleting evidence |
| Email before demo acceptance | Drafting allowed in preparation work; actual broker send rejected |
| Approved draft changed | Old approval cannot send changed recipients/body/video version |
| Email timeout after provider acceptance | Uncertain/reconciled receipt; no blind duplicate send |
| Stop while provider events still draining | Claim revoked, slot retained until joined shutdown, terminal state absorbing |
| Replay all accepted events | Same public projections, zero model starts, zero connector actions, no regenerated claims |
| Private payload removed | Current/rebuilt projections retain tombstone and do not restore deleted bytes |
| UI subscriber reconnect | Scope-bound cursor resumes/reloads safely; no unfiltered global history |
| Shell/native connector bypass trial | Strong gate claimed only if deployment isolation actually blocks it |

Mechanical tests establish state and permission behavior. A small live trial separately
measures whether leads reply reliably, recognize weak evidence, avoid duplicate assignments,
keep memory useful and send only material follow-ups. Tracing a poor decision accurately does
not make that decision good. Research quality, customer demand and managerial judgment remain
behavioral evaluation questions.

This is a coherent alternative specification, not implementation approval or proof of release
readiness. Its core unresolved implementation selections are the actual shared-mail adapter and
its idempotency/reconciliation support, the containment level promised by the local product,
and retention/storage policy for ledger payloads and backups. These selections must be made
before claiming the corresponding external-effect/privacy guarantees. They do not prevent
building the internal team workflow or comparing this direction with the other two.

## 15. Where this direction is simpler, and where it is not

The ledger removes competing histories. Work activity, message trails, memory revisions and
approval provenance can share causation, typed identity and commit semantics. Debugging
“why did the Chief wake up?” becomes a trace from schedule/reply event to queued run to accepted
command. Historical replay enables deterministic checks of the state machine and later
projections without retrospectively scraping transcripts.

It does not remove current-state indexes, queue admission, access checks, version conflicts,
external effects or private claims. It adds reducer/schema compatibility, projection rebuilds,
payload lifecycle, and a difficult migration. For a local single-user product whose main need
is reliable delegation and a clear owner UI, the relational alternative is likely the smaller
implementation. This direction earns its cost when inspectable long-lived organizational
history is central to the product and replay is a capability the team will maintain and test.

Deliberate exclusions are a generic workflow DSL, arbitrary event subscriptions, hidden
completion-to-memory jobs, multiple employment parents, a second chat transcript system,
automatic permission inference from role text, vector retrieval before evidence justifies it,
automatic arbitrary external retries, a distributed event broker, and a promise that local
owner-UID processes are isolated. Group behavior remains composition of addressed messages,
shared work and records; native many-party chat semantics can be added only if a real use case
requires them. The wave_sim team does not need those extra abstractions to function.
