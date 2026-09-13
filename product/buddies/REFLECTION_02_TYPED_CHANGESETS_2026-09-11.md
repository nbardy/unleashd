# Direction 2 — one typed change-set boundary

2026-09-11, Asia/Makassar. **Alternative for discussion, not an accepted design or implemented API.** Compare [resource consolidation](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md) and [shared workspaces](REFLECTION_03_SHARED_WORKSPACES_2026-09-11.md). Source provenance, the `.4` baseline and the three-way concern matrix are in Direction 1.

## Judgment

Keep the same typed resources, but replace independently exposed configuration/document/work mutations with a closed, typed change-set service. Preview and apply become uniform. Owner and employee callers submit the same language under different authenticated authority.

This can simplify workflows that repeatedly need several database records to change together. It can also turn a small application into a batch-processing framework. Choose it only if atomic edits beyond team onboarding justify that cost. Merely having fewer MCP tools does not establish a simpler design.

Unlike the earlier event-ledger alternative, current typed rows remain authoritative. Receipts and audit record changes; they are not an event source that must replay the whole organization.

## 1. What problem this actually addresses

The `.4` implementation can configure roster/grants but must import documents and create work separately. Builder and employee APIs have different edit scope. Multiple setters repeat revision checks, key handling, diffs and error conventions.

A typed batch can make roster, grants, initial knowledge and initial work one database transition, provided that all values are supplied and all preconditions are checked. It cannot make provider execution, file projection, email delivery or human review part of that database transaction.

The design is therefore **atomic database edits, followed by explicit execution**, not “give a universal execute tool an arbitrary plan.”

## 2. Minimal durable model

Retain Buddy, workspace membership, relationship, explicit grants, project/task, versioned document, append-only note, message, run and schedule. Retain the existing command receipt/audit and provider transcript stores. No generic entity table and no event-sourcing migration.

One manager is an acyclic relationship; shared Market Research stays one identity. A project's owner is accountable for criteria/evidence. A role name supplies no permissions. Completed model turns do not close work. Compact memory is knowledge, not task state.

The additional abstraction is a **closed command union**, not a new persistent business object. A prepared change set is bounded data plus a read-set hash. The existing receipt persists an applied command and its results; no indefinite server-side Plan resource is required.

### Proposed types

```ts
type Id = string;
type Revision = string;     // opaque; adapters retain underlying resource version semantics
type Key = string;
type BuddyRef = { id: Id } | { local: string };
type Scope =
  | { kind: 'owner_thread'; conversationId: Id }
  | { kind: 'workspace'; workspaceId: Id }
  | { kind: 'project'; projectId: Id };
type DocRef =
  | { kind: 'soul'; buddy: BuddyRef }
  | { kind: 'working' | 'long_term'; buddy: BuddyRef; scope: Scope }
  | { kind: 'shared'; id: Id };
type ExpectedDocument =
  | { revision: Revision }
  | { createdBy: string }; // initial document of an identity created in this batch only
type WorkSpec = {
  owner: BuddyRef; title: string; definitionOfDone: string;
  parentProjectId?: Id;
  tasks: { title: string; definitionOfDone: string }[];
};
type GrantSpec = {
  grantee: BuddyRef; target: BuddyRef;
  rights: ('relationship.write' | 'profile.read' | 'profile.write'
    | 'soul.read' | 'soul.write' | 'memory.read' | 'memory.write'
    | 'execution.manage' | 'schedule.manage' | 'staff.create')[];
  expiresAt: string | null;
};
type Change =
  | { kind: 'buddy.create'; local: string; creationKey: Key;
      name: string; role: string; soul: string }
  | { kind: 'membership.set'; buddy: BuddyRef; revision: Revision | null;
      incoming: boolean; dispatch: boolean; readAllWork: boolean }
  | { kind: 'relationship.set'; manager: BuddyRef; report: BuddyRef;
      revision: Revision | null; present: boolean }
  | { kind: 'grant.set'; revision: Revision | null; grant: GrantSpec }
  | { kind: 'document.replace'; ref: DocRef; expected: ExpectedDocument;
      content: string; reason: string }
  | { kind: 'project.create'; local: string; creationKey: Key; work: WorkSpec };
type ChangeSet = {
  key: Key; workspaceId: Id; reason: string; changes: Change[];
};
type Problem = {
  code: string; path: string; reason: string;
  resolver: 'owner' | 'buddy' | 'runtime'; remedy: string;
};
type Prepared = {
  hash: string; checkedAt: string; canApply: boolean;
  effects: { index: number; kind: Change['kind']; summary: string }[];
  problems: Problem[];
  affectedMessageIds: Id[];
};
type Applied = {
  receiptId: Id; ids: { local: string; id: Id }[];
  effects: { index: number; resourceId: Id; revision: Revision }[];
  projection: 'ready' | 'repair_required';
};
```

This is the smallest illustrative union for the onboarding path. Production variants for profile edits, collaboration links, project edits, lifecycle changes, publication and schedules have their own exact schemas; they are not hidden in a `patch:unknown` escape hatch. Every new variant costs policy, preview, apply and recovery coverage. That cost is a reason to resist this option unless reuse is demonstrated.

Identifiers in `local` refer only to named creates in this change set. They are not arbitrary variable substitution, JSON pointers, shell expressions or outputs from model execution. Duplicate local names fail. Omitted creation revision means create; an existing-resource update always supplies its current revision. Do not merge unrelated row revisions into one global version.

`createdBy` resolves only the initial document of that exact newly created identity. If its creation key already resolves to a previously existing identity, preparation requires the current document revision instead; it cannot overwrite that identity's later memory as though it were still new. Even this small case shows the extra precondition vocabulary a public batch introduces.

## 3. API and MCP surface

| Operation | Contract | Side effects |
|---|---|---|
| `prepare_changes({changeSet})` | Strict validation, scope checks, current read set, typed effects/diffs | No domain writes or runs |
| `apply_changes({changeSet,expectedHash})` | Revalidate and commit all database changes or none | Typed rows, revisions, audit and receipt |
| `list_buddies`, `get_current_work`, `get_document`, `get_profile` | Resource-specific, bounded reads | None |
| `get_capabilities` | Available action classes; detailed requested checks only | None |
| `send`, `reply`, `get_message` | Existing addressed execution/receipt semantics | Message, queue and return routing |
| `get_runs`, `stop`, `retry_run` | Existing runtime controls | Fencing/drain or explicit new attempt |
| `remember_note`, `recall` | Authored evidence append/search | No domain command execution |

HTTP exposes `POST /api/buddies/changes/prepare` and `/apply` plus ordinary GET resources. The private service receives trusted owner/employee context separately. SDK wrappers can preserve `configureTeam`, `replaceDocument`, `createProject` convenience calls by constructing exact change variants; wrappers do not implement another mutation path.

MCP's object root contains `changeSet.changes[]` with a discriminator per item. The advertised schema and handler accept the same structural variants. When a provider cannot support this shape adequately, use generated variant tools that call the same service; do not silently fall back to permissive JSON. Measure that fallback: it may erase the model-facing benefit of choosing this design.

Read results use `{items,nextCursor}` and mutation results use a stable success/problem envelope with receipt/audit IDs. Large diffs are bounded, explicitly marked if truncated and inspectable by authorized resource read. No identical capability document appears at both root and in a target list.

## 4. Authority: uniform commands do not mean uniform privilege

The host attaches a fresh owner-input capability or an employee run claim. The model cannot choose `actor`, `asOwner` or a different employee's identity. Builder and lead owner chats use the same owner projection; incoming specialist/automation callbacks use the employee projection even when the visible thread previously belonged to the owner.

Each variant has one policy evaluator, used in both preparation and commit. The whole change set is rejected if any required operation is unauthorized. Read permission is required for preview content/diffs. Unauthorized IDs do not become an enumeration oracle through error details.

**Employee authorization is evaluated against pre-transaction state.** An employee cannot grant itself privileges in change 1 and use them in change 2. The owner may explicitly establish grants while directly authorizing the other changes. Relationship-derived rights affected by the batch are resolved conservatively; removal/reparenting cannot leave stale management authority valid for dependent edits. The read set includes every policy row consulted.

Creating a relationship does not grant private memory access. Document grants are scoped and explicit. Incoming execution, recurring schedules, future staffing, paid computation and external actions remain separate rights. A preview hash proves a plan version, not human consent or authority to apply it later.

## 5. Transaction and recovery semantics

1. Parse the closed schema. Reject arbitrary operations, duplicate targets/fields, unresolved local refs, invalid graphs and excessive size. Initial suggested bounds are the current setup bounds: at most 32 created identities and 256 KiB total input; larger imports remain separate commands.
2. Read exact resource revisions and current authority. Resolve creation keys to existing identities where a receipt already exists. Different content under the same key is a conflict, not an update.
3. Build a deterministic typed plan. Dependencies are only local create references and fixed variant ordering. No conditionals, loops, provider calls or external fetches.
4. Return preview with canonical input hash plus relevant resource/permission revisions, effects and held-message impact. Pure preview does not reserve names, grants or capacity.
5. Apply in one transaction after fresh authority/revision checks. Store immutable document revisions and intended file projections with resource changes, audit and command receipt.
6. Publish projections after commit. A projection error reports `repair_required`; repeating the same key repairs that projection without reapplying grants or creating people. Scheduler admission requires necessary committed context/projections to be ready.
7. Execution starts only through a later activation/send command. A transaction containing imports cannot enable incoming work in that same batch. Existing active runs affected by mandatory-before-run imports must drain first; a batch cannot make an already-loaded provider forget old instructions.

Retrying an applied key checks current read permission and returns the original result plus current drift. It never reconciles the world back to old desired state. Expired/revoked grants stay expired/revoked. Unknown external side effects never enter automatic database replay.

Atomicity ends at the database. Documents whose source is an external file must first be read and supplied as bounded content with provenance; the batch does not dereference arbitrary paths under owner authority. Private export/shell access is not a side door around document policy.

## 6. Complete operation chains

### Font Maker: repair existing Chief, Pixel and Path

Read exact existing IDs, current documents/revisions and original message receipts. A prepare/apply batch sets requested relationships/grants and imports authorized handoff content while retaining incoming holds. Because this is the owner's current instruction, it does not depend on the Chief having preexisting employee grants for those owner-authored edits.

Read back document/projection readiness. A second prepare/apply batch enables Pixel, Path and the Chief return path. Original messages become eligible under the scheduler's existing rules. Inspect those same IDs for starts, acknowledgments and project acceptance. Do not create replacement messages to work around a held receipt. The worker records evidence; the original callback resumes Chief with employee authority.

### wave_sim: create missing people and initial work

Search exact contacts and bind existing IDs. Missing identities get stable creation keys. One held batch creates the remaining people, relationships, explicit grants, initial role knowledge and bounded projects. It creates exactly the eight requested roles and keeps the shared researcher under GTM with separate Product collaboration access.

Read the resulting revisions and IDs; verify every required import. Activate incoming work in a distinct batch. Dispatch each initial project through `send` with stable keys. Preserve five market targets and treat the coastal-market-size claim as a hypothesis. Outbound customer email remains blocked until accepted demos, a real account and separate send authority exist.

### Lead delegates, waits and reviews

Product may prepare/apply several child projects together under current work-management rights, then send bounded requests to Engineer and Designer. The existing executor admits each; the parent waits for child results within its deadline. Product reviews evidence, records further review work when necessary, and updates its own deliverables. Terminal completion returns through the existing message route.

The change set does not run a project, infer acceptance from prose or turn parent completion into child completion. Independent review can reject outputs without rewriting historical worker evidence.

### Recurring Chief check and a failed attempt

Schedule creation/update is a typed variant with explicit enable authority and revision. A schedule tick creates one ordinary bounded input under current employee restrictions, never an owner batch. The Chief reads work/messages and emits ordinary changes or sends. Stop cancels/fences the chain; apply from the stopped claim fails even if a preview was prepared earlier. Resume is an explicit new attempt after inspecting effects.

## 7. Knowledge, messages and visibility

Use the same scope model as Direction 1. Document revisions and notes are tagged with owner-thread, project or workspace audience. Private addressed messages remain private unless explicitly published. Reference access does not disclose its target's body. A contact directory entry conveys neither execution nor private-document permission.

Per-scope memory and fresh provider contexts prevent accidental reuse of private owner or other-project state. The independent memory reviewer retains its existing model/role but is restricted to its source scope. A `document.publish` variant may copy an exact authorized version to a wider scope; write permission alone is not disclosure authority. A source and destination in one batch do not bypass publication policy.

Legacy global knowledge is not silently relabeled as shared. A shared-run role brief is an explicitly curated document, not automatic publication of the full soul. Owner-private material must be quarantined/curated before shared execution. Files and unrestricted owner-UID shell access remain a separate containment issue; no database batch proves OS isolation.

Decision history has two complementary records: the machine receipt says what committed and which inputs/revisions caused it; an authored append-only note explains why the choice was made and when to revisit it. Never infer a rationale from a machine diff.

Owner presentation groups a batch's effects into one setup card. Team views show work, permitted published evidence and execution receipts. Full private document diffs remain available only to authorized readers. Collapsing staff in navigation changes no audience.

## 8. External actions do not join the batch

Email, training, spending and publishing are not `Change` variants in the database language. Their intents and receipts may be stored records, but execution belongs to a narrow integration service that rechecks current authority, pinned content and prerequisites.

For GTM, accepted demo evidence plus exact mailbox/draft authorization is checked at the send boundary. A changed draft requires its proper authorization; a provider timeout is an unknown outcome until reconciled. Reapplying a batch must never send email, launch training, call a model or regenerate credentials.

If effectful operations creep into this language, it becomes a saga/workflow engine with compensation rules. That is specifically outside this option. A failed external action leaves its work incomplete and its receipt inspectable.

## 9. Deletions, migration and real cost

| Remove | Replace with |
|---|---|
| Special owner team mutation implementation | Typed roster/grant/membership variants |
| Builder-only resource mutations | The same owner change-set service |
| Per-tool diff/CAS/idempotency scaffolding | Shared preparation and receipt engine |
| Duplicated public setter schemas | Closed variants and generated wrapper schemas |
| Flat optional action bags | Exact nested discriminated variants |

Do not delete send/reply, run ownership, context isolation or effect receipts. A batch cannot replace those concerns.

Migration sequence:

1. Extract existing typed services and common policy/error logic without changing behavior.
2. Implement prepare/apply over a small closed set of existing synchronous mutations. Keep old callers as wrappers; prove identical effects and authorization.
3. Move Builder and Settings onto the same batch path, preserving creation keys and owner-input revocation.
4. Add document/work variants only after their current revision/projection recovery tests pass through the batch.
5. Switch new MCP clients by explicit contract version. Keep old receipt readers and restored sessions supported at the edge.
6. Retire old writers once telemetry proves no independent mutation path remains. Never dual-write state through both implementations.

The cost is substantial: planner/read-set correctness, reference resolution, batch conflicts, authorization ordering, bounded diffs, projection recovery and provider compatibility. A larger batch also increases the chance that one stale revision rejects otherwise useful work. Avoid arbitrary chunking that destroys promised atomicity; return a precise conflict and let the caller re-read/reprepare.

## 10. Acceptance and reasons to reject it

All Direction 1 fixtures still apply: unconfigured Font Maker, eight-person wave_sim, original task IDs, owner-to-employee return, stop/drain, changed completion criteria, privacy and demo gates.

Additional tests must cross the actual prepare/apply/SQLite boundary:

| Failure case | Required behavior |
|---|---|
| One unauthorized or stale edit among otherwise valid edits | No domain change commits |
| Employee tries grant-then-private-read/write | Denied from pre-state; no privilege bootstrapping |
| Preview allowed, owner turn revoked before apply | Apply denied; preview is not a capability |
| Duplicate local refs, forward cycle or mismatched creation key | Deterministic validation error, no partial identity |
| Unrelated row changes | Do not conflict unless it was part of the relevant read set |
| Relevant permission or resource changes | Stale plan detected, new preview required |
| Commit succeeds, process dies before reply/projection | Original receipt retained; recovery repairs projection, not side effects |
| Replayed setup after grant revocation | Original result/drift, no restoration |
| Import and incoming enable in one batch | Rejected with separate-activation remedy |
| Provider cannot represent the union | Versioned generated tools or explicit incompatibility, never permissive arguments |

Compare end-to-end task completion, repairs and model schema errors against Direction 1. If fewer tool names produce longer inputs, more validation repairs or harder explanations, this design has failed its simplification goal.

## 11. Recommendation and reconsideration criteria

Do not choose this as the default next step. The immediate fixes can share internal services without exposing a public batch language. Team onboarding alone already has an adequate owner composition.

Choose this option if several independently observed workflows repeatedly require atomic multi-resource changes and the same preparation logic eliminates real duplication. Examples include controlled multi-document imports plus roster changes or a batch of project reassignments with consistent authority. Demand working traces, not hypothetical future scale.

Do not combine it with a ledger migration and a shared-space migration. If selected, preserve the typed relational core and addressed execution model while proving the new transaction boundary first.

Decision status: assistant alternative requested by owner. No old decision was erased, no new MCP installed, no production configuration changed. Historical anchors and exact source hashes are in [Direction 1, source history](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md#11-source-anchors-and-decision-history).
