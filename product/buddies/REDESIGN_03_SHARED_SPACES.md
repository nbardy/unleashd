# Buddy redesign 3: shared spaces, explicit attention, durable work

> Historical alternative, not a delivery claim. The September 9 owner correction removed
> hiring quotas; requested working teams enable the background capability without starting
> runs. See the [September 10 system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md) for the
> accepted core, implemented API and remaining gaps. Earlier recipes below are retained
> as decision history where they differ.

2026-09-09 · Design alternative for review. No team has been provisioned, no email has been
sent, and this document does not declare the paused implementation complete.

This alternative makes a **shared place to do work** the center of Buddy coordination. A
Buddy publishes to a thread, records an accountable commitment, and explicitly asks another
member to pay attention. Employees work from the same durable case history, using separate
private model sessions. A final answer is a post; a completed commitment is a work transition.
They are deliberately different facts.

The important difference from the other alternatives is where continuity lives. An addressed
request/reply design puts it in a pair of conversations and their return route. An event-ledger
design puts it in an ordered history and its projections. This design puts it in an explicitly
shared space: its work, discussion, documents, evidence, and membership. There is no actor RPC
request awaiting a special reply and no requirement to event-source every domain object.

This is attractive if “run my business as a visible team” is the dominant product experience.
It is a larger departure from the current send/reply implementation, and it makes small private
questions slightly less convenient. It should win on observed collaboration needs, not because
one generic container sounds simpler than several existing tables.

Compare [typed resources](REDESIGN_01_TYPED_RESOURCES.md) and
[the event-ledger alternative](REDESIGN_02_EVENT_LEDGER.md). The first companion also contains
the [common historical-source inventory](REDESIGN_01_TYPED_RESOURCES.md#11-source-review-coverage), including the located earlier briefs and conversation
records. Historical text is evidence of requirements and previous decisions, not authority to
resume the paused implementation.

## 1. The reference business, written down

The owner wants to run a business around the repository `~/git/wave_sim` through one Project
Lead. That employee has four persistent direct reports:

| Employee | Accountable responsibility | Collaboration |
|---|---|---|
| Project Lead | Product direction, coordination, staffing within granted quotas, overall progress | Principal contact for the owner; escalates decisions and reports evidence |
| Go to Market Lead | Understand buyers, research accounts, prepare customer interviews and outbound sales | Shares findings with Product; sends interview emails only after demo videos exist and the configured sending policy permits the exact send |
| Product Lead | Turn market needs into a usable, tightly scoped product | Manages Product Engineer and Product Designer; prioritizes simulator requirements with Simulation |
| Wave Simulation Lead | Improve and validate the existing wave simulator | Receives concrete product requirements and independently validated research handoffs |
| Frontier Research Lead | Explore “sub volumetric” or “non volumetric” fluid simulation and other large reductions in computation | Keeps speculative research distinct from production commitments; hands promising, evidenced results to Simulation |
| Product Engineer | Implement bounded product changes | Reports to Product Lead |
| Product Designer | Critically test proposed use cases, keep scope tight, and improve usability | Reports to Product Lead; can request changes without silently expanding implementation scope |
| Market Research employee | Research markets, customer lists, and use cases for both GTM and Product | Has one manager, initially GTM; receives explicit assignments and case access from either authorized collaborating lead |

The five initial product segments are wave pool design, surfboard design, boat hull design,
hydrofoil design, and coastal engineering. “Coastal engineering is the biggest market” is the
owner's current hypothesis. The system should preserve that attribution until research supplies
evidence; it should not turn a role briefing into a verified market fact.

The intended sequence is research → select a narrow use case → build and validate a demo →
prepare interviews → authorize and send interview email → use responses to improve the product.
Research and draft preparation can happen before a demo. Sending customer interview email
cannot. A shared inbox location somewhere under `~/git/` has not been identified. A path in a
prompt is neither discovery of that integration nor permission to use its credentials.

Some employees should be hidden from the default top-level directory while remaining real,
discoverable staff under their manager. “Sub-Buddy” means an ordinary persistent Buddy with a
manager. A disposable provider sub-agent remains a helper within one admitted run; it has no
employee memory, hiring seat, independent schedule, or separately accountable assignment.

The earlier Chief of Staff use case also remains in scope: one employee knows the authorized
organization and projects across repositories, delegates to leads, receives completion signals
in the conversation the owner already uses, follows up when necessary, and runs recurring
check-ins. The Chief is a configured Buddy with broad explicit membership. It is not a new
runtime class and does not acquire access merely by having an impressive title.

## 2. Principles and the exact simplification

1. **One audience per space.** Work, posts, documents, notes, and artifacts in that space have
   that space's audience. Do not add private-post ACLs inside an otherwise shared channel.
2. **One employee per durable identity.** Reporting, collaboration, directory placement, and
   execution permission remain separate. Sharing a researcher does not create two identities
   or give that employee two managers.
3. **One work record per commitment.** The work record owns its status, assignee, blockers,
   dependencies, and completion evidence. A post and a successful model turn do not close it.
4. **One post stream per thread.** Each post has one author and provenance. Provider transcripts
   are execution details linked to that thread, not the public discussion itself.
5. **One admitted run per execution attempt.** Attention, a clock tick, or a relevant work
   transition can enqueue the same kind of bounded run. A run is not an employee lifetime.
6. **Explicit publication and explicit waking.** Reading a room does not wake its members.
   An `@name` in prose is text. Only typed attention targets or enabled rules create execution.
7. **Facts, instructions, and authority have different owners.** Notes record observations;
   soul and approved instructions describe behavior; grants and adapter policy authorize tools.
8. **Use finite types where the system must decide behavior.** Work dependencies, cancellation,
   memory revisioning, and external-send approvals cannot be open-ended JSON conventions.

The product atoms are **Buddy, Space, Post, Record, Run**. `Record` is a closed sum of four
meaningful shapes: work, document, note, and artifact. This is not a claim of five SQL tables.
Memberships, threads, revisions, dependency edges, wake rules, run causes, command receipts, and
adapter effect receipts are necessary bookkeeping with distinct constraints. Hiding those facts
inside `metadata` would reduce type names while increasing software complexity.

An initial release does not need arbitrary graph predicates, model-defined trigger code,
multi-manager staffing, a workflow language, a separate Chief agent type, or a universal
“execute any tool from a JSON plan” interface.

## 3. What exists, what this changes, and what remains unproved

The existing [coordination contract](PLANNING_PRIMITIVES.md) supplies generic send/reply, fresh
recipient conversations, bounded waiting, an inbox, and scoped execution. The
[staffing contract](PLANNING_SUB_BUDDIES.md) supplies persistent single-manager reports, quota,
retirement, and a canonical team projection. The [memory contract](PLANNING_MEMORY.md) supplies
CAS documents, append-only notes, bounded recall, selective capture, and scoped soul edits.
[Automation ownership](AUTOMATION_OWNERSHIP.md) already establishes the crucial rule that an
expired conversation cannot revive an expired executor.

The more recent [coordination design](DESIGN_BUDDY_COORDINATION.md) adds a durable run queue,
return wakes, conversation follow-ups, self-continuation, project gates, handoff, and concrete
approvals. There is substantial local prototype code in
[`run-executor.ts`](../../server/src/buddies/run-executor.ts),
[`buddy-coordination.ts`](../../shared/src/buddy-coordination.ts), and the package coordination
modules. The [integration handoff](../../agent_notes/2026-09-09_buddies-integration-handoff.md)
records multiple source snapshots and unfinished integration. Existing test counts certify
their particular snapshots, not this proposal or the whole current dirty checkout.

This alternative keeps the run ownership, boundedness, idempotency, CAS, staffing, and provider
seams. It changes the coordination surface and adds real content-sharing boundaries:

| Area | Existing evidence | Proposed change |
|---|---|---|
| Coordination | Message request and final reply have their own lifecycle | Shared posts communicate; work records hold tracked obligations |
| Conversations | Recipient/source threads supply routing and context | A shared thread is stable; each participating Buddy has its own execution conversation |
| Memory | Dense memory is Buddy-wide; workspace notes are readable through scoped recall | Explicit publication spaces and private memory compartments; no automatic global-memory sharing |
| User visibility | Team hierarchy and separate detail views | Space activity feeds, actionable owner inbox, and independent directory placement |
| Attention | Send/reply dispatch plus timer work | Explicit attention on posts and a narrow set of wake-rule triggers |
| Evidence | References are predominantly strings | Typed immutable artifact references with audience and digest checks |
| Dependencies | Primarily an owner's planning decision | A small, acyclic, machine-enforced completion dependency relation |
| External mail | No demonstrated shared mailbox or demo prerequisite enforcement in these contracts | Brokered resource grants, verified demo gate, concrete effect intent, and adapter-owned receipt |

Historical evidence supports retaining distinctions, not replacing everything with a feed.
The [July review](../../agent_notes/2026-07-29_buddies-design-review.md) found duplicate completion
paths and internal transport leaking into chat. The
[real-team review](../../agent_notes/2026-07-28_buddies-real-team-control-plane-redesign.md)
found that a useful employee still needed an observable control plane. The
[notification note](../../agent_notes/20260909T060112Z_01M22C33VHM2CX59JCEPD2XJS8_message-notification-boundaries_buddies-development-lead_fe6ef8cd.md)
distinguishes a header being handed to a model from that model reading or finishing work.
This design preserves those lessons: there is one durable completion operation, and a wake
receipt is never a read receipt or evidence of success.

## 4. Spaces: sharing without making every employee public

### 4.1 Three concrete space forms

| Kind | Purpose | Membership rule |
|---|---|---|
| Personal | Owner–Buddy conversation, private notes, or a Buddy's private context for a particular case | Only the named Buddy and authenticated workspace owner can read; no invitations |
| Team | Stable shared product or business knowledge, planning threads, and team-wide work | Explicit memberships; the team name is not a permission grant |
| Case | A bounded undertaking such as “wave-pool demo” or “validate reduced-order breakthrough” | Explicit selected collaborators, accountable work, and its shared evidence |

Every space belongs to exactly one workspace. A repository/workspace is still the integration
and directory boundary; a space is the finer disclosure boundary. `containerSpaceId` is optional
navigation grouping and conveys no access. Cross-workspace project programs link work, not
space inheritance. A cross-workspace Chief must receive explicit rights on both sides.

Adding someone to a team or case grants access to its existing shared history. The membership
editor states that consequence. For a smaller disclosure, publish a bounded artifact or create
a new case; do not implement “member can see only posts after Tuesday” in the first version.
Revocation removes future server access and fences affected active runs. It cannot erase facts
that a recipient already read, copied, or retained in an external provider session.

The application owner can inspect all spaces in the owned workspace, including personal ones.
“Private” means excluded from other employees and default feeds, not secret from that owner.
No implied organization-wide compliance or multi-tenant confidentiality claim is made.

### 4.2 Directory placement is a preference

The default Buddies page shows employees with no active manager plus explicitly pinned staff.
Opening a lead shows its canonical reports. Search can discover other eligible staff. A user
can pin Market Research without reparenting it; unpinning it does not revoke case membership.
Archived staff remain in historical attribution, but have no runnable directory entry.

### 4.3 One manager, several collaborators

Market Research reports to GTM for staffing and performance. Product receives `assign` rights
in selected research cases; this permits assigning work in those cases to eligible members.
It does not permit Product to change Market Research's soul, quota, manager, memberships in
unrelated spaces, or ongoing GTM priorities. Conflicting assignments stay visible in the shared
capacity view; accountable leads resolve priority with the same work operations and posts.

This intentionally changes the earlier “only a direct manager can assign” rule. Assignment
becomes a space grant to collaborate with an eligible employee; employment remains one-manager.
The owner or authorized space manager must explicitly grant that collaboration scope.

### 4.4 Private memory must have a real compartment

A Buddy-wide private memory automatically injected into every team run would let a shared
researcher carry Product-only material into GTM. This proposal therefore uses a private context
space for each `(Buddy, collaboration space)` pair that needs private working memory. It is
created lazily, has a unique pairing, and is readable only by that Buddy and the owner. The
corresponding run may read that context and its collaboration space. It does not automatically
read the same Buddy's private context from a different case.

Personal owner chats are already personal spaces and need no recursively nested context.
Soul remains the Buddy's identity document. It must contain role and style, not private client
facts that would be injected everywhere. Team-wide reusable knowledge belongs in an explicitly
shared document; it can be published into a case with provenance. Useful cross-case learning
requires deliberate promotion instead of silently broadening every future briefing.

Retain a **Buddy-wide portable long-term document** in its owner-only personal space for
general skills, durable preferences, and non-confidential lessons. This preserves the earlier
per-Buddy learning requirement instead of making every new case a total reset. The Buddy can
propose/write those lessons through CAS under its granted memory policy. They are not soul
instructions and cannot change permissions. A private case fact is not automatically portable
merely because the same employee learned it.

There are two explicit injection modes. A trusted-agent mode may inject selected portable
lessons into that Buddy's cases after an authorized promotion/publication decision; the total
long-term injection remains 4,000 characters, divided between portable and case documents.
The compiler rejects an over-budget selection and requests a bounded revision rather than
silently trimming it. A strict compartment mode omits the Buddy-wide document from shared
runs; general learning reaches another case only as an explicitly approved published document.
That mode sacrifices effortless generalization to preserve the compartment boundary. The
system cannot inspect arbitrary prose and prove that it contains no confidential information.

This adds more small spaces and a clear product concept: “private notes for this case.” It is
the cost of using one space audience consistently. An alternative per-record ACL would save
these containers but introduce a second permission mechanism. Neither is free.

## 5. Minimal durable model and invariants

Types below specify semantics, not SQL naming. IDs are opaque strings, times are UTC instants,
revisions are positive integers, and every persisted object has server-stamped creation and
update metadata. Arrays and strings have write-time bounds; they are never silently truncated.

```ts
export {}; // The contract snippets concatenate into one TypeScript module.

type Id = string;
type Instant = string;
type Revision = number;
type Key = string; // 1..128 bytes, scoped to authenticated actor and command
type Principal = { kind: 'owner'; id: Id } | { kind: 'buddy'; id: Id };
type Page<T> = { items: T[]; nextCursor: string | null };
type Ref =
  | { kind: 'post'; id: Id }
  | { kind: 'record'; id: Id; revision: Revision }
  | { kind: 'note'; id: Id } // immutable notes have no mutable revision head
  | { kind: 'run'; id: Id };

interface Buddy {
  id: Id;
  name: string;
  role: string;
  status: 'active' | 'paused' | 'archived';
  managerId: Id | null;
  hireQuota: number;
  soulRevision: Revision;
  providerProfileId: Id;
}

interface WorkspaceMembership {
  workspaceId: Id;
  buddyId: Id;
  directory: boolean;
  backgroundEnabled: boolean;
  maxActiveRuns: number;
  maxStartsPerHour: number;
  maxPendingRuns: number;
  pausedReason: string | null;
  revision: Revision;
}

type SpaceShape =
  | { kind: 'personal'; buddyId: Id; contextForSpaceId: Id | null }
  | { kind: 'team'; containerSpaceId: Id | null }
  | { kind: 'case'; containerSpaceId: Id | null };

type Space = SpaceShape & {
  id: Id;
  workspaceId: Id;
  title: string;
  revision: Revision;
  execution: 'enabled' | 'paused' | 'draining' | 'cancelled';
  executionEpoch: number;
  archivedAt: Instant | null;
};

interface SpaceMember {
  spaceId: Id;
  buddyId: Id;
  read: boolean;
  contribute: boolean; // posts, notes, and records within the authorized type policy
  assign: boolean;     // work assignment among eligible members of this space
  manage: boolean;     // work control and explicitly delegated membership administration
  revision: Revision;
}

interface Thread {
  id: Id;
  spaceId: Id;
  title: string;
  workId: Id | null;
  closedAt: Instant | null;
  revision: Revision;
}

interface Post {
  id: Id;
  threadId: Id;
  sequence: number; // monotonic within the thread, allocated transactionally
  author: Principal;
  body: string;
  evidence: Ref[];
  replyToPostId: Id | null; // same-thread reference, not a settlement or return address
  attention: Id[];         // explicit eligible Buddy IDs, frozen on insertion
  causedByRunId: Id | null;
  rootId: Id;              // server-owned causal control, not a permission
  createdAt: Instant;
}

type WorkStatus = 'backlog' | 'ready' | 'doing' | 'blocked' | 'done' | 'cancelled';
interface WorkRecord {
  kind: 'work';
  id: Id;
  spaceId: Id;
  revision: Revision;
  parentId: Id | null;
  ownerBuddyId: Id;
  title: string;
  objective: string;
  definitionOfDone: string;
  status: WorkStatus;
  blockedReason: string | null;
  nextAction: string | null;
  completionEvidence: Ref[];
  execution: 'enabled' | 'paused' | 'draining' | 'cancelled';
  executionEpoch: number;
  pendingOwnerId: Id | null;
}

interface WorkDependency {
  workId: Id;
  prerequisiteId: Id;
  createdBy: Principal;
}

interface DocumentRecord {
  kind: 'document';
  id: Id;
  spaceId: Id;
  revision: Revision;
  purpose: 'working_memory' | 'long_term_memory' | 'brief' | 'knowledge';
  title: string;
  body: string;
  stewardBuddyId: Id;
  sources: Ref[];
}

interface NoteRecord {
  kind: 'note';
  id: Id;
  spaceId: Id;
  author: Principal;
  topic: string | null;
  category: string | null; // open labels; these do not change behavior
  body: string;
  sources: Ref[];
  createdAt: Instant;
}

interface ArtifactRecord {
  kind: 'artifact';
  id: Id;
  spaceId: Id;
  revision: Revision;
  title: string;
  mediaType: string;
  byteLength: number;
  digest: string;
  storageObjectId: Id; // broker/object-store locator, not caller-supplied authority
  sources: Ref[];
  verifiedAt: Instant | null;
  withdrawnAt: Instant | null;
}

type RecordValue = WorkRecord | DocumentRecord | NoteRecord | ArtifactRecord;
```

Database constraints carry the hard semantics:

- A live Buddy has at most one manager; employment edges are acyclic. Concurrent hire quota
  includes paused employees. Renaming a Buddy never merges identities. New hiring uses a
  command key; compatibility name reuse is not the new identity rule.
- A space and its threads, posts, and records have one workspace. All invited Buddies must
  already be eligible in it. A personal space cannot have invited members.
- `UNIQUE(thread_id, sequence)` orders committed posts. They are immutable; a correction is
  another post. A redaction tombstone, if legally/operationally necessary, is owner-controlled
  and audited; it is not ordinary model editing.
- `parentId` and `WorkDependency` are distinct relations. Both are acyclic. A work record cannot
  depend on any ancestor or descendant: a parent depending on its unfinished child would
  otherwise prevent execution admitted through the parent, while a child depending on its
  unfinished parent is the inverse deadlock. Sibling dependencies are valid. Work owns status;
  parent completion is explicit rather than the conjunction of all child statuses.
- A prerequisite must be `done` to admit dependent execution. `cancelled` does not count as
  success. If a prerequisite is reopened, admission closes again; current dependent claims
  are revoked and drain. Removing or replacing the edge needs ordinary authorized CAS work
  editing. It is not achieved by placing “ignore dependency” in a post.
- A done work record requires nonempty resolvable evidence. The system verifies reference
  existence and audience, not scientific correctness. “Done” is a claim by an accountable
  employee that a reviewer or owner can reject by reopening it.
- Done work does not admit new work execution. The already-admitted completing run may still
  publish its result, read, capture permitted learning, and drain. Completion alone does not
  increment the cancellation epoch; pause/cancel/revocation still fence every scoped write.
- Document revisions and their head update are atomic CAS. Private memory retains the current
  2,000/4,000-character working/long-term caps. General briefs/knowledge documents have an
  explicit larger cap, initially 32,000 characters. Notes retain the current 16,000-byte cap.
- Artifact revisions name immutable bytes. Replacing a file creates a new artifact revision
  and digest; approvals cannot silently follow a mutable path to different content.
- Deleting an application conversation does not delete shared posts, work, or run history.
  A thread is not evidence that its linked provider transcript still exists.

### 5.1 Work hierarchy and cross-workspace programs

An accountable Project Lead can own a parent work record in a management case and create child
work in another case/workspace only with rights in both. The child owner must be eligible in
the child space. The parent stores the child's identity and approved public status projection;
it does not make every parent-space reader a member of the child's space.

Cross-space rollups require a publish rule for the selected fields, or a narrower audience on
the parent. A dependency may cross spaces only if the responsible owners can inspect the
actual prerequisite's status and evidence. A copied completion summary is evidence, not another
live work object or a substitute dependency gate. Revocation holds the dependent visibly as
`dependency_not_visible`; it must not continue from cached permission. A later read-only status
sharing capability could relax full space access, but it is not hidden inside a reference here.

All work started within an admitted work scope must retain that work or select its descendant.
An employee cannot create a new unrelated root merely to escape cancellation. Ad-hoc posts can
have no work scope, but then only their causal chain and space gate provide execution control.

The admission predicate is one shared service: current eligible identity and policy; enabled
space/work/ancestor execution gates with matching epochs; target work and all ancestors not
`done`/`cancelled`; all target/ancestor prerequisites `done` and currently readable; current
root not stopped; conversation idle and capacity reserved. A prerequisite is tested as a gate
on dependent execution, not on reading results or publishing a final result from an already
admitted completing run. If A and B are sibling tasks and B depends on A, finishing A admits B;
their parent remains open until its owner accepts the combined outcome.

Validate the **combined completion-wait graph**, not just each relation separately. Add an
edge from each parent to every non-cancelled child whose completion it requires, and from
each work item to its direct prerequisites and every prerequisite inherited from an ancestor.
Reject self-edges and cycles transactionally when changing parents, dependencies, or reopening
work. For example, A contains A1, B contains B1, A1 depends on B, and B1 depends on A: the raw
dependency edges alone are acyclic, but A → A1 → B → B1 → A deadlocks and must be rejected.
Likewise a parent's prerequisite cannot become an inherited self-dependency of its child.
The store may inspect the full authorized control graph for integrity, but a denial response
must not reveal hidden work names or contents.

Closing a parent as done requires its non-cancelled descendants to be done and no unresolved
handoff/drain, or an explicit prior reparenting of work that will continue elsewhere. It never
silently strands unfinished children behind a terminal ancestor. Reopening a done parent does
not reopen its children; the intended child is reopened explicitly. Cancelling a parent is an
explicit subtree control transition, so descendants and queued effects cannot ignore it.

### 5.2 Soul, memory, notes, logs, and transcripts

| Material | Authority | Mutable? | Shared with whom? | Used for waking? |
|---|---|---|---|---|
| Soul | Buddy identity revision | Full-document CAS, owner-directed | Owner and current Buddy; role/style used by that identity | Never by changing prose |
| Working/long-term memory | Document head in the run's private context space | Full-document CAS with history | That Buddy and owner | No |
| Shared knowledge/brief | Document head in team/case space | Steward or authorized contributor CAS | Space members | No automatic model wake |
| Observation/decision note | Append-only record | No; add correction with provenance | Space audience chosen at creation | No |
| Work state | Work record | Authorized CAS transition | Space audience or explicit published rollup | Narrow enabled work rules |
| Human/team discussion | Post stream | Append-only | Thread's space audience | Explicit attention only |
| Operational run log | Executor-owned run facts and bounded errors | Lifecycle transitions | Operator/owner; scoped summary for participants | One bounded failure signal |
| Audit | Store-stamped command/outcome metadata | Append-only | Owner, with limited subject summaries | No |
| Provider transcript | Existing conversation/session persistence | Existing transcript lifecycle | Executing Buddy and owner by default | No transcript parsing trigger |

`recall` searches selected authorized spaces and returns original source IDs and excerpts.
It does not automatically search all workspaces of a shared employee. `get_current_work` owns
task status. Memory capture saves learning only when it occurred, in the remaining current-run
budget. A note saying “send is approved” has no effect on the permission system.

The current workspace notes are not assumed private. Migration retains their historical
workspace audience, and new private notes are explicitly private-space records. Existing
filesystem projections remain disposable views; the application's state is authoritative.

Detailed notes preserve attempted approaches, failures, assumptions, alternatives, experiments,
and the author's useful rationale. They are not restricted to compressed lessons and are not
raw hidden model reasoning dumps. A long investigation can create several linked bounded notes.
The current dense documents remain a small selection of useful knowledge, and note recall is
on demand. Deleting a provider transcript must not delete an accepted result, durable lesson,
or the evidence needed to understand a commitment.

### 5.3 Optional capture after turns, without another autonomous employee

The existing behavior is selective in-turn writing plus a bounded closing capture on eligible
successful automations. Universal per-turn background capture is a proposed extension, not
something this alternative assumes already exists. Its simplest initial policy remains the
current one: write a useful note while working, and spend remaining admitted budget on capture
when that adds value. A user can choose a denser authored journal without making every provider
event a memory entry.

If the owner enables asynchronous capture, implement it as an ordinary bounded run with a
private `capture` cause, using the same queue and claim mechanism. Extend the `RunCause` union
with `{kind:'capture', threadId, fromSequence, throughSequence, policyRevision}`. The source
interval is a frozen range of eligible published posts, structured work/tool receipts, and
authorized visible transcript text; it excludes provider reasoning fields and unrelated
private sessions. The capture destination is the same private context or an explicitly
authorized shared note space. A cheaper provider/model is a policy selection, not a new agent
lifetime or wider permission.

Persist one capture cursor per `(Buddy, thread, policy)` and a unique covered interval. Queued
adjacent ranges can batch; a claimed range is immutable. Only successful capture advances the
cursor. It either writes keyed notes/document revisions or records an explicit `no_material_change`
result. A duplicate result cannot append the same note twice. Concurrent memory updates use
the existing CAS conflict response; a failed merge remains a failed capture without undoing
the actual work outcome. Empty, cancelled, failed, and capture-only runs never create another
capture cause. Rate limits, time limits, policy revocation, and manual stop apply normally.

A failed capture leaves its interval visible for bounded retry; it does not prevent unrelated
work or retry indefinitely. Archiving a thread stops future capture but retains existing notes.
Disable the feature by default until a pilot compares useful saved knowledge, private-context
leaks, noise, cost, and the owner's reading burden against ordinary selective capture.

### 5.4 Portable, Git-readable knowledge without exporting authority

The earlier request for Buddy definitions and readable memory in repositories is retained.
An owner-selected export produces a versioned manifest, profile/role, soul revision, selected
current memory documents, detailed notes, shared briefs, work/result snapshots, and artifact
manifests or explicitly chosen bytes. Markdown files retain stable portable IDs, source
revisions, authors, and provenance. The export is a snapshot: editing or committing it does
not mutate live project status, dispatch a post, or change a grant.

The export manifest identifies omitted private content, unavailable artifacts, and unresolved
references without revealing the omitted bodies. Audience selection happens before writing.
No automatic Git commit or push occurs. Audit export actions, and let the owner select where
the files should be written; a path from another Buddy's message is not a destination grant.

Never export credentials, claim tokens, active leases, runnable queue entries, local approval
capabilities, enabled schedules, granted workspace rights, or spend/headcount authority as
portable permissions. Exported rule definitions are inert proposals. External receipts may
be exported as historical evidence with sensitive addresses/bodies excluded when necessary;
importing one cannot cause another send.

Import validates the manifest, previews identity mappings and selected records, and commits
through ordinary typed services. Stable source IDs support repeat-import deduplication;
local IDs and workspace ownership remain local. Existing profiles/documents require explicit
mapping and CAS reconciliation rather than name-based overwrite. Imported notes preserve
original authorship as provenance while recording the authenticated importer separately.
Imported staff starts with no added hiring quota, background execution, grants, or enabled
rules. Imported completed work is clearly historical evidence until an owner explicitly maps
it into the live work store; it is not an executable dependency satisfied by untrusted JSON.

This is portable definition/knowledge exchange, not authenticated distributed synchronization.
It uses ordinary records and command receipts plus a manifest; it does not need a filesystem
watcher that silently treats Git edits as live instructions. Owner restore of an archived
employee preserves identity/history after quota and membership validation; rules stay disabled.
Public archived profile URLs may remain unavailable as in the current contract, while an
explicit owner history/restore view supplies recovery without reviving ordinary navigation.

## 6. Attention, rules, and execution

### 6.1 Waking is an explicit operation on durable content

Posting without `attention` records information and updates UI subscriptions. It does not run
every member. Posting with `attention: [leadId]` atomically creates the post and a cause for a
bounded run of that member in that thread. Attending to three leads creates three independently
accountable runs, not one model session that pretends to be three employees.

To resume a person on a commitment, post in its case thread and attend to the current owner.
To follow up in the same context, post again in that same thread. There is no `continueFrom`
message ID: the stable thread is the continuation address. A reply reference is presentation
and provenance, not authority to route to an otherwise private conversation.

A quick question can be a post with attention. It has no final settlement contract. If an
answer must be tracked, create a small work record such as “Assess the hydrofoil demo claim”
and post it with attention. The UI can do those two calls as one transactional `ask` form,
but it must display the resulting work item. It must not create an invisible second request
state machine. This is a real tradeoff: a durable question costs a work record.

### 6.2 Only three rule trigger forms

```ts
type Clock =
  | { kind: 'once'; at: Instant }
  | { kind: 'interval'; seconds: number; anchor: Instant }
  | { kind: 'cron'; expression: string; timezone: string };

type RuleTrigger =
  | { kind: 'clock'; clock: Clock }
  | {
      kind: 'work_transition';
      workId: Id;
      includeDescendants: boolean;
      entering: Array<'ready' | 'blocked' | 'done' | 'cancelled'>;
    }
  | { kind: 'after_run'; runId: Id; on: 'success'; notBefore: Instant };

interface WakeRule {
  id: Id;
  spaceId: Id;           // destination/control space; trigger source can be elsewhere
  workId: Id | null;     // destination execution work, not the observed source work
  revision: Revision;
  trigger: RuleTrigger;
  targetBuddyId: Id;
  targetThreadId: Id;
  prompt: string;
  enabled: boolean;
  policyRevision: Revision;
  nextDueAt: Instant | null;
  archivedAt: Instant | null;
}

type RunCause =
  | { kind: 'attention'; postId: Id; targetBuddyId: Id }
  | { kind: 'clock'; ruleId: Id; dueAt: Instant; ruleRevision: Revision }
  | { kind: 'work_transition'; ruleId: Id; workId: Id; workRevision: Revision }
  | { kind: 'after_run'; ruleId: Id; predecessorRunId: Id }
  | { kind: 'owner_input'; postId: Id }
  | { kind: 'failure'; failedRunId: Id };

interface Run {
  id: Id;
  targetBuddyId: Id;
  threadId: Id;
  executionConversationId: Id | null;
  attempt: number;
  causes: RunCause[];
  rootId: Id;
  workId: Id | null;
  readyAt: Instant;
  status: 'queued' | 'claimed' | 'running' | 'draining' |
    'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  heldReason: string | null;
  deadline: Instant | null;
  policyRevision: Revision;
  gateEpochs: Array<{ kind: 'space' | 'work'; id: Id; epoch: number }>;
  retryOfRunId: Id | null;
  startedAt: Instant | null;
  endedAt: Instant | null;
}
```

Work transition filters name a work subtree and a finite set of status entries. They cannot
evaluate user JavaScript, regex over all messages, arbitrary SQL, “whenever anything happens,”
or a model-generated condition. Editing a document does not become an implicit infinite
discussion. Further trigger types should require measured use cases and explicit semantics.

The after-run form replaces delayed self-messages. A Buddy may create at most one pending
successor for its current run, in its current thread and work scope, using its existing policy
ceiling. Success means process, event stream, and persistence all drained. A failure or cancel
holds the successor; it cannot inherit a new deadline to conceal uncertain prior effects.

A work rule's trigger source and its execution destination are different scopes. If engineer
work R completes, a rule can observe R while `rule.workId` is the lead's still-open work Q and
`targetThreadId` is the lead's original thread. The resulting run checks Q's destination gates;
R is a readable cause/evidence reference, not the new run's execution work. R being done must
not suppress the return. Creating the rule validates source reads, destination ownership,
the disclosure path, and permitted operation scope independently. A rule without destination
work is still bounded by its destination space/root, and may not strip a project association
when its creating run requires one.

Register completion rules before dispatching the child, then read current work after
registration. A result that committed before registration is found by the read; one after
registration has a durable cause. A result between registration and the read may be observed
twice, which keyed operations tolerate, rather than being lost in a subscribe/read race.

Clock/work rules default disabled. The owner can pre-authorize leads to draft and maintain
rules within a bounded policy; activation remains an explicit granted capability. A granted
after-run continuation does not need a human prompt every iteration, but consumes the same
hourly and project limits. Enabling a timer never enables a Buddy's otherwise disabled
background membership.

### 6.3 One queue and one executor

```text
post + explicit attention ─┐
work mutation + enabled rule ─┼─> atomic cause + queued run
due clock / successful predecessor ─┘             |
                                                   v
current grants + space/work gates + limits + idle session
                                                   |
                                                   v
existing Conversation runtime, scoped to this input
                                                   |
                                                   v
provider process + events + persistence drain
                                                   |
                                                   v
terminal run; work remains whatever its record says
```

Keep the existing scheduler as the single wake/admission loop. The store discovers finite
matching rules while committing a work mutation and inserts causes in the same transaction.
There is no best-effort “commit work, then notify manager” gap. Rule targets and subtree depth
are bounded at creation; a transaction never silently drops excess deliveries. Proposed
initial bounds are 16 work ancestors, 64 active work rules per space, and 32 attention targets
per post. Also cap the expanded set of rules matching any one work transition at 64, including
cross-space and ancestor watchers. Rule registration and work reparent/create validate this
bound. Reject a configuration that would exceed it before it can accept work transitions.

Causes have unique stable keys. An attention cause is `(postId, BuddyId)`; a clock cause is
`(ruleId, ruleRevision, dueAt)`; a work cause is `(ruleId, workId, workRevision)`; a successor
cause is `(ruleId, predecessorRunId)`. A normalized run-cause join table may enforce these
uniqueness constraints; it has no independent delivery-status state machine.

Queued causes may coalesce only when target Buddy, thread, policy, work scope, and causal root
match. At claim, freeze the cause list, maximum 32 per run. Further causes go to another queued
run. Do not merge unrelated causal roots merely to reduce model calls: stopping one root must
not silently cancel another team's input. Several completed child commitments can often share
one root; independent schedule roots cannot. A lead may still need two turns during a burst.

One active provider run exists per execution conversation. Different Buddies in one shared
thread have different execution conversations and may run concurrently. Different threads of
the same Buddy may run concurrently up to its limits. There is no global lock on a Buddy's
identity; document/work CAS and isolated coding worktrees handle actual shared mutations.

### 6.4 Same thread does not mean shared private model state

The binding `(BuddyId, ThreadId, contextGeneration)` resolves to an existing application
conversation with that Buddy's identity and private provider session. That is a real persisted
mapping, implemented by extending conversation links rather than inventing a new harness.
The shared thread contains published posts, not the union of every provider transcript.

When the owner is already talking to the Chief in personal thread C, a scheduled check-in or
authorized completion cause targets C. It waits until the active turn drains, then starts a
fresh restricted input in that same application conversation. Its role, soul, and permitted
context remain the Chief's. It cannot inherit owner-only staffing or sending permissions just
because an earlier human input used those capabilities.

Changes in space audience or private context generation invalidate reuse of the old provider
session for future shared turns. New execution begins with authorized durable records and
posts. Revocation cannot unteach an already-running model; it immediately revokes tool access
and drains it. The next authorized run receives a fresh session where necessary.

The runtime must record a durable run input before dispatch, reserve a conversation ID before
creation, and bind it idempotently. A missing/deleted destination is a visible hold requiring
explicit repair. It does not silently recreate a deleted owner's chat.

### 6.5 Time, limits, fairness, and no invisible resurrection

Use persisted UTC due instants. Interval schedules use an anchor; cron rules use the existing
validated parser and an explicit timezone. The UI previews the next occurrences. Define and
test daylight-saving behavior: nonexistent local times are skipped, and an ambiguous repeated
local time produces one occurrence at the first matching UTC instant. If the retained parser
cannot support that contract, reject that schedule form until it can, rather than claim it.

Missed repeated ticks coalesce into one outstanding occurrence and advance the schedule cursor
atomically. An offline server executes nothing; resuming does not replay a week's hourly
check-ins. A once rule stays due until admitted or cancelled. A manual “run now” is a separate
keyed occurrence and does not move the scheduled cursor.

Retain starting limits from the recent design: background disabled until granted, 600 seconds
per run, two active runs per Buddy, eight globally, 30 background starts/hour/Buddy, 100
attention-causing posts/hour/Buddy, and 100 pending runs/Buddy. Reserve atomically. Repeated
attempts do not reset the rolling-hour counter. Hitting a start/send limit latches background
paused until an authorized resume; accepted causes stay visible. Internal failure notices
are bounded to one per failed cause family and cannot recursively create notices.

Use oldest eligible work, with at most three consecutive owner inputs before one eligible
background input in a busy conversation. This is scheduling fairness, not preemption. Run
deadlines include setup and shutdown. Token/dollar estimates can be displayed, but they are
not enforced spending guarantees until actual providers supply measured, reliable accounting.

## 7. Authority, disclosure, and external effects

### 7.1 Permission is checked where an operation commits

The executing identity, workspace, current run, claims, lineage, and return context come from
the authenticated server binding, never model arguments. Required authority is the
intersection of current workspace grants, current space membership, object ownership/control,
the admitted run policy, and unexpired external resource policy where relevant.

| Operation | Required authority |
|---|---|
| Read shared content | Current `read` on that space and active workspace eligibility |
| Post/note/document contribution | `contribute`, allowed operation, current run/space/work gates; steward rule for curated documents |
| Assign self | Space contribution plus eligibility to own that work |
| Assign another member | `assign` in that space; recipient eligibility and quota/capacity constraints are visible |
| Pause/cancel work | Work owner or explicit space manager, within admitted control policy |
| Create/invite to shared case | Delegated `manage`; requested membership cannot exceed administrator's explicit grant ceiling |
| Add broad workspace access, staffing reparent, raise quotas | Authenticated owner API |
| Edit own soul | Existing owner-directed ordinary-chat rule; denied in background/delegated input |
| Edit another employee's soul | Owner-controlled staffing/profile surface, not a case membership privilege |
| Publish into a different audience | Read source, contribute destination, and permitted disclosure path; audience widening requires an explicit publish grant |
| Execute external action | Resource broker policy plus exact effect intent and current grants |

Reparenting staff is an owner-only acyclic employment mutation. A lead can hire within an
existing concurrent quota using the current hiring capability. Restricted/background runs do
not acquire hiring simply because space administration is permitted. Retirement fences and
drains execution, requires transfer/cancellation of open work, disables rules, and preserves
history. It never deletes an employee to erase evidence of an incomplete commitment.

### 7.2 Sharing content deliberately

`publish_record` accepts documents, notes, and artifacts. It creates a destination record with
immutable provenance to the exact source revision; it does not move the original or grant
access to unrelated source content. Notes use their immutable identity instead of a mutable
revision. Reuse of the same publication key returns the same record. A document/artifact
revision can be explicitly republished; recipients do not silently subscribe to private
future edits. Artifact bytes are referenced through the broker with the destination grant,
not a filesystem path revealed in Markdown. Work itself cannot be cloned through this tool;
a published work summary is a note linking the one authoritative work record.

A wake pointing from a case into the Chief's personal thread is permitted if the Chief can
read the source and that destination's audience is a subset of the source audience. Otherwise
the rule requires an explicit bounded publication grant and cause projection. Source titles,
customer names, and evidence IDs are content too; denied notifications must not leak them.

There is no automatic semantic detector proving a generated paragraph contains no private
knowledge. Provenance is useful evidence, not a prevention mechanism for free-text disclosure.
The practical baseline uses separate sessions and memory contexts, minimal retrieved records,
explicit publication grants, and owner-visible audit. A broadly trusted Chief may intentionally
aggregate several spaces for the owner; it must not automatically share that combined context
with every lead. A security requirement against a malicious model needs stronger process and
data-flow containment than this application alone currently provides.

### 7.3 Shared inbox is a resource, not a folder-shaped permission

External integrations use a resource registry owned by the application owner:

```ts
interface MailboxResource {
  id: Id;
  workspaceId: Id;
  connectorId: Id;
  label: string;
  credentialHandle: string; // private broker storage; never in MCP/UI JSON
  policyRevision: Revision;
}

interface MailGrant {
  mailboxId: Id;
  buddyId: Id;
  spaceId: Id;
  readThreads: boolean;
  prepareDrafts: boolean;
  send: boolean;
  dailyRecipientLimit: number;
  revision: Revision;
}

interface EvidenceRequirement {
  kind: 'available_artifact';
  artifact: { id: Id; revision: Revision; digest: string };
  mediaType: string;
}

interface MailSendPolicy {
  mailboxId: Id;
  revision: Revision;
  enabled: boolean;
  requiredEvidence: EvidenceRequirement[];
  allowedSender: string;
  recipientScopeId: Id; // an explicit approved list/policy in the mail adapter
  requireExactOwnerApproval: boolean;
}

interface MailIntent {
  id: Id;
  mailboxId: Id;
  spaceId: Id;
  createdBy: Principal;
  to: string[];
  subject: string;
  body: string;
  attachments: Array<{ artifactId: Id; revision: Revision; digest: string }>;
  argumentsDigest: string;
  policyRevision: Revision;
  evidenceDigests: string[];
  status: 'draft' | 'prepared' | 'approved' | 'sending' |
    'sent' | 'rejected' | 'cancelled' | 'unknown';
  approvalExpiresAt: Instant | null;
  providerReceiptId: string | null;
}
```

The adapter owns this effect ledger; Buddies references its receipts. Do not add a second
“email sent” boolean in work or memory and call it authoritative. A shared filesystem folder
may be the adapter's import/export view after discovery and setup, but its location does not
authorize reads or sends.

The demo prerequisite is an instance of the finite `available_artifact` requirement, not a
hardcoded Buddy workflow or `demo_ready` field. The wave_sim mailbox policy has a mandatory
video artifact requirement; its enabled form cannot omit that requirement unless the owner
explicitly changes the policy. It is enforced at the adapter's send boundary. Initially the
owner enables this sending policy only after selecting a verified, retrievable demo-video
artifact revision.
The artifact registry verifies its bytes and media type; product usefulness remains a human
or explicitly trusted review judgment. Every send rechecks that artifact revision is still
available, not withdrawn, and matches the approved digest. A task named “Make demo” marked done
or a note claiming a video exists cannot open this gate.

Preparing lists and mail drafts is allowed before the demo. `prepare_send` may report the
missing demo without sending. An intent freezes recipients, sender, subject, body, attachments,
demo digest, and policy revision. If exact owner approval is configured, an authenticated owner
decision approves only that digest before expiry. Edits invalidate approval. If the owner later
authorizes a bounded campaign policy, the adapter can enforce its exact recipient/list and
rate scope without requiring one approval per message; that authority must be explicit.

At dispatch, the broker rechecks current grant, intent digest, policy revision, demo evidence,
approval, rate reservation, cancellation, and run claim. It durably records dispatch intent
before asking the provider to send. Provider-supported idempotency keys prevent duplicate
sends where available. After an ambiguous timeout it records `unknown`, reconciles against
provider receipts, and blocks blind retry. Database transactions cannot make an arbitrary
email provider exactly-once, and cancelling after provider acceptance cannot recall an email.

No model call to `post`, no `outcome: 'approved'` string, and no forwarded owner quote can
replace the authenticated approval endpoint. Approval is an external-action capability with
exact arguments, not a special message purpose.

### 7.4 The current execution environment limits the guarantee

Current local providers execute as the owner's OS user. If a Buddy can read mailbox credentials
from disk or invoke an independently connected mail tool or unrestricted network client, it
can bypass an application send policy. Therefore “only after a demo” is enforceable for the
sanctioned mail adapter only unless all sending authority is brokered and the execution
environment removes those alternative paths.

For a strong guarantee, store credentials solely in the broker, withhold direct mail
connectors from these runs, and use OS/process or container boundaries that restrict mounts
and outbound access appropriately. Space ACLs alone also cannot hide files from an unrestricted
shell running under the owner's account. This is an implementation requirement if such
confidentiality is promised, not a feature supplied by naming records “private.”

The reference team can still operate with a trusted-agent baseline, but the UI and final
acceptance must say which guarantee was actually established.

## 8. API and MCP contract

### 8.1 Transport and errors

One domain service backs owner HTTP and Buddy MCP. All mutations require a key. HTTP carries
it in `Idempotency-Key`; MCP includes `key`. Receipts are scoped to the authenticated principal,
workspace, operation, and key. An identical payload replay returns its original result; a
changed payload returns `KEY_CONFLICT`. Authorization is rechecked before returning sensitive
replayed content. A receipt never grants an actor access after revocation.

CAS operations require `baseRevision`. A stale response returns the current authorized
revision/content so the caller can reconcile and retry with a new command key. All model-facing
schemas are strict objects; unknown control fields are rejected. Read pagination defaults to
20 and caps at 100, with stable cursor ordering. Search is bounded and cannot return hidden
counts or titles from unauthorized spaces.

Common error variants are `SCOPE_DENIED`, `REVISION_CONFLICT`, `KEY_CONFLICT`, `DEPENDENCY_OPEN`,
`DEPENDENCY_NOT_VISIBLE`, `GATE_PAUSED`, `STALE_EPOCH`, `MEMBER_REVOKED`, `LIMIT_PAUSED`,
`DESTINATION_MISSING`, `RUN_INTERRUPTED`, `EVIDENCE_INVALID`, `GATE_REQUIRED`,
`APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, and `EXTERNAL_OUTCOME_UNKNOWN`.

### 8.2 Shared TypeScript service signatures

The following contract defines the public arguments. `Context` and private executor arguments
are supplied by adapters; they are never accepted from a model or arbitrary HTTP JSON.

```ts
interface Context { /* authenticated actor, workspace, run policy; private */ }
interface Write<T> { value: T; replayed: boolean }
interface Transition { id: Id; state: 'complete' | 'draining'; affectedRunIds: Id[] }
interface QueryPage { cursor?: string; limit?: number }
type PublishableRecord = DocumentRecord | NoteRecord | ArtifactRecord;
type PublicationSource =
  | { kind: 'note'; id: Id }
  | { kind: 'document' | 'artifact'; id: Id; revision: Revision };

type NewSpace =
  | { kind: 'personal'; title: string }
  | { kind: 'team' | 'case'; title: string; containerSpaceId?: Id;
      members: Array<{ buddyId: Id; contribute: boolean; assign: boolean; manage: boolean }> };

type NewRecord =
  | { kind: 'work'; title: string; objective: string; definitionOfDone: string;
      ownerBuddyId: Id; parentId?: Id; prerequisiteIds?: Id[] }
  | { kind: 'document'; title: string; purpose: DocumentRecord['purpose'];
      body: string; sources?: Ref[] };

type WorkEdit =
  | { kind: 'content'; title?: string; objective?: string; definitionOfDone?: string;
      blockedReason?: string | null; nextAction?: string | null }
  | { kind: 'status'; status: WorkStatus; evidence?: Ref[]; reason: string }
  | { kind: 'dependencies'; prerequisiteIds: Id[] }
  | { kind: 'reparent'; parentId: Id | null; reason: string }
  | { kind: 'control'; execution: 'enabled' | 'paused' | 'cancelled'; reason: string }
  | { kind: 'handoff'; ownerBuddyId: Id; reason: string };

type SpaceEdit =
  | { kind: 'title'; title: string }
  | { kind: 'control'; execution: 'enabled' | 'paused' | 'cancelled'; reason: string }
  | { kind: 'archive'; reason: string };

type Search =
  | { kind: 'buddies'; workspaceId?: Id; query?: string }
  | { kind: 'spaces'; workspaceId?: Id; query?: string }
  | { kind: 'work'; spaceIds: Id[]; ownerBuddyId?: Id; parentId?: Id; statuses?: WorkStatus[] }
  | { kind: 'notes'; spaceIds: Id[]; pattern: string; since?: Instant }
  | { kind: 'runs'; spaceIds: Id[]; buddyId?: Id; workId?: Id; rootId?: Id }
  | { kind: 'attention'; spaceIds: Id[]; after?: string };

interface AttentionSummary {
  id: Id;
  kind: 'attention' | 'open_work' | 'failure' | 'owner_decision';
  spaceId: Id;
  source: Ref;
  summary: string;
  createdAt: Instant;
}
interface SearchResults {
  buddies: Buddy;
  spaces: Space;
  work: WorkRecord;
  notes: NoteRecord;
  runs: Run;
  attention: AttentionSummary;
}

interface BuddySpaceService {
  find<K extends Search['kind']>(ctx: Context,
    arg: Extract<Search, { kind: K }> & QueryPage): Promise<Page<SearchResults[K]>>;
  getSpace(ctx: Context, arg: { spaceId: Id }): Promise<Space>;
  getThread(ctx: Context, arg: { threadId: Id } & QueryPage): Promise<Page<Post>>;
  getRecord(ctx: Context, arg: { recordId: Id; revision?: Revision }): Promise<RecordValue>;

  createSpace(ctx: Context, arg: { workspaceId: Id; space: NewSpace; key: Key }): Promise<Write<Space>>;
  editSpace(ctx: Context, arg: { spaceId: Id; baseRevision: Revision;
    edit: SpaceEdit; key: Key }): Promise<Write<Space> | Transition>;
  createThread(ctx: Context, arg: { spaceId: Id; title: string; workId?: Id; key: Key }): Promise<Write<Thread>>;
  post(ctx: Context, arg: { threadId: Id; body: string; evidence?: Ref[];
    replyToPostId?: Id; attention?: Id[]; key: Key }): Promise<Write<Post>>;

  createRecord(ctx: Context, arg: { spaceId: Id; record: NewRecord; key: Key }): Promise<Write<RecordValue>>;
  editWork(ctx: Context, arg: { workId: Id; baseRevision: Revision;
    edit: WorkEdit; key: Key }): Promise<Write<WorkRecord> | Transition>;
  saveDocument(ctx: Context, arg: { documentId: Id; baseRevision: Revision;
    body: string; sources: Ref[]; reasoning: string; key: Key }): Promise<Write<DocumentRecord>>;
  appendNote(ctx: Context, arg: { spaceId: Id; topic?: string; category?: string;
    body: string; sources?: Ref[]; key: Key }): Promise<Write<NoteRecord>>;
  publishRecord(ctx: Context, arg: { source: PublicationSource;
    destinationSpaceId: Id; reason: string; key: Key }): Promise<Write<PublishableRecord>>;

  createRule(ctx: Context, arg: { spaceId: Id; workId?: Id; trigger: RuleTrigger;
    targetBuddyId: Id; targetThreadId: Id; prompt: string; key: Key }): Promise<Write<WakeRule>>;
  updateRule(ctx: Context, arg: { ruleId: Id; baseRevision: Revision;
    change: { kind: 'disable' } | { kind: 'replace'; trigger: RuleTrigger;
      targetThreadId: Id; prompt: string }; key: Key }): Promise<Write<WakeRule>>;
  stop(ctx: Context, arg: { target: { kind: 'run' | 'root' | 'space' | 'work'; id: Id };
    reason: string; key: Key }): Promise<Transition>;
  retry(ctx: Context, arg: { runId: Id; reason: string; key: Key }): Promise<Write<Run>>;
}
```

`find` returns the validated result shape for its discriminant, never an unvalidated response
blob. `NewRecord` can likewise use discriminated overload results while retaining one creation
transaction. Keep these Zod types at the current shared boundary.

Work control/handoff is a discriminated edit, preventing an `ownerId` change from accidentally
ignoring unrelated content edits in the same request. Updating dependency sets is transactional
and checks cycles plus all affected gate epochs. Owner APIs use the same validators.
Reparenting is an owner-controlled structural transition: validate both scopes, fence and drain
the affected subtree, then atomically change the parent after cycle checks. It cannot be used
by an ordinary project-bound run to detach itself from a stopped ancestor. Space pause/cancel
uses the same fence/drain service; resume enables only newly validated inputs. Space archive
first cancels/drains and leaves records available through the owner's history view. Closing a
discussion thread is a presentation/archive action only after its outstanding causes are
settled or explicitly stopped; it cannot be a way to lose open work.

Artifact registration is a separate broker upload/import boundary: reserve an upload, ingest
bytes from an authorized resource, verify digest/type/size, then commit the `ArtifactRecord`.
`register_artifact({path: ...})` is not sufficient for confidentiality or immutability.

```ts
type ArtifactSource =
  | { kind: 'upload'; uploadId: Id }
  | { kind: 'resource_object'; resourceId: Id; objectId: Id; version: string };
interface ArtifactIngest {
  id: Id;
  status: 'verifying' | 'complete' | 'failed';
  artifact: ArtifactRecord | null;
  error: string | null;
}

declare function reserve_artifact_upload(input: {
  spaceId: Id; mediaType: string; byteLength: number; expectedDigest: string; key: Key;
}): Promise<{ uploadId: Id; uploadRoute: string; expiresAt: Instant }>;
declare function ingest_artifact(input: {
  spaceId: Id; source: ArtifactSource; title: string; expectedDigest: string;
  sources: Ref[]; key: Key;
}): Promise<ArtifactIngest>;
declare function get_artifact_ingest(input: { ingestId: Id }): Promise<ArtifactIngest>;
```

The returned upload route is authenticated and scoped to that reserved upload/size; it is not
a resource credential or arbitrary URL fetch capability. Browser uploads stream bytes there.
A Buddy can instead ingest an object from a registered workspace-file or media resource it can
read. That broker validates the registered root, resolved path/object version, permissions,
and symlinks before copying bytes to immutable storage; model-provided `objectId` cannot name
an unregistered local file. Verification runs without a long-held SQLite transaction. Final
artifact commit rechecks authority and gate epochs, so revocation during ingestion cannot
publish it. Failure records an ingest result and exposes no approval-quality artifact.

### 8.3 Model-facing tools

Expose specific names for semantic clarity while reusing the service above:

| MCP tool | Signature / mapping |
|---|---|
| `list_buddies` | `{workspaceId?, query?, cursor?, limit?}` → `find(kind:'buddies')` |
| `list_spaces` | `{workspaceId?, query?, cursor?, limit?}` → `find(kind:'spaces')` |
| `get_space` | `{spaceId}` |
| `get_thread` | `{threadId, cursor?, limit?}` |
| `get_record` | `{recordId, revision?}` |
| `get_current_work` | `{spaceIds, ownerBuddyId?, parentId?, statuses?, cursor?, limit?}` |
| `get_inbox` | `{spaceIds, after?, cursor?, limit?}` → attention/open work/failure projection |
| `create_space` | `{workspaceId, space:NewSpace, key}` |
| `update_space` | `{spaceId, baseRevision, edit:SpaceEdit, key}`; only explicitly granted space management contexts |
| `create_thread` | `{spaceId, title, workId?, key}` |
| `post` | `{threadId, body, evidence?, replyToPostId?, attention?, key}` |
| `new_project` | `{spaceId, title, objective, definitionOfDone, ownerBuddyId, parentId?, prerequisiteIds?, key}` → work record |
| `update_project` | `{workId, baseRevision, edit:WorkEdit, key}` |
| `create_document` | `{spaceId, title, purpose, body, sources?, key}` → `createRecord(kind:'document')`, steward defaults to authenticated Buddy |
| `save_document` | `{documentId, baseRevision, body, sources, reasoning, key}` |
| `remember_note` | `{spaceId, topic?, category?, body, sources?, key}` |
| `recall` | `{spaceIds, pattern, since?, cursor?, limit?}` |
| `publish_record` | `{source:PublicationSource, destinationSpaceId, reason, key}` |
| `set_wakeup` | create/update discriminated arguments from the service; never an arbitrary tool callback |
| `get_wakeups` | `{spaceId, targetBuddyId?, cursor?, limit?}` |
| `get_runs` | `{spaceIds, buddyId?, workId?, rootId?, cursor?, limit?}` |
| `stop` / `retry_run` | exact target/run signatures above |

Keep `get_soul`, `update_soul`, `hire_direct_report`, and `retire_direct_report` with their
current bounded signatures and authority rules. `update_memory({doc, content, reasoning,
baseVersion, key})` can remain the ergonomic tool: it resolves the current run's working or
long-term document in the correct private context. The model cannot choose another Buddy or
an arbitrary memory path. Shared knowledge is an explicit document save/publication.

Grant `ingest_artifact` and `get_artifact_ingest` through the same scoped broker MCP boundary;
the owner/browser upload reservation is available only when its input channel can actually
supply bytes. Only grant mail tools when the resource exists and the run's policy allows them:

```ts
interface MailThreadSummary {
  id: Id;
  providerThreadId: string;
  subject: string;
  correspondents: string[];
  updatedAt: Instant;
}
interface MailThread extends MailThreadSummary {
  messages: Array<{
    providerMessageId: string;
    from: string;
    to: string[];
    receivedAt: Instant;
    body: string;
    attachments: Ref[];
  }>;
}

declare function mail_list_threads(input: {
  resourceId: Id; cursor?: string; limit?: number;
}): Promise<Page<MailThreadSummary>>;
declare function mail_get_thread(input: { resourceId: Id; threadId: Id }): Promise<MailThread>;
declare function mail_prepare(input: {
  resourceId: Id; spaceId: Id; to: string[]; subject: string; body: string;
  attachments: Array<{ artifactId: Id; revision: Revision }>; key: Key;
}): Promise<MailIntent>;
declare function mail_send(input: { intentId: Id; key: Key }): Promise<MailIntent>;
declare function mail_get_intent(input: { intentId: Id }): Promise<MailIntent>;
```

`MailThreadSummary` and `MailThread` are the adapter's validated public shapes with provider
IDs, correspondents, timestamps, message bodies, and authorized attachment references; they
never include credentials. The adapter has its own schema package rather than expanding
Buddy's core `Record` union for every external service.

There is intentionally no `send`, `reply`, `delegate`, `review`, `join_team`, `chief_check`,
`run_workflow`, or public `claim_run` in the new preferred surface. Legacy send/reply remains
an adapter during migration. Review is a work item and posts; ordinary questions are posts.
The public tool count is not the optimization objective: fewer competing meanings and shared
validation matter more than replacing typed operations with a single giant generic mutation.

### 8.4 Owner-only and private host endpoints

Owner HTTP, with authenticated workspace ownership, supplies:

```text
PATCH /api/buddies/:id/employment      {baseRevision, managerId, key}
PATCH /api/buddies/:id/workspaces/:id  {baseRevision, grantsAndLimits, key}
PUT   /api/spaces/:id/members/:buddyId {baseRevision, rights, key}
POST  /api/wakeups/:id/enable          {baseRevision, policyRevision, key}
POST  /api/runs/:id/repair-destination {threadId, reason, key}
PUT   /api/resources/:id/mail-policy  {baseRevision, policy:MailSendPolicy, key}
POST  /api/mail-intents/:id/decision  {decision:approve|reject, argumentsDigest, expiresAt, key}
POST  /api/buddy-exports             {workspaceId, selection, destination, key}
POST  /api/buddy-imports/preview     {manifestUploadId, workspaceId}
POST  /api/buddy-imports             {previewId, mappings, expectedRevisions, key}
```

Export/import `selection` is a strict union of selected Buddy IDs, space IDs, document/note
IDs, artifact choices, and explicit private-content inclusion. `destination` is an
owner-authorized export resource, not a model-selected arbitrary path. Import `mappings`
explicitly map portable identities to existing/new local identities; `expectedRevisions`
cover every existing object to be changed. The preview freezes its manifest digest and expires;
changing bytes requires a new preview. Resource administration is not exposed to ordinary
background MCP callers.

Profile/soul/quota and Builder owner operations remain existing resources. Creation from an
owner's authorized Builder conversation is not a blanket grant to later background messages.
The Builder previews staff, management edges, spaces, memberships, rules, resource needs, and
which steps are configured versus awaiting credentials or activation. This design task itself
does none of those mutations.

The private executor port has no MCP equivalent:

```ts
declare const hostBoundary: unique symbol;
type HostDrainProof = { readonly [hostBoundary]: 'drained' };
type HostStopProof = { readonly [hostBoundary]: 'stopped' };
type Authority = { readonly [hostBoundary]: 'current-authority' };
interface PrivateClaim {
  run: Run;
  claimToken: string;
  hostEpoch: number;
}

declare function claimNext(input: { hostId: Id; now: Instant }): PrivateClaim | null;
declare function heartbeat(input: { runId: Id; claimToken: string; hostEpoch: number }): void;
declare function bindConversation(input: { runId: Id; claimToken: string; conversationId: Id }): void;
declare function assertCurrent(input: { runId: Id; claimToken: string; operation: string }): Authority;
declare function requestDrain(input: { runId: Id; reason: string }): void;
declare function finish(input: {
  runId: Id; claimToken: string; outcome: 'succeeded' | 'failed' | 'cancelled';
  drainProof: HostDrainProof;
}): void;
declare function recoverInterrupted(input: { runId: Id; confirmedExecutorStopped: HostStopProof }): void;
```

`PrivateClaim`, `Authority`, and the host proofs contain server-owned policy, lease/fencing,
provider-process and event/persistence completion facts. They are not strings a model can
manufacture. Claim tokens never appear in public projections, prompts, argv, audit bodies,
or copied transcripts. Existing private control/MCP binding carries the current input claim.

## 9. Cancellation, recovery, handoff, and consistency

### 9.1 Idempotency and crash points

Post insertion, exact attention causes, audit, and command receipt commit together. Work CAS,
dependency validation, matching rule causes, audit, and receipt commit together. Duplicate
mutations therefore cannot create a second assignment or wake merely because the caller lost
the response. A clock transaction inserts its occurrence and advances its cursor together.

The provider process is outside the database transaction. A claim fences all model-facing
store and broker operations, and launch performs one final authority check. If the server
crashes after a provider may have performed an effect, the run becomes visibly interrupted.
Lease expiry alone is not proof of process death and does not permit another executor to
adopt the run. Confirm shutdown/drain or present an operator recovery state; then an explicit
retry creates a new attempt under current grants and epochs.

A succeeded run says only that its admitted execution ended successfully. Open work stays
open, a blocked dependency stays blocked, and an answer post is not fabricated. A posted
result survives a later provider error; the thread shows the result and the failed run as
separate evidence. No error handler silently rewrites completed work to conceal that sequence.

### 9.2 Scope stop and drain

Stopping a run revokes its claim immediately, requests provider cancellation, and remains
`draining` until process, event consumption, and session persistence stop. Stopping a work
subtree or space first increments its gate epoch in the same transaction that blocks new
claims and child creation. All descendants check ancestor epochs before every mutation.
Only then does the host drain affected executors. A stop response requiring drain returns
202/`Transition`, not a false “everything stopped” success.

Stopping an ad-hoc causal root fences descendants of that root, including after-run rules.
Human inputs and independent clock occurrences create independent roots; a project/work gate
is the way to stop all those roots together. Root IDs do not serve as access grants.

Pausing preserves content and obligations; old queued causes are held as stale. Resuming
allows newly validated work but does not replay uncertain attempts. Cancelling additionally
cancels pending causes and disables affected rules. Completed records and provider receipts
remain historical. If some external effect already crossed its broker boundary, the UI says
that it may or did occur despite cancellation.

### 9.3 Transfer a commitment without becoming another employee

Handoff is a CAS `WorkEdit` with a target owner and reason. Validate the new owner's membership,
then persist `pendingOwnerId`, fence and drain the affected subtree, and block new descendants
during the transition. On confirmed drain, one transaction changes ownership, clears the
pending owner, records an audit/post annotation, and creates attention for the new owner in
the same shared case thread. Explicitly owned child commitments keep their owners.

No request is secretly rewritten as if a different employee authored it. There is no old
private session to hand over: the new owner reads the case history and starts its own session.
The former owner's private memory/transcript is not transferred. A needed private detail
requires deliberate publication by an authorized party.

Queued causes proven never dispatched can be revalidated after handoff; interrupted causes
remain held for explicit inspection/retry. Rules directed to the old owner on the transferred
work are disabled and shown for review, rather than silently acquiring the new owner's
authority. Failure to drain leaves a durable transition an operator can complete later.

## 10. Operation chains: constructing the whole behavior

These are compositions, not additional workflow implementations. IDs are abbreviated examples.
Each mutating call uses a stable command key and an actual current revision.

### 10.1 Set up the business once

1. Owner/authorized Builder creates Project Lead and four direct reports, then Product Engineer,
   Product Designer, and Market Research under the chosen managers. It checks quotas and
   preserves any existing identities instead of hiring duplicates by accident. Before each
   hiring step, the owner-authorized setup sets Project Lead's quota to four, Product Lead's
   to two, and GTM Lead's to one; the other new employees retain zero. Creating the parents
   first does not itself fund hiring. An existing Chief, if made Project Lead's manager, needs
   its own explicit available seat and the owner-controlled reparenting/creation step.
2. Create a wave_sim team space with the Project Lead and the four leads. Publish the product
   goals and five market hypotheses as a shared brief with the owner's message as provenance.
3. Create Product and GTM team spaces plus a research collaboration case. Market Research
   remains a GTM employee and receives selected case memberships; Product receives assignment
   authority in that collaboration case. It gains no general access to GTM's inbox.
4. Set subordinate directory placement through the existing manager tree; pin only desired
   top-level entries. Give the Project Lead the required work/space reads, not implicit access
   to every subordinate's private transcript.
5. Create a personal owner–Project Lead thread and optional Chief management thread. Draft
   recurring checks and enable only the agreed background policies.
6. Discover the actual shared inbox integration through authorized owner setup, register a
   mailbox resource, and grant research/drafting separately from sending. Leave the demo-send
   policy closed until its artifact prerequisite is satisfied.

The Builder returns these concrete resources and missing configuration. The app never claims
that a filesystem directory or disabled schedule is a working email system or running team.

### 10.2 Choose the first narrow product use case

```text
Project Lead: new_project("Choose first demo", owner=Product, space=discovery)
Project Lead: post(discoveryThread, work ref, attention=[Product, GTM])
Product: new_project("Test buyer workflow", owner=Designer, parent=demoChoice)
GTM: new_project("Find evidence for buyer segments", owner=MarketResearch, parent=demoChoice)
Both: post(case thread, bounded requests, attention=[respective employee])
Designer: append_note(critical usability analysis, sources)
Researcher: append_note(customer evidence and uncertainty, sources)
Each: update_project(status=done, evidence=[note refs])
Rule: work_transition(done/blocked under demoChoice) -> wake Project Lead's chosen thread
Project Lead: inspect results; save_document(narrow demo brief); explicitly close demoChoice
```

A Designer objection can keep the work blocked or lead to a revised brief. No numeric score
automatically tells the engineer to implement every suggestion. The owner remains able to
choose a different segment; “largest market” is not a hardcoded prioritization rule.

### 10.3 Chief → lead → engineer → review → revision

The Chief creates an owned program and child work for the appropriate leads, then posts with
attention in the relevant shared cases. A lead creates engineer work and a review commitment.
The review work depends on the engineer's implementation being done; neither a casual “done”
post nor the engineer's model process ending releases that dependency.

When the engineer marks work done with a commit, test result, and demo artifact, a configured
work rule wakes the lead or reviewer. They inspect the exact artifact revision. If changes
are needed, the authorized lead reopens the implementation and posts concrete changes with
attention to the engineer in the same case thread. The engineer gets a fresh run in its own
existing thread-bound conversation. Review observations remain visible; no separate review
table, final-message parser, or privileged reviewer identity is needed.

After acceptance, the lead closes its commitment with evidence. A narrow work rule wakes the
Chief in the original personal thread. The Chief reads the shared results it is authorized to
read, waits for other work if necessary, and explicitly closes the parent. A lead ending a
turn while engineers work is healthy; there is no unanswered request to terminalize falsely.

### 10.4 Frontier research becomes simulation work

Frontier Research owns a research case with hypotheses, assumptions, derivations, experiment
code, numerical comparisons, and explicit failure notes. A mathematical idea is not marked
production-ready merely because a model finds it exciting. Its definition of done requires
the agreed evidence, limitations, and independent checks appropriate to the claimed result.

When there is a credible candidate, Frontier publishes a pinned handoff document and artifacts
to a Simulation case using an authorized publication path. Simulation owns a new validation
commitment, not the old researcher's private notebook. It can ask Frontier to clarify by a
shared post with attention. If results fail validation, the validation work stays blocked or
closes as a documented negative result according to its definition of done; the production
integration commitment remains dependent on a separate accepted validation commitment.

The specific mathematics is not designed here. The system preserves provenance and distinctions
among hypothesis, observed experiment, accepted validation, and shipped behavior so the leads
can make those judgments without adding a special “research breakthrough” workflow type.

### 10.5 Shared Market Research without leaking private context

Product opens a product-use-case research commitment in the agreed collaboration space and
assigns Market Research using its `assign` grant. GTM separately assigns account research in
its own case. The employee sees both commitments in its private owner-visible capacity view,
but executes each in its distinct thread/session and private context space.

It publishes a reusable market finding into the shared research case only when the source
audience/publish grant permits. Product does not get the full GTM mail archive or private
notes because the same identity worked on both. If both leads request urgent work, the
researcher posts the conflict and asks its manager to prioritize; the scheduler limits run
concurrency but does not invent business priority from arrival order.

### 10.6 Demo video gates customer interviews

```text
GTM: research prospects and prepare mail drafts; no send capability used
Product/Simulation: implement and validate a selected demo
Artifact broker: ingest demo video, verify immutable bytes/type, return artifact revision
Owner or configured authorization flow: select that exact demo in mail policy
GTM: mail_prepare(... exact recipients/body/attachments ...)
Adapter: freeze intent and expose gate/approval state
Owner: approve exact intent digest if that policy requires per-send approval
GTM in a fresh valid run: mail_send(intentId)
Adapter: recheck demo + policy + grant + approval + cancellation + rate; dispatch/reconcile
GTM: attach mail receipt to interview work; no copied "sent" fact in memory
```

Customer responses enter the broker's authorized inbox and can be imported as bounded case
notes or evidence. An inbound email does not automatically grant a customer authority over
the team. A configured polling rule wakes GTM to inspect relevant responses; an authenticated
connector webhook may produce the same kind of cause later, but a generic external webhook
trigger is not part of the initial core rule language.

### 10.7 Recurring Chief check in the current conversation

Create a clock rule with target Chief and the existing personal thread C. Its prompt says to
query authorized open work, blocked dependencies, recent completion evidence, unanswered
tracked commitments, failures, and pending owner decisions. It posts an owner summary only
when something material needs attention and uses case posts to steer leads.

Immediate completion rules handle timely results. The clock catches missing explicit
completion, blocked work, and stale coordination. No scanner reads every private transcript
looking for a final assistant message. The model decides whether a follow-up is useful; the
system guarantees the durable inputs and limits, not good management judgment.

A tick while the Chief is talking to the owner waits. A due check does not insert the full
team payload into an owner-privileged active run. Optional UI/allowed-tool headers can say
that new work is waiting, but that does not consume the queued input or claim the Chief read
it. Once the turn drains, a new restricted run resumes C.

### 10.8 Long solo task and ephemeral helpers

An engineer saves a checkpoint in canonical work and may append a learning note. It creates
an `after_run` rule for itself, same thread, same work, with an earliest continuation time.
After successful drain, the rule produces one new bounded run. Reaching rate or project
limits holds it visibly. A crash creates an interrupted attempt and does not release it.

Within one admitted run, the provider may offer ephemeral sub-agents to inspect tests or
compare alternatives. Their work shares the parent's authority and deadline; they do not
hire employees or become independent durable authors. The parent owns the published result
and evidence. Persistent responsibilities require an ordinary Buddy and work assignment.

### 10.9 Stop, handoff, absence, and escalation

The owner pauses the wave-pool program. Its epoch fences all child work and rules even when
several separate clock/post roots are involved. The UI shows draining until active providers
actually stop. Already accepted emails remain recorded as sent; queued drafts stay unsent.

If a lead leaves, handoff drains the subtree, assigns the new lead, and wakes that employee
in the shared case. Private memory is retained with the old identity. If a question needs
owner input, create a tracked decision commitment visible in the owner's inbox and post its
question in the owner thread through an authorized publication path. A prose decision can
close ordinary planning work; an executable external approval still uses its authenticated
exact-action boundary.

## 11. UI and information architecture

The owner lands on a compact team view: top-level employees, selected spaces, outstanding
decisions, blocked work, active runs, and recent material results. It is a projection, not a
second durable inbox or copied project database. Different tabs answer different questions:

| View | Shows | Does not imply |
|---|---|---|
| Team | Reporting tree, pinned entries, paused/archived history | Access to every private conversation |
| Spaces | Shared team/case content and explicit audience | Everyone in the workspace may read it |
| Work | Owners, status, dependencies, evidence, control state | A completed provider turn equals completed work |
| Threads | Published human/team posts, attention targets, linked run summaries | Shared raw model reasoning or an agent swarm in one provider session |
| Memory | Private context documents, shared knowledge, sources and revisions | An instruction hidden in a note is authorized |
| Runs | Queued/running/draining/failed/interrupted attempts and actual causes | A dispatched attention request was understood |
| Owner inbox | Decisions, tracked work needing owner input, exceptions | Every internal post deserves a top-level notification |
| Resources | Mailbox grants, demo gate, pending exact intents, receipt/unknown state | A folder path is a configured integration |

Thread composer defaults to no automatic wake for ordinary notes. An “Ask for attention” field
names eligible employees and previews whether execution is enabled. A “Track an answer” option
creates visible work with an owner and definition of done. Posting an answer shows whether
related work remains open; it does not silently auto-complete it.

Every space header shows its audience, including the owner's inspection right. Publishing
shows source/destination audiences and the exact content/revision being shared. The app does
not label an entire case “private” while allowing a shared resource panel to leak its mail.

Work controls distinguish status from execution pause. Handoff displays old owner, proposed
owner, affected active runs, and whether it is still draining. Interrupted runs expose explicit
retry and destination repair; no spinner suggests that an unowned provider will recover itself.

Keep the existing desktop/mobile shared Buddy components, routed sections, derived atoms,
single WebSocket bridge, and separated streaming state. A shared thread's post stream is
structural state; a private running model's deltas stay in the current streaming buffer and
only become shared if explicitly published. Conversation links remain availability-checked
against actual known conversations. Missing raw transcripts do not erase the shared case.

## 12. Migration from the baseline and paused prototype

This is a staged replacement, not a reason to discard working run ownership or rewrite the
provider harness. First freeze and review a reproducible application/package snapshot. The
current integration note warns that the main installed archive and newer source worktree can
differ; the design review must not merge them by copying entire dirty files or downgrading a
schema. Preserve existing tests and all historical state.

1. **Introduce spaces without changing execution.** Create historical workspace-sharing spaces
   for existing workspace notes/work. Preserve the actual historical audience; do not turn
   shared notes private retroactively or expose formerly private transcripts to a team. Create
   personal owner-chat spaces and explicit conversation link mappings.
2. **Add typed artifacts and publication.** Initially support only existing local/brokered
   sources that can be verified. Preserve old string evidence as `legacy_reference` display
   material until explicitly resolved; do not fabricate digests or approval-quality evidence.
   New gate-dependent actions require the new verified artifact references.
3. **Add thread posts and attention through the existing queue.** Map new inputs into the
   existing run executor; preserve claim tokens, per-input policy, drain, idempotency, and
   failure behavior. Do not add a second scheduler or a second provider process owner.
4. **Migrate work into cases incrementally.** Retain IDs, revisions, owners, evidence, and
   existing project gates. Add dependency edges only when explicitly selected. Existing
   untracked questions remain untracked posts; never create a million artificial tasks from
   every historical sentence.
5. **Handle outstanding old requests once.** For each unresolved request that really requires
   a result, create one visible lightweight work item and case/thread representation with its
   original participants and provenance. Mark the old row as migrated and store a stable ID
   mapping. A compatibility reply atomically completes that mapped obligation and publishes
   a post; it cannot also run the old return dispatcher. Settled history remains readable.
6. **Do not bulk-share private request sessions.** Import only the original request and final
   public reply that both parties already had rights to read. Keep raw source/recipient
   transcripts as private execution links. Imported posts have historical authors plus an
   importer audit record, never pretend to be newly written by an employee.
7. **Move recurring checks and self-continuation onto finite rules.** Existing prompt schedules
   can map to clock rules with the same authority. Preserve older loop/sequence automations
   on the one executor until explicitly migrated. Do not silently reinterpret their stopping
   conditions or enable them during migration.
8. **Compartmentalize memory deliberately.** Existing Buddy-wide dense memory becomes sealed
   legacy identity memory readable by that Buddy/owner for migration. Newly scoped shared runs
   do not auto-inject it wholesale. The owner/Buddy promotes safe material into the proper
   private context or shared knowledge document with provenance. Existing personal chats can
   retain their startup snapshot, but must not become shared execution sessions unchanged.
9. **Add the mailbox broker only after resource discovery.** Inventory actual credentials and
   bypass paths. Configure demo gates and approval scope; verify with a fake/isolated provider
   before any owner-authorized real send. The current design request is not send authority.
10. **Switch preferred tooling and UI together.** New chats receive the space tools; legacy
    conversations retain compatibility until their open obligations are reconciled. Remove
    the old active request/reply dispatcher only after zero unmapped open requests remain.

A schema migration must preserve IDs, historical authors, private claims' secrecy, and
foreign-key integrity. Migration can be replayed idempotently. Its rollback is a tested backup
and restoration of a stopped instance, not a downgrade script applied while newer writers are
active. A failed migration leaves a visible maintenance condition and the last valid data.

## 13. Acceptance tests and actual readiness

The primary fixture should be one real temporary store, authenticated public/private service
boundaries, the actual conversation runtime, and a deterministic provider. It represents the
wave_sim team plus a Chief in a second workspace. Avoid mock-only proof of forwarding and
source-text assertions about UI.

| Scenario | Required observable result |
|---|---|
| Team creation/retry | One identity per intended employee, acyclic manager tree, quota preserved, duplicate keys do not hire twice |
| Shared Market Research | One manager; authorized Product assignment succeeds; unauthorized staffing/private-source access fails |
| Directory placement | Hiding/pinning changes the projection without changing grants or manager edges |
| Space membership | New member gets stated historical shared audience; private context/transcript stays inaccessible |
| Revocation during run | Tool and broker mutations reject immediately; provider drains; stale session is not reused for a new shared audience |
| Atomic post/attention crash | Either no post/cause exists or one durable post and exactly one cause per target exist |
| Tracked vs untracked question | Plain post has no fabricated obligation; tracked ask has exactly one visible work record |
| Healthy waiting | Lead ends a turn with open child work; no false failure or automatic work completion |
| Full engineering chain | Chief → lead → engineer → reviewer → revision → lead → original Chief thread, with distinct identities and pinned evidence |
| Same-thread wake | Busy owner turn drains before restricted background input; no concurrent provider run or inherited owner privilege |
| Group discussion | Three attention targets get three private sessions; published posts share a thread without exposing private transcripts |
| Work dependency | Blocked prerequisite prevents admission; cancel is not success; reopen fences current dependent execution |
| Cross-space/cross-workspace work | Allowed rollup uses approved projection; denied source does not leak title, count, or evidence |
| Memory race | Exactly one CAS writer wins; stale response preserves draft/current head; no silent truncation or task-state copying |
| Memory compartment | Researcher's Product private note is absent from GTM briefing/recall and provider-session reuse |
| Optional turn capture | Frozen source ranges dedupe/batch; CAS conflict and failure preserve work; capture never recursively captures itself |
| Publication | Destination receives exact authorized revision; new source revisions are not silently shared |
| Portable export/import | Readable knowledge and detailed notes survive round trip; repeated import dedupes; no credentials, grants, live queues, or enabled jobs are imported |
| Artifact mutation | Different bytes create a new digest/revision; old approval cannot authorize them |
| Frontier handoff | Simulation receives published evidence and a new owned validation commitment, not researcher's private notebook |
| Missing demo | Draft preparation allowed; adapter rejects send despite a “demo done” post/work claim |
| Revoked/withdrawn demo | Previously prepared intent cannot send after policy/artifact invalidation |
| Exact approval | Changed recipient/body/digest, expiry, spoofed owner prose, replay, and stale policy all fail correctly |
| Mail crash boundary | Duplicate requests share one intent; uncertain provider outcome stays unknown until reconciled; no blind retry |
| Mail bypass guarantee | Credential/mount/connector/egress checks match the claimed containment mode; otherwise UI states adapter-only enforcement |
| Rule idempotency | Same transition/tick produces one cause; disabled and revised rules cannot admit stale authority |
| Schedule downtime | Missed repeats coalesce; UTC/timezone/DST preview matches actual due instants; manual run does not move cursor |
| Self successor | Success and full drain releases one successor; crash/cancel holds it; hourly cap cannot be reset |
| Loop containment | Attention/rule storms hit the configured latch without dropping accepted obligations or recursive failure wakes |
| Scope cancel race | Stop serializes against post/child creation; all roots under the work gate fence and drain |
| Handoff race | No new owner runs before old subtree drains; child owners retained; private memory not copied; interruption remains explicit |
| Crash/lease expiry | Expiry does not adopt a possibly live provider; explicit stopped proof precedes retry |
| Missing conversation | Shared case remains readable; run holds; repair requires valid destination and does not resurrect completed inputs |
| Migration | Existing history/audience/IDs retained; each old obligation maps once; only one completion/wake path operates |
| Desktop/mobile | Same audience and run states, route persistence, working links, no duplicate state spine or hidden approval state |

After mechanical validation, run a small owner-authorized pilot. Measure whether employees
publish sufficient results, distinguish hypotheses from evidence, avoid redundant wakeups,
honor scoped memory, and use tracked commitments when an answer matters. Measure owner effort:
can the owner understand the state without reading raw transcripts or asking everyone for a
status report? Mechanical correctness cannot establish that agents will manage well.

### Release gates, not vague future work

Before this alternative is ready for implementation selection, agree on two product choices:
whether shared cases should become the primary coordination UI, and whether tracked small
questions should become visible work. The document chooses **yes** to both for this alternative.
If either choice is rejected, the addressed-resource design is probably the better base.

Implementation can be planned from the contracts above, but release still requires the fixture
matrix, migration proof, same-thread policy proof, operational controls, and the live pilot.
The mailbox's real adapter, credential location, recipient policy, and containment mode must
be discovered/configured before mail is enabled. The scientific validation criteria and
business prioritization are responsibilities of the actual leads, not facts solved here.

## 14. Pressure test: where this is simpler and where it is not

| Question | Answer for this alternative |
|---|---|
| Can a Chief talk to all leads and resume the original conversation? | Yes, through explicit shared-case attention and narrow work/clock rules targeting the Chief's personal thread. |
| Can leads start subordinates and follow up? | Yes; a post with attention queues work in the member's own session for that thread. Subsequent posts use the same thread. |
| Can they observe completion? | Yes, from explicit work transitions and evidence; ordinary final assistant text is not completion. |
| Can a whole team share context? | Yes, if deliberately in the same space. Sharing does not expose private memory or raw provider transcripts. |
| Can some staff be absent from the top level? | Yes; directory placement is independent of employee identity and permissions. |
| Can Product share GTM's researcher? | Yes; one manager, explicit case membership and assignment rights, isolated case contexts. |
| Can it run recurring management checks? | Yes, in an existing thread while the server is running, within fixed admission and budget rules. |
| Can it answer an untracked quick question? | Yes, but it supplies no guaranteed final-response lifecycle unless the caller makes it tracked work. |
| Does it make every message a task? | No. Tracked obligations are work; posts can be pure discussion. The UI must make that distinction clear. |
| Does it prevent all model disclosure or shell bypass? | No. Application permissions plus sessions reduce accidental sharing; strong containment requires execution-environment restrictions. |
| Does it guarantee external effects exactly once? | Only to the extent the broker/provider supports reconciliation and idempotency; unknown outcomes remain explicit. |
| Does it require a workflow engine? | No arbitrary workflow engine, but it does require a finite rule matcher and transactional dependency admission. Those are real new components. |

The strongest simplifications are shared history during handoff, one completion authority in
work, no paired return routing, explicit team visibility, and a reusable publication boundary.
Review, research transfer, questions, progress, and management become ordinary thread/work
operations without a growing taxonomy of message purposes that each need lifecycle exceptions.

The largest costs are migrating the existing request/reply surface, creating a visible work
item for every reliably tracked question, maintaining private context spaces, designing a new
shared-thread UI beside existing chats, and implementing finite wake rules without letting
them become an accidental workflow language. The existing system already has many reliable
message/runtime components; replacing their public semantics has a migration cost even if
the target concepts look cleaner on paper.

Choose this direction if repeated real work needs a shared case with several contributors,
published knowledge, explicit audiences, and smooth owner handoff more often than it needs a
private request to one employee. If the main experience remains “talk privately to my Chief,
who privately talks to leads,” retain the simpler addressed-resource foundation and borrow
this proposal's space audiences, explicit publication, and brokered external-effect boundary.
