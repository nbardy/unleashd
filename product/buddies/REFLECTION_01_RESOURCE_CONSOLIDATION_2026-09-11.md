# Direction 1 — consolidate the typed resource contract

2026-09-11, Asia/Makassar. **Recommendation for discussion, not an accepted redesign or an implementation claim.** This is the first of three new alternatives after the `.4` implementation review. It preserves the decisions and implementation in [owner team setup](DESIGN_OWNER_TEAM_SETUP.md), then proposes a smaller public contract. The other alternatives are [typed change sets](REFLECTION_02_TYPED_CHANGESETS_2026-09-11.md) and [shared workspaces](REFLECTION_03_SHARED_WORKSPACES_2026-09-11.md).

## Judgment

Keep the existing resource architecture. Simplify the paths through it before replacing its nouns. Builder, owner chat, employee chat and Settings should call the same resource services. Their authenticated authority differs; their definitions of a Buddy, document, project or message should not.

The smallest useful system is not the one with the fewest tables or MCP names. It is the one with the fewest independently implemented rules. A permission check, a durable write, its audit and its result should have one implementation.

This direction best fits the observed problem: private conversations with a Chief who coordinates leads. It has the least migration risk and preserves the verified background-work loop. It still needs explicit knowledge scope and an external-action adapter to fulfill the whole business scenario.

## 1. What changed since the earlier alternatives

The September 9 alternatives compared typed resources, event sourcing and shared spaces. Since then, owner setup, private-document grants, background continuation and return-to-lead execution were implemented. Repeating that architecture selection from scratch would ignore useful evidence.

Fresh inspection during this review reports matching package/host contract `2026-09-10.4`, with owner `configure_team` exposed. Default `get_capabilities({})` still returns 20,277 JSON bytes, repeats its target, and reports `intent:null, ready:true`. Builder still limits document/project tools to identities created in that Builder conversation. The native audit is `audit_f81b80c1-0df5-4cff-bbd6-1fc2e476d09a`.

The prior implementation handoff reports 85 package tests, 292 server tests, 74 client tests and an isolated real-provider owner → specialist → evidence → lead flow. Those are historical results, not tests rerun for this document and not proof that production Font Maker or wave_sim is configured.

The old briefs contain superseded quota recipes. **No option here restores quotas.** Runtime concurrency/time limits protect execution; they do not ration identities.

## 2. Three solutions to each current design concern

| Concern | 1. Resource consolidation | 2. Typed change sets | 3. Shared workspaces |
|---|---|---|---|
| Builder versus lead setup | Same typed services and owner tool projection in either chat | Same closed change-set command everywhere | Same space setup and membership operations everywhere |
| Too much capability output | Compact, paginated decisions for requested actions | Preview the exact proposed changes | Inspect action against space/work membership |
| Generic `ready:true` | Omitted action means `not_evaluated` | Preparation is per change set; execution inspected separately | Readiness names work, attention target and return route |
| MCP/schema drift | One schema registry, named tool projections and fixed output envelopes | Closed nested command union, small top-level tool set | Typed space/work/post/document tools |
| Four soul/memory read/write tools | One document family, kind-specific policy | One `document.replace` change variant | Documents and private memory belong to explicit spaces |
| Incomplete setup after interruption | Existing keyed receipts resume each phase | One atomic database batch for compatible setup writes | Keyed space setup, then publication and attention |
| Private versus shared knowledge | Scope on content and context keys; no new Space entity | Same scope model, batched publication metadata | One audience per Space; separate private contexts |
| Background work and follow-up | Retain project + send + runs + reply | Retain runtime commands outside configuration transactions | Work + posts + attention replace paired requests |
| Decision history | Typed audit + authored versioned evidence | Change receipt groups audit facts | Work activity + published decision records |
| Main cost | Remaining multi-step onboarding composition | Batch planner, dependency ordering and transaction semantics | Migration to shared threads, membership and attention |

An event ledger is not one of the new three. It would add reducers, replay versions and projection recovery while leaving the observed onboarding and permission problems to solve. Keep causation IDs and immutable history; do not replace current-state authority merely to obtain them.

## 3. Reference requirements

### wave_sim

One ordinary Project Lead manages Go to Market, Product, Wave Simulation and Frontier Research leads. GTM manages Market Research. Product manages Product Engineer and Product Designer. Product can consult Market Research without giving it a second manager. Eight identities total; reuse exact existing IDs when present.

All relevant roles understand wave pool, surfboard, boat hull, hydrofoil and coastal engineering use cases. “Coastal engineering is the biggest market” remains the owner's hypothesis until researched. The designer critiques usefulness and scope. Frontier Research hands documented, reviewed results to Simulation; exploratory claims do not become engineering facts automatically.

GTM can research prospects and prepare interviews before demos. Sending requires accepted demo evidence, an identified mailbox and separate external-send authority. An unspecified folder under `~/git` is not an account or permission. Staff below the lead can be collapsed in navigation and still be discoverable.

### Existing-team recovery

Font Maker must adopt Chief, Pixel and Path, import required handoffs, preserve original messages, enable both workers and the lead return path, then inspect actual starts and results. Basketball must discover contacts in permitted workspaces without gaining permission to message or inspect private knowledge merely by finding them.

Across both: no duplicate identities, projects or runs after retries; precise blockers; no new approval question when current owner direction already covers the action; no authority inferred from quoted handoffs.

## 4. Minimal model and authority

These are semantic types, not a proposed generic JSON table. Existing tables and IDs remain authoritative.

| Resource | Owns | Constraints |
|---|---|---|
| Buddy | Identity, role, lifecycle, execution profile | Ordinary identity; one home workspace; no quota |
| Membership / relationship / grant | Workspace participation, management, explicit extra rights | One acyclic manager; collaboration separate; target/scope/expiry explicit |
| Project / task | Accountable owner, criteria, progress and evidence | One owner; task edits use project concurrency boundary |
| Document / note | Versioned knowledge / append-only decision evidence | Scope and provenance; notes are not mutable task state |
| Message | Addressed communication, return route and final disposition | Purpose is free text; lifecycle is typed |
| Run | One bounded attempt against durable input | Private claim, immutable ceiling, cancellation fence and drain |
| Schedule | Repeated production of bounded input | Exactly one scheduler owner per occurrence |
| Command receipt / audit | Deduplication and what committed | Not another project, plan or approval queue |

Reuse existing Workspace and Conversation. A team is a membership/relationship view. A lead is an ordinary Buddy. Assignment is project ownership plus dispatch. A goal is the project's criteria. Readiness and inbox are queries. None needs a new durable entity.

Proposed common wire conventions:

```ts
type Id = string;                  // opaque, resource validation at the boundary
type Revision = string;            // opaque wire token, not client arithmetic
type Key = string;                 // stable per logical mutation
type Page<T> = { items: T[]; nextCursor: string | null };
type Versioned<T> = { value: T; revision: Revision };
type Problem = {
  code: string; path: string; message: string;
  resolver: 'owner' | 'buddy' | 'runtime'; remedy: string;
};
type Result<T> =
  | { ok: true; data: T; receiptId: Id | null; auditId: Id }
  | { ok: false; problems: Problem[]; auditId: Id };
type Scope =
  | { kind: 'owner_thread'; conversationId: Id }
  | { kind: 'project'; projectId: Id }
  | { kind: 'workspace'; workspaceId: Id };
type EvidenceRef =
  | { kind: 'document'; id: Id; revision: Revision; explanation: string }
  | { kind: 'artifact'; uri: string; sha256: string; explanation: string }
  | { kind: 'run'; id: Id; explanation: string };
type WorkSpec = {
  workspaceId: Id; ownerId: Id; parentProjectId?: Id;
  title: string; definitionOfDone: string;
  tasks: { title: string; definitionOfDone: string }[];
};
type DocumentRef =
  | { kind: 'soul'; buddyId: Id }
  | { kind: 'working' | 'long_term'; buddyId: Id; scope: Scope }
  | { kind: 'shared'; id: Id };
```

These sketches define the proposed public vocabulary. Runtime Zod bounds, dates and resource authorization remain mandatory. Existing numeric document/project revisions and opaque automation revisions are not interchangeable: adapters encode them into opaque tokens and decode by resource. Do not rewrite historical counters or pretend a plan hash is a row revision. Compatibility APIs keep their old shapes until retired.

A task's `done` means its accountable worker has supplied evidence for the current criteria. Independent acceptance, when required, is a separate review project owned by the lead with references to that exact criteria/evidence revision. This avoids a universal second completion flag and preserves the distinction between worker completion and lead approval.

## 5. API and MCP

### One service, appropriate authority

Each service receives a private, host-produced context: principal, workspace scope, source input, active turn/claim and immutable restrictions. None is model-writable. Owner operations use fresh owner-input authority. Employee operations use saved grants intersected with their run policy and current revocation state.

Builder becomes an owner-facing composition/view, not another CRUD implementation. In either Builder or a lead's owner chat, the owner projection can inspect and update explicitly in-scope existing resources through the same service. Discovery alone never expands that scope. During an employee callback in the same visible chat, only the employee projection is exposed.

The host proves owner provenance and allowed scope; it does not prove semantic correspondence between arbitrary natural-language intent and every argument. The acting assistant must keep actions within the owner's direction; preview makes the concrete effect reviewable. Preview is not another mandatory human approval when authority already exists.

### Proposed signatures and transport mapping

| Service / MCP | Shape and side effect | HTTP projection |
|---|---|---|
| `list_buddies` | `{scope:'current'|'permitted',query?,cursor?,limit?}` → one `Page<Contact>` | GET buddies |
| `get_capabilities` | Optional exact checks; bounded target decisions, no content | GET capabilities |
| `configure_team` (owner) | Existing keyed configuration preview/apply | POST team-configuration |
| `get_document` | `{ref:DocumentRef}` → content/revision/scope | GET document |
| `update_document` | `{ref,key,revision,content,reason,preview}` → diff or committed revision | PUT document |
| `remember_note`, `recall` | Append/search authorized evidence, bounded and scope-aware | POST/GET notes |
| `get_profile`, `update_profile` | Typed execution/identity settings; changed fields determine permission | GET/PATCH profile |
| `new_project`, `update_project`, `get_current_work` | Retain work semantics; stable keys, one page shape | Existing project routes |
| `send`, `reply`, `get_message` | Addressed work/questions/results, typed receipts | Existing message routes |
| `get_runs`, `stop`, `retry_run` | Inspect/control execution with existing fencing | Existing run routes |
| Schedule tools | Object-root schemas per action; same schedule service | Existing automation routes |

This is a target API, not a list of tools currently installed. `get_document`/`update_document` replace the soul and memory pairs in the new catalog; the old four operations remain compatibility adapters. Notes stay separate because append and replace have different invariants. Keep profile separate from prose documents because its fields control behavior.

A single canonical schema registry owns strict inputs, outputs, authorization policy and tool metadata. HTTP, SDK, UI and MCP are projections. Use a nested discriminated object when providers support it; otherwise expose action-specific schedule tools generated from the same variants. Never flatten a discriminated union into optional fields and advertise invalid combinations as if they were valid. More accurate names can be simpler than one large polymorphic name.

Default outputs omit audit payloads, repeated role maps and unchanged full documents. Return compact facts plus IDs; authorized detail is opt-in and paginated. A discovered contact returns name, role and permitted routes, not memory or grants for unrelated identities. `targetBuddyId` is the sole public name; legacy synonyms remain only in adapters.

### Action-specific inspection

```ts
type Check =
  | { kind: 'dispatch'; recipientId: Id; projectId: Id; returnTo?: Id }
  | { kind: 'document_write'; ref: DocumentRef }
  | { kind: 'configure'; targetIds: Id[] }
  | { kind: 'schedule'; buddyId: Id; workspaceId: Id };
type Readiness =
  | { state: 'not_evaluated' }
  | { state: 'evaluated'; checkedAt: string; checks: {
      requested: Check;
      authorization: 'allowed' | 'denied' | 'unknown';
      admission: 'eligible' | 'held' | 'not_applicable' | 'unknown';
      problems: Problem[];
    }[] };
```

No action requested means no readiness claim. Read access, mutation permission, configuration eligibility and observed execution are separate facts. A worker can be configured correctly while a slot is occupied. Historical grants can be correct while the active run's policy excludes an operation. Report both without saying “ready to do everything.”

Inspection is advisory, never a reusable authorization token. Mutations and admission recheck current state. The common policy evaluator supplies both inspection and enforcement so diagnostics do not invent a parallel policy implementation. Detailed before/after previews require read permission; unavailable resources do not leak existence through errors.

### Cleaner send shape without a new start primitive

Keep `send`, but distinguish modes in its typed payload rather than a matrix of independent booleans:

```ts
type Delivery =
  | { kind: 'inform'; inReplyTo?: Id }
  | { kind: 'request'; continueFrom?: Id }
  | { kind: 'work'; projectId: Id; maxRuns: number; maxDurationSeconds: number };
type Send = {
  key: Key; to: Id | 'owner'; workspaceId: Id; body: string;
  purpose: string; delivery: Delivery; notBefore?: string;
};
```

The `work` variant maps to today's `execution:{mode:'until_done'}` and always requests a terminal result. `inform` never creates a reply obligation. It may wake the recipient under normal admission, but not recursively demand a reply. `request` preserves addressed questions and continuation. Work-to-owner is invalid. A synchronous wait is a read/wait adapter, not part of the durable send command. The original callback route is host-bound to the initiating conversation; model arguments cannot select an arbitrary private thread.

## 6. Compose the workflows

### Onboard new and existing staff in the same place

1. Search permitted contacts; bind exact existing IDs and stable creation keys for missing people. Ambiguous identity matches require disambiguation, not a guess or replacement.
2. Owner `configure_team` preview → apply: roster, memberships, requested grants and relationships. Required imports keep new/held participants held. Existing unrelated active work is not silently stopped.
3. `get_document` → revision/diff preview → `update_document` for required handoffs. Preserve unrelated content; import authored knowledge, not stale handoff task statuses. Verify committed revisions/projections.
4. Save recipient-owned projects and criteria using stable keys. Inspect original queued messages instead of redispatching them.
5. Preview → apply a second keyed configuration enabling workers **and the lead receiving returns**, after verifying required imports. The activation uses current configuration versions; a revoked grant is not silently restored.
6. For new assignments, `send(work)`; for original held assignments, inspect their original receipt as admission resumes. Verify run start, worker acknowledgment and project acceptance separately.

Two database phases are appropriate because import/projection and running providers are not one transaction. The UI renders one resumable workflow from receipts; it does not need a durable Onboarding entity. “Operational” requires the original round trip, not merely successful configuration.

### Lead → Product → engineer/designer → lead

Project Lead creates a Product-owned project and sends bounded work. Product accepts, creates Engineer and Designer child projects, and sends each. Child results wake/coalesce the waiting Product obligation. Product checks evidence, records review work if needed, and finishes its project. The terminal result returns to Project Lead's original chat with fresh employee authority. A request for revision is new bounded work or an explicit reopen with new criteria/revision, not erasure of the old result.

### Shared researcher and frontier handoff

GTM remains Market Research's manager. Product receives explicit work collaboration/dispatch access. The researcher publishes a scoped market brief; Product consumes the published revision. Private GTM notes are not included. A separate review project checks theoretical evidence from Frontier Research; Simulation receives accepted artifact references and new implementation criteria. No new handoff object is required.

### Recurring Chief check

An explicitly authorized schedule creates one bounded Chief input per occurrence, targeting the chosen existing thread. It queries current work and unhandled result IDs and steers via ordinary messages. Completion events supply immediate returns; polling is for periodic review, not the only way to discover completion. Occurrence IDs deduplicate ticks; overlapping ticks coalesce/hold under one declared policy. Missed ticks do not create an unlimited catch-up storm. No owner authority survives into scheduled turns.

### Stop, resume and uncertainty

Stop fences the chain before provider drain; late replies remain historical without restarting stopped work. Exhaustion reports a limit with unfinished work. Interrupted external effects are inspected before retry. A new keyed work request resumes the same project after a terminal managed request; replaying the old key returns history. Work ownership changes drain old authority before the new owner starts. Failed return admission leaves a durable visible result with a remedy, not a lost completion.

## 7. Knowledge, visibility and memory

This is a proposed extension, not delivered privacy. Put a concrete scope on documents, notes, published evidence and messages. Private addressed messages remain participant-readable even when they refer to a readable project; explicit publication makes content project-visible. Do not infer sharing from a project foreign key.

Context identity becomes `(buddy, scope, audienceRevision)`, separate from the visible conversation. A narrower or changed audience gets a fresh provider context. It may reuse authorized public summaries; it cannot resume a private provider state and rely on instructions to forget it. A shared researcher has separate project contexts and per-scope compact memory.

A shared-run role brief is a curated document containing approved portable role/style. The existing soul is not automatically public: using its full content in a shared context needs deliberate disclosure authority. Historical global memories and potentially private soul material are quarantined from new shared contexts until explicitly curated. This uses the same document primitive, not a new personality entity. An owner can inspect private material through owner controls without making it input to another Buddy's team run. Scope narrowing revokes future reads/context reuse but cannot undo prior disclosure.

The accepted independent memory reviewer remains a separate, bounded, memory-only role. Under this proposal, “review all memory” becomes **all memory authorized in the source context**, not every private compartment. It cannot move knowledge between scopes, change soul or continue work. This is an explicit proposed successor to the previous global-memory policy and needs selection with the broader privacy change.

Keep four histories distinct: provider transcript, machine audit, authored decision notes, and compact memory. They share immutable references/causation, not one undifferentiated log. Changes to decisions append successors with motivations and evidence. Search, exports, error details, citations and the reviewer's inputs enforce the same audience checks.

A local process with unrestricted shell access under the owner's UID is not an enforced confidentiality boundary. Hard isolation needs restricted credentials/files/tools and provider-session separation. Until deployed, describe this as application/context isolation and do not promise adversarial containment.

## 8. External actions and real business use

Use one narrow integration service for real mailbox sends. It owns account IDs, authorization, exact draft version, required accepted demo evidence, idempotency key and provider receipt. A typed effect request is separate from a Buddy message. This adds necessary integration bookkeeping, not a second work tracker.

At the send boundary check current authority and the pinned demo acceptance, not just `project.status === 'done'`. Changed drafts or criteria invalidate an earlier approval. A timeout after a possible provider send is `unknown`, reconciled by provider ID/key; never blindly resend. Inbound messages deduplicate by account/provider event ID. Revocation fences new effects, but cannot undo an already accepted email.

Training, paid GPU runs and external publishing have their own authority. A schedule or team grant does not confer it. Preparing artifacts is permitted independently from submitting an effect. Demo gating is enforceable only when all applicable sends traverse the adapter and worker credentials cannot bypass it.

## 9. What we delete and how we migrate

| Delete/consolidate | Replacement | Migration guard |
|---|---|---|
| Builder-specific CRUD and created-hire edit scope | Shared services plus owner-scoped targets | Existing Builder receipt IDs still resolve; no ambient impersonation |
| Top-level target plus repeated `targets[]` | One bounded target/check collection | New contract version; compatibility responses at old edge |
| Generic ready boolean | Requested-action decisions | Callers cannot treat unevaluated as success |
| Soul/memory tool duplication | Typed document read/replace | Preserve different policies, caps and revision histories |
| Hire aliases in new MCP catalog | Create identity + relationship | Keep historical handler/receipt decoding only |
| Array-versus-page results | One page envelope | Explicit protocol version, not shape guessing |
| Lossy MCP union flattening | Exact nested schema or generated action tools | Validate both advertised and handler schemas |
| Special-case completion dispatchers | One run/reconciliation service | One queue owner per occurrence; compare real traces before cutover |

Start with contract consolidation; no new domain table is required. Then add knowledge scope and context partitioning as a separately migrated capability. Connect an identified mailbox last. Do not announce the whole business system complete after finishing only the first phase.

No big-bang row renames, new event store, general workflow DSL, durable Team class, Goal table or self-grant tool. Keep legacy readers until usage and restore tests justify removing them; do not keep advertising obsolete operations to new sessions.

## 10. Acceptance and falsification

Run the same natural-language fixtures against `.4` and the candidate, starting with **unconfigured existing staff and no preloaded grants**. Inspect native persisted effects and real provider runs, not response prose.

| Fixture | Pass evidence |
|---|---|
| Font Maker in one owner chat | Existing IDs and original messages retained; docs imported before admission; worker result returns to Chief |
| wave_sim full roster | Exactly eight intended identities, correct manager/consults links, criteria on work, no email action |
| Builder adopts an old specialist | Same get/edit/project operations work within owner scope, without switching chats |
| Duplicate setup/start and crash between phases | Same IDs/receipts; no new run; revoked grants stay revoked; projection failure repairable |
| Specific versus empty inspection | No action gives `not_evaluated`; dispatch checks both outbound and return; no duplicated target |
| Owner turn ends, employee callback arrives | Owner tools/credentials absent; saved employee grants only |
| Evidence and review | Provider exit alone never closes work; changed criteria invalidate stale evidence; lead review can reject |
| Stop/late child result/deadline/restart | No resurrection, no parallel parent continuation, foreground deadline preserved |
| Private context reused across projects | Attempt rejected/fresh context; search/export/reviewer cannot expose the other scope |
| Demo absent, draft changed, send timeout | Send refused or marked unknown as appropriate; no duplicate external effect |

Measure successful completion, unnecessary owner interventions, schema errors, duplicate effects and truthful blocker reporting first. Measure tool count, response bytes and latency second. Compare deterministic domain checks with repeated real-provider journeys; do not infer model reliability from one good run.

Reject this recommendation if shared multi-person discussion is the dominant daily workflow and addressed private handoffs create sustained duplication even after consolidation. That would favor Direction 3. Choose Direction 2 only if atomic multi-resource edits become a repeated need beyond this one setup workflow.

### Cases that need an explicit limit or another capability

| Case | Smallest honest contract across the alternatives |
|---|---|
| Cross-workspace program | Explicit authorized work references; keep containment local. No inherited access through a cross-workspace parent. Cross-workspace dependency admission requires its own typed implementation. |
| Task prerequisites | A lead can wait on child result messages today. General machine-enforced prerequisites need typed edges to exact required work/evidence, cycle detection and a current-read check at admission; do not treat a prose blocker as that feature. |
| Reassign or retire someone | Preserve identity/history; drain affected active work; explicitly transfer open commitments and decide which separately granted rights to revoke. A manager edit alone is not full offboarding. |
| Discuss completed work | Informational/review input may reference completed evidence without re-enabling the completed project's worker. Follow-on work gets its own criteria and execution request. |
| Lead away or return thread deleted | Keep the result durable with an actionable return blocker. Routing to a replacement lead/thread requires explicit authorized retargeting; never silently impersonate the former lead. |
| Many people in one discussion | Addressed messages remain adequate for private handoffs. Native shared discussion is a genuine capability change, represented by Direction 3. |
| Portable team import/export | Export permitted content and references, not credentials, live claims or authority. Import reuses keyed identities; schedules/grants require fresh authorized configuration. |
| Hard spending cap | Finite runtime limits are not dollar accounting. A measured-cost/reservation mechanism is additional work before advertising a hard spend limit. |
| App offline or host crash | Durable queue/history survives; execution requires an online executor. Unknown in-flight work becomes interrupted, not silently adopted. |
| Out-of-band email or unrestricted files | Application permissions cannot constrain another tool holding the owner's credentials. Restricted effect/file access is a deployment capability, not another MCP description. |

These are not reasons to build a generic workflow engine now. They are explicit boundaries that keep a smaller implementation honest and provide concrete triggers for future additions.

## 11. Source anchors and decision history

Decision-maker: Buddies Development Lead recommendation, requested by owner for reflection. Accepted foundation: simple atoms, no quotas, criteria on tasks, `.4` owner setup. Proposed successors: consolidated surfaces, scoped memory, revised wire shapes. No production staff changes or software implementation occurred in this review.

Historical implementation anchor: package commit `55c7681f1e4b19664c116308f2329445e4df70e2`; [implementation handoff](../../agent_notes/2026-09-10_owner-team-setup-implementation-handoff.md). The working app HEAD observed here is `1187a8b6660b95c0c60bd8fada105f015b98cc39` with uncommitted changes, so HEAD alone does not pin source.

Snapshot anchors for the specific findings (read on 2026-09-11 local time):

| Source | SHA-256 | Preserved fact/excerpt |
|---|---|---|
| [team readiness](../../server/src/buddies/team-readiness.ts) | `8a31f6a977ae1078618abac94cd9c1b6790b7fcb962be53a7e3ad2091d77f366` | `...single`, `targets: inspections`, `intent: input.intent ?? null`, `ready: contract.compatible && blockers.length === 0` |
| [Builder](../../server/src/buddies/builder.ts) | `2a27e7e8b10adb1d109a401c4411dd5839184b04f6e8e0198ce9a4f4d8b134c8` | “For adopted existing staff … continue private-document imports or project maintenance in the lead's owner conversation” (punctuation normalized) |
| [MCP input adapter](../../server/src/buddies/mcp-input-schema.ts) | `70c1d49debcb6f4a09ec5e9cffe9f6c8fa6e78f34f2c5d5de3d8a2dccaee55cc` | Combines variant fields with `z.union(plain ...)`; absent variant fields become optional |
| [team configuration schema](../../shared/src/buddy-team-configuration.ts) | `a96c2e95343aab4d6e79e50794e34c4786dc2d44f47fcaa624cc54eb9339595f` | Configuration has create/memberships/relationships/access/staffing; apply requires prepared plan hash |

Predecessor review: [fresh `.4` reflection note](../../agent_notes/20260910T155313Z_01M260BV5P7VWV2WVT6K8XEX1Y_fresh-design-review-4-active-core-sound-public-s_buddies-development-lead_fe6ef8cd.md). Earlier architecture alternatives: [typed resources](REDESIGN_01_TYPED_RESOURCES.md), [event ledger](REDESIGN_02_EVENT_LEDGER.md), [shared spaces](REDESIGN_03_SHARED_SPACES.md). Current task execution semantics: [background work](DESIGN_BACKGROUND_TASK_EXECUTION.md). Mutable historical docs can contain older readiness claims; the dated evidence above is the basis for this comparison.
