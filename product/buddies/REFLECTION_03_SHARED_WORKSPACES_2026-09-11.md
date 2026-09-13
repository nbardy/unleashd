# Direction 3 — shared collaboration spaces and accountable work

2026-09-11, Asia/Makassar. **Alternative for discussion, not selected or implemented.** Compare [resource consolidation](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md) and [typed change sets](REFLECTION_02_TYPED_CHANGESETS_2026-09-11.md). The current `.4` contract, source hashes and three-way comparison are documented in Direction 1.

## Judgment

Make shared work and its published discussion the coordination center. People receive attention on that work; they do not exchange a separate durable request/reply obligation for every tracked handoff. One work record owns the commitment and completion evidence.

This is the strongest conceptual simplification if several Buddies and the owner routinely collaborate on the same material. It is the most disruptive option for an application whose current interaction is private Chief → lead → employee messages.

This revises the old shared-spaces alternative to remove nested spaces and generic rules. A collaboration Space is **inside an existing repository Workspace**; it does not replace the existing workspace/folder model. Use a different UI name such as “shared work” if the two terms confuse users.

## 1. The new center of gravity

Today a project, request, provider conversation, reply and return conversation can all describe related activity. They have legitimate different purposes, but users struggle to locate the commitment and its result.

Here, the owner opens shared work and sees its criteria, accountable owner, published discussion, evidence and latest execution. Private employee computation is linked behind that view. A Chief can still be the user's sole conversational entry point; shared work supplies the stable handoff surface underneath it.

The design does not turn every chat message into a task. A plain post is discussion. A question or assignment requiring guaranteed follow-through becomes a small work record with criteria and a watcher. That distinction must be visible to users, not inferred from prose.

## 2. Minimal durable model

| Concept | Minimal fields | Authority |
|---|---|---|
| Buddy | ID, name, role, status, home workspace, execution profile | Persistent identity; no quotas or special Chief class |
| Workspace membership / manager / grants | Existing participation and rights | One acyclic manager; collaboration does not change employment |
| Space | ID, workspace, title, purpose, audience revision | Flat shared audience; no recursive inheritance |
| Space member | Space, principal, finite role | Read/contribute/assign/manage explicitly separated |
| Work | Space, owner, optional parent, criteria, state, evidence, execution gate | One accountable commitment; replaces separate project/todo semantics in this option |
| Post | Space/thread, author, optional work, body, immutable references | Published discussion, not model transcript |
| Document / note | Space and immutable revisions / authored append-only evidence | Shared knowledge |
| Private context | Buddy, source space, audience revision, private memory/session references | Worker-local context; never a shared post stream |
| Attention / watch | Durable input to one Buddy / subscribed work terminal event | Execution request and callback routing, not a second completion record |
| Run / schedule / receipt | Existing bounded attempt, repeated input, committed change | One executor and durable causation |

Space membership is not a replacement for all authority. Global identity/private-profile management remains a separate grant. A member can contribute shared work without editing another person's soul, enabling schedules or obtaining mailbox credentials.

Flat spaces deliberately trade some convenience for simpler policy. There is no nested membership inheritance, per-post exception ACL or arbitrary relationship evaluator. If a subset needs private discussion, use another explicit space and publish selected results. The owner may inspect personal execution data without making it visible to space members.

### Proposed types

```ts
type Id = string;
type Revision = string;
type Key = string;
type Principal = { kind: 'owner'; id: Id } | { kind: 'buddy'; id: Id };
type Ref =
  | { kind: 'work'; id: Id; revision: Revision }
  | { kind: 'document'; id: Id; revision: Revision }
  | { kind: 'post'; id: Id }
  | { kind: 'artifact'; uri: string; sha256: string };
type Space = {
  id: Id; workspaceId: Id; title: string;
  purpose: 'owner_dialogue' | 'team' | 'work'; audienceRevision: Revision;
};
type SpaceMember = {
  spaceId: Id; principal: Principal;
  role: 'reader' | 'contributor' | 'assigner' | 'manager';
  revision: Revision;
};
type Evidence = { ref: Ref; explanation: string };
type Work = {
  id: Id; spaceId: Id; ownerId: Id; parentId: Id | null;
  title: string; definitionOfDone: string; revision: Revision;
  status: 'ready' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled';
  execution: 'enabled' | 'paused' | 'draining' | 'cancelled';
  evidence: Evidence[]; blocker: string | null;
};
type Post = {
  id: Id; spaceId: Id; threadId: Id; workId: Id | null;
  author: Principal; body: string; references: Ref[]; createdAt: string;
};
type Attention = {
  id: Id; recipientId: Id; spaceId: Id;
  cause: { kind: 'post'; id: Id } | { kind: 'work'; id: Id; revision: Revision }
    | { kind: 'schedule'; id: Id; occurrenceKey: Key };
  workId: Id | null;
  mode: 'once' | 'until_done'; maxRuns: number; maxDurationSeconds: number;
};
type WorkWatch = {
  workId: Id; buddyId: Id; destinationThreadId: Id;
  event: 'terminal'; revision: Revision;
};
```

Wire revisions remain opaque. These sketches omit ordinary timestamps/indexes/bounds, not authorization or lifecycle requirements. Space membership and context changes have revocation epochs internally. The owner/actor/claim are always supplied by the host, not by model input.

Projects and todos map to Work nodes; grouping does not imply completion. Each child has its own owner and criteria. Parent completion checks current required children and its own evidence. Cancelled children remain in history and do not masquerade as completed outputs. A reviewer can own a review Work node pinned to the candidate evidence revision.

## 3. API and MCP

| Tool/service | Input → result | Meaning |
|---|---|---|
| `list_buddies` | Permitted directory query → `Page<Contact>` | Find routes, no authority expansion |
| `get_capabilities` | Specific space/work/action → decisions | No generic ready claim |
| `configure_team` (owner) | Keyed preview/apply roster, exact grants and memberships | Same service in Builder, Settings and owner chats |
| `get_space`, `get_work` | ID → authorized typed resource | Shared current context |
| `create_work` | Key, space, owner, criteria, parent? → Work | Save accountable commitment |
| `update_work` | Key, ID, revision, typed content/state changes → Work | Accept, revise, block or complete with evidence |
| `post` | Key, space/thread/work, body, refs, optional attention → Post and attention IDs | Publish once, optionally wake named recipients |
| `attend` | Key, existing cause, recipient, execution policy → Attention/receipt | Wake on existing durable content without reposting |
| `watch_work` | Key, work, terminal event, destination thread → watch | Request a completion return |
| `get_document`, `update_document`, `remember_note`, `recall` | Scoped, revisioned knowledge APIs | Read/replace versus append remain distinct |
| `publish` | Key, source revision, destination space, selected content → destination record | Explicit disclosure with provenance |
| `get_runs`, `stop`, `retry_run` | Existing runtime contracts | Inspect and control private attempts |
| Schedule tools | Bounded clock input targeting space/thread | Exactly one occurrence owner |

HTTP projects these same services under `/spaces/:id`, `/work/:id`, `/posts`, `/attention` and existing runtime routes. Named MCP tools use exact object-root schemas and one result/page envelope. Owner and employee projections call the same handlers; authority differs, not data definitions.

`post` with attention atomically persists the post and eligible attention inputs. A plain `@name` in its body is not an instruction to the dispatcher. `attend` is necessary for existing content and schedule/work events, so posting need not be duplicated to wake someone.

`watch_work` records callback routing. This design does **not** magically eliminate return routing: it replaces paired message replies with work watches. That is a new abstraction and migration cost. Destination threads must belong to the observer and be host/permission validated; a caller cannot redirect another employee's private output arbitrarily.

One until-done attention obligation may be active per work item. Additional attention is coalesced into the next/current permitted attempt rather than starting a second worker. Informational discussion can receive one bounded turn, but has no guaranteed final answer unless represented as Work.

## 4. Whole-system behavior

### Owner setup in one place

Builder uses the owner projection to create/adopt exact identities and configure requested Space memberships, manager relationships and grants. It can access existing in-scope handoffs using the same authorized document services as a lead owner chat; no created-hire-only document API.

Create new staff held. Import and verify required soul/memory material in the correct private context; publish only the intended team briefs. Save initial Work with criteria, then enable incoming work for workers and the lead return path in a second keyed phase. Required-before-run imports pause/drain affected active work before context replacement. Unrelated active work is preserved.

The workflow has one owner-facing setup card backed by existing receipts. It is not a new autonomous Team object. The owner does not need to restate already clear permission. Owner preview/apply still uses fresh host authority; incoming posts, old owner messages and quoted handoffs cannot authorize later owner edits.

### wave_sim business team

The Project Lead manages GTM, Product, Simulation and Frontier Research. GTM manages Market Research. Product manages Engineer and Designer. Product has collaboration access to research work; the researcher has one manager and one identity.

Publish a team brief listing the five markets: wave pools, surfboards, boat hulls, hydrofoils and coastal engineering. Mark the owner's market-size belief as a hypothesis. Create focused Product and GTM workspaces only where audiences actually differ; do not create a room for every minor task.

Product creates Engineer and Designer work in its shared space, watches both and sends attention. They publish evidence and critiques into that work's discussion. Product can see one coherent history instead of manually forwarding private replies. Product's completion triggers Project Lead's watch in the original thread.

The designer's role is behavioral: identify usable target cases and challenge scope. Neither role labels nor schema guarantees good product judgment. Completion criteria and review evidence make that judgment inspectable.

### Frontier → Simulation

Frontier records a result with explicit assumptions, error bounds, computational evidence and limitations. A separate review work item evaluates the pinned artifact. After acceptance, publish the relevant result to Simulation's space and create implementation Work referencing it. Private exploratory material remains in Frontier's context unless explicitly shared. A completion event does not certify a mathematical breakthrough.

### Market Research shared by GTM and Product

For nonconfidential market work, both leads share one research space. For confidential work, the researcher uses separate space contexts. A curated market brief can be published between them with current source-read, destination-write and disclosure authority. Being the same employee does not justify resuming a provider session containing another space's private material.

### Chief recurring wakeups

An authorized schedule emits one bounded attention input in the Chief's chosen thread. The Chief reads watched work, changes since its last processed cursor and blocked/failed results, then steers with posts or assignments. Work terminal events provide immediate callbacks; the clock is only for periodic review.

Only two automatic producers are needed: schedule occurrence and watched work terminal transition. Ordinary posts wake named recipients explicitly. No arbitrary predicates, recursive subscriptions or model-defined event handlers. Intermediate progress is visible in work/activity; it does not automatically fan out a new model turn to everyone.

## 5. Completion, waiting and execution

```text
create/update Work + explicit Attention
             |
       one durable run queue
             |
    one bounded worker context
             |
   Work criteria/evidence reconcile
       /        |          \
 continue      wait       terminal
                             |
                 WorkWatch → lead attention
```

`until_done` is meaningful only with a work ID and finite run/duration limits. After a successful provider attempt, unfinished unblocked work can continue. Children still outstanding cause a wait inside the same overall deadline. A failed/interrupted attempt requires effect inspection before retry. Completion requires current work criteria/evidence, not a post saying “done.”

A terminal work transition and each watcher notification commit together. The deduplication identity is `(workId, terminalRevision, watchId)`. The callback is a new bounded employee run, never inherited owner authority. If the original thread is missing or the observer cannot receive work, retain the result and expose an actionable blocked notification; do not silently invent a private replacement thread.

The shared thread is not a provider session. Multiple workers have distinct sessions and claims. Concurrent edits use per-resource revisions; concurrent code work still needs worktrees or an explicit coordination policy. Discussion alone does not lock a filesystem.

Closing, pausing, cancelling and retiring remain explicit transitions. Stop revokes claims before drain and fences scheduled/child successors. A late work result does not resurrect a cancelled watch chain. A reopened work item has a new revision and new explicit execution request. Ownership transfer drains the old owner before admission to the new one.

## 6. Visibility and private memory

All **published content** in a space has one audience. No private posts inside an otherwise shared stream. Referencing a private record does not publish its body, title or snippet. Audience changes are owner/authorized-space-management operations with current revisions and exact effects.

Private compact memory and provider transcripts are not published space content. They belong to a Buddy's private context for that source space. Owner inspection is distinct from sharing. Only approved portable role/style may be used across spaces through an explicitly curated role brief; the full soul is not automatically published. Historical global memories require curation before use in shared work.

Context reuse keys include Buddy, space and audience epoch. Removing a member or narrowing an audience invalidates future reuse and retrieval. It cannot make earlier recipients forget prior disclosure. Strictly sensitive changes require fresh provider contexts, not prompt warnings inside an old one.

The independent bounded memory reviewer reads only the source context and authorized knowledge. It can update that context's compact memories and append notes; it cannot publish to another space, edit soul, send attention or pursue work. This explicitly refines the earlier global-memory reviewer policy if this option is selected.

Publication creates a new destination record with source revision/hash and selected content; it is not a live link that silently broadens access to later source edits. Search, activity feeds, diff previews, exports and error messages apply the same audience rule. Deleting a projection does not delete authoritative history; retention/redaction policy must be explicit.

This reduces accidental context leakage. It is not a guarantee against an unrestricted owner-UID shell or a model exposed to credentials outside the service. Hard confidentiality and effect control still require deployment isolation. Flat Space ACLs alone cannot provide that.

## 7. Owner experience and logs

The user can stay in their Chief chat. A compact card shows each work item's owner, criteria, state, latest run, blocker and evidence. Opening it reveals shared discussion, then optional execution history. Owner-private discussion is a different audience and is not copied into that shared card.

Leads and reports can be visually nested or collapsed without hiding identity from permitted search. This is navigation preference, not an authorization setting. Notification state (“seen,” “handled,” “requires action”) is separate from project completion and worker execution. A terminal work event is not automatically handled just because a callback was queued.

Preserve four record purposes:

1. Shared posts describe the discussion people should see.
2. Provider transcripts record private execution.
3. Machine audit describes committed state changes and causal IDs.
4. Authored decision notes preserve motivations, alternatives and evidence.

Compact memory points to these records rather than duplicating them. The owner should be able to answer both “what happened?” and “why was it chosen?” without treating speculative model prose as machine truth.

## 8. Email, demos and other external effects

A Space may reference a real mailbox integration, but membership does not grant sending. GTM's interview Work can be prepared while demo work is pending. At the external-action service, require accepted demo evidence, the exact draft/version, account scope and current send authority.

Use durable provider idempotency/reconciliation receipts. Unknown outcomes remain unknown until reconciled; do not resend on a timeout. A watched demo-completion event may notify GTM that evidence is available, but cannot itself authorize outreach. Training, spending and external publishing have their own explicit boundary.

Neither shared discussion nor the attention queue may execute arbitrary connector actions as event handlers. Effects occur through authorized worker/service calls and are auditable. All applicable sends must traverse that restricted path to claim an enforced demo-before-outreach gate.

## 9. What we delete, add and migrate

| Delete/consolidate | Replacement | Cost |
|---|---|---|
| Paired tracked request/reply completion state | Work completion and watches | Tracked questions need Work; watch routing is new |
| Repeated forwarded handoff prose | Shared posts and pinned published evidence | New shared thread UI and explicit audiences |
| Project versus todo behavior split | Work tree | Migration, aggregate-completion and revision semantics |
| Per-message sharing exceptions | One audience per Space | More spaces when confidentiality differs |
| Builder-specific mutations | Shared resource services under owner context | Same consolidation still required as Direction 1 |
| Broad event/rule plans from old shared-space brief | Explicit post attention + two finite automatic producers | Less flexibility, fewer hidden wake paths |

Add Space/SpaceMember, Post, WorkWatch and explicit Attention records or equivalent typed projections over existing queue inputs. These are real new concepts; hiding them in `metadata` would not reduce their cost. Keep document versions, run claims, schedule occurrences and effect receipts.

Migration must have one writer/executor for each commitment:

1. Introduce shared audiences and context partitioning for new content; do not auto-share legacy transcripts/memory.
2. Project existing projects/todos as Work with preserved IDs and revision adapters. Keep parent/child criteria/evidence explicit.
3. For each active tracked request, atomically map its original message ID to one Work/Attention/watch chain. Existing project-backed requests reuse that project rather than creating another commitment. A standalone tracked question needs one migration-keyed Work.
4. Keep old message URLs and receipts readable through a compatibility projection. Do not run the old reply dispatcher alongside the new work watcher for the same input.
5. Validate stop/reply races and restarted sessions before moving a live chain. Migrate inactive chains first.
6. Move Builder/lead user flows to shared work cards. Retire request/reply writers only after production evidence shows new work settlement is reliable.

Do not start this migration while also changing queue ownership or event-sourcing storage. That would make failures difficult to attribute and could duplicate callbacks.

## 10. Acceptance and limits

All baseline scenarios must still pass: existing Font Maker IDs and original work, eight-person wave_sim, five markets, no quotas, imports before admission, finite background continuation, return to Chief, recurring checks and separate effects authority.

Additional decisive fixtures:

| Scenario | Evidence |
|---|---|
| Three peers discuss one deliverable | One shared work/history; no repeated private forward needed |
| Plain discussion versus tracked question | Posting creates no hidden completion obligation; tracked work has criteria/owner/watch |
| Duplicate post+attention request | One post and one attention per recipient/key |
| Child completion while parent active | One parent continuation, no concurrent callback worker |
| Work completes while lead incoming is held | Durable terminal evidence plus held callback/remedy |
| Manager removed, space membership retained | Explicit remaining access honored; management rights do not persist accidentally |
| Shared researcher crosses confidential spaces | Fresh scope context; unauthorized memory/search/export denied |
| Audience narrowed after provider saw old data | Old context no longer reusable; historical disclosure not falsely erased |
| Legacy message migration | Original IDs resolve; exactly one completion/notification path |
| Demo notification without send authority | GTM may inspect permitted evidence; email still refused |

Cross-workspace programs remain links between authorized Work, not recursive Space membership. Do not silently inherit access through parent work. Portable team export includes profiles/work/knowledge only within permitted scope; importing it creates no grants or executable schedules without current owner configuration. Arbitrary workflow programs, distributed scheduling, guaranteed mathematical discoveries and unlimited compute remain outside the contract.

## 11. When to choose this

Choose this direction when shared multi-person work is demonstrably the main product: several peers need the same discussion and evidence, the owner often enters that shared work, and private forwarding costs more than learning the shared-space model.

Do not choose it merely to fix the current permission bootstrap, default capability payload or MCP union schema. Direction 1 fixes those with fewer changes. For the current Chief-as-front-door expectation, borrow this option's explicit audiences and separation of published posts from provider context without migrating all request/reply semantics yet.

Evidence that would change the recommendation: repeated real workflows require the same shared thread for more than two participants, fail because knowledge must be forwarded repeatedly, and remain cumbersome after resource/API consolidation. Until then, this is a credible product fork rather than the smallest implementation plan.

Decision status: assistant alternative requested by owner. No new Space system was implemented or production team activated. Historical typed-resource and shared-space proposals remain preserved; see [Direction 1 source history](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md#11-source-anchors-and-decision-history).
