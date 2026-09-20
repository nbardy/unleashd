# Historical snapshot — not the current operator API

Captured 2026-09-13 before the Chief audit documentation repair.
Source: `product/buddies/DESIGN_TEAM_OPERATIONS.md`; SHA-256 `7963b24e17184cb591e3f44c34d4ed8add98bc29c285444163fce69a01a78006`.
Current workflow: [Team operator guide](../product/buddies/TEAM_OPERATOR_GUIDE.md).
The original text below is preserved verbatim, including superseded claims.

---

# Buddy team operations: one authority, composable work

Implementation contract · `2026-09-10.2` · schema 23 · September 10, 2026

## Current entry point — September 12, 2026

Owner setup is implemented. Contract `2026-09-12.1` consolidates permission editing and
revocation into Team settings through the canonical `configure_team` preview/apply flow.
The raw access PUT below is retired; its GET remains diagnostic. The saved permission
model and server checks are unchanged. See the [dated implementation](IMPLEMENTATION_TEAM_SETTINGS_2026-09-12.md)
and [current owner setup successor](DESIGN_OWNER_TEAM_SETUP.md#13-september-12-successor-one-team-settings-flow).
Earlier contract descriptions below are preserved as historical evidence.

## Historical successor notice: complete owner setup

The [owner-to-team setup redesign](DESIGN_OWNER_TEAM_SETUP.md) supersedes this document's
assumption that separate owner settings are a sufficient onboarding workflow. It defines
one owner-scoped configuration composition for new/existing staff and a full return-path
acceptance gate. That successor is a design, not yet a shipped contract. The historical
implementation and test evidence below remain intact; background execution subsequently
shipped in contract `.3` as described in [its design](DESIGN_BACKGROUND_TASK_EXECUTION.md).

This incorporates the wave_sim setup and the two existing-team handoffs. It supersedes
the unresolved management choices in the September 10 review. Historical proposals remain
evidence; their quotas, per-edit approvals and proposed tool names are not requirements.

## Core decisions

Keep Buddy, workspace membership, relationship, project/todo, document/note, message,
conversation, run and schedule. Add only an explicit owner-issued access grant. Grants
authorize specific operations on admitted targets; a title or a reporting edit cannot
create them. No hiring quotas, special Lead type, separate Assignment entity, generic
workflow engine or third execution queue.

A reporting relationship gives the existing work supervision scope. Reading or changing
private instructions/memory requires a separate grant. Grant targets are stable IDs,
not a dynamic subtree. Moving a Buddy does not move grants, credentials, money or work.
No employee tool issues or expands grants. The owner can revoke them independently.

## Data and authority

| Record | Minimum addition or retained meaning |
|---|---|
| Access grant | Grantee, workspace, target Buddy (or workspace for creation), finite capabilities, revision, optional expiry, owner reason and audit |
| Relationship | Existing canonical manager/collaboration edge; one manager, cycle rejection; preserve identities and history |
| Profile | Existing public role/runtime preferences; version checked edits; capability is separate from private document access |
| Document | Existing Buddy-owned soul/working/long-term revision ledger, with author and provenance; target reads/writes require explicit grants. General workspace-audience documents remain unfinished, as described below. |
| Project | Existing owner, deliverables/definition of done, revision, evidence; assignee acceptance is an audited status transition |
| Message | Existing request/reply plus visibility and execution projection; no editable duplicate of project status |
| Run | Existing durable attempt; expose admission reason/remedy, recipient acknowledgement and project link without claims |

Grant capabilities are finite: create staff, change relationships, read/write public
profile, read/write soul, read/write dense memory, manage incoming execution, and manage schedules. A grant for a
document class is explicit about private content. No capability implies training,
external actions, new workspace membership, credentials or a larger spending limit.

Known shared folders and same-user shell execution remain a trusted-local deployment.
Application scoping must not be advertised as OS isolation or as erasing information
already delivered to a provider. Dense memory currently belongs to the whole Buddy,
including its restricted runs. Separating owner-confidential context from team execution
is an outstanding requirement; this release does not claim that isolation.

## API composition

- `get_capabilities(targetBuddyId?)` explains effective actions, missing grants, current
  relationship, membership and execution settings. It reports the implemented contract
  version, checked against the package, so a missing/stale operation can be distinguished
  from a denied operation. Inspection itself stays available with an incompatible team
  package: `contract` contains expected/loaded versions, compatibility, code, reason and
  remedy; `ownerSetupUrl` opens the exact target and workspace in the lead's Settings.
  Team mutations still reject incompatible packages. It evaluates target scope; concrete project revisions, cycle
  checks, relationships' other endpoint and runtime gates are checked when inputs are known.
- `create_buddy` reuses the existing atomic profile/soul creation with a stable key.
  Creation and `set_relationship` are independently replayable. The old hire helper is
  a compatibility composition using those same grants and keys. It does not reactivate
  archived identities or authorize additional workspace membership.
- `set_relationship` handles manager and collaboration edges. It accepts existing IDs,
  requires authority for affected targets and never silently hires or reactivates them.
  `present:false` removes the named edge; no separate detach operation is needed.
- Existing `get_soul`, `update_soul`, `update_memory` gain a scoped target; `get_memory`
  supplies an explicit current-revision read. Full replacements require base revision,
  reason and commit-time authority; a preview returns a reviewable diff. Successful writes
  return before/after revisions and an audit reference. Unknown/protected fields reject
  the whole mutation. A lead can apply an already granted change without another approval.
- Existing project creation/update and `send` remain the assignment atoms. A stable project
  key creates recipient-owned work with deliverables; a stable send key points to it. On
  partial failure, replay completes the missing step without another identity/project/run.
  Recipient `update_project(status: in_progress)` records acceptance; `reply` records the
  final response and evidence. Queuing or claiming a run is not acknowledgement:
  `acknowledgedAt` is populated only by recipient acceptance after the message was created,
  or an explicit reply. An accepted sender-owned source project is not recipient acceptance.
  Project acceptance/completion fields refer to work owned and accepted by the recipient;
  an earlier acceptance of that project is still visible but does not acknowledge a new message.
- Message/run reads and send receipts expose a derived execution view: run ID, state,
  hold code/reason/remedy, acknowledgement, project ID, acceptance and completion evidence.
  If package compatibility prevents a reliable projection, authorized reads preserve the
  message and expose execution `unknown` with the contract blocker. Null run ID in this
  fallback means unknown, not proof of no durable run. Private participant checks still apply.
  Queued without a child conversation is valid; it must have an explainable admission state.
  `send(projectId:null)` starts an independent destination work scope while retaining
  `source_project_id`. Omission retains the usual current/follow-up project. This lets a
  completed research project hand off a new implementation project to a peer.
- Existing `set_automation` gains activation only within an explicit schedule grant.
  Configuration, staffing and schedule capabilities are separate. Merely granting access
  or connecting staff starts no work.

Owner HTTP/UI can issue/revoke bounded grants and appoint existing staff. Builder retains
its setup scope over identities it created; existing-team management uses a lead's granted
MCP context. Native employee
tools never accept an actor ID, owner flag, database path or grant mutation.

## Execution and knowledge

Project execution gates cover both legacy automation wrappers and coordination runs.
Pause/cancel fence tool calls immediately; handoff waits for all affected providers to
drain. Shared slot/concurrency checks include both paths. Finished work permits discussion,
reads and final replies; it does not permit new work mutations without explicit reopening.
Cross-workspace project parentage requires the creator and supervising parent owner to
hold the relevant memberships. No implicit membership is created.

Each new turn reads current Buddy context. A message defaults
to participants; attaching a project does not automatically publish its body to supervisors.
Supervisors may inspect task/run state without private message or memory content. MCP run
inspection removes other Buddies' provider output and private policy prompts. An explicit
project-visible message publishes its reply outcome with that work. Owner oversight retains
the full records. New grants do not erase knowledge already present in a provider session.

External email still needs a separate adapter with configured account, current authority,
demo evidence and durable effect receipts. That adapter has not been implemented or tested.
Team-operation grants never authorize email, training or paid infrastructure.

## Concrete public surface

There are 26 ordinary MCP tools, including two compatibility helpers. No employee tool
grants access. Fields below show the new contract; the Zod schemas remain authoritative
for bounds and compatibility fields.

```ts
get_capabilities({targetBuddyId?})
list_buddies({workspaceId?, limit?, offset?})
create_buddy({key, name, role, soul, provider?, model?, reasoningEffort?})
set_relationship({key, fromBuddyId, toBuddyId, kind: 'manager' | 'consults', present?})
get_profile({targetBuddyId?})
update_profile({targetBuddyId, key, baseRevision, reason,
                changes: {name?, role?, provider?, model?, reasoningEffort?, backgroundEnabled?}})

get_soul({targetBuddyId?}) // body, revision
get_memory({doc: 'working' | 'long_term', targetBuddyId?}) // content, revision
update_soul({targetBuddyId?, key?, content, baseVersion, reasoning, preview?})
update_memory({doc: 'working' | 'long_term', targetBuddyId?, key?,
               content, baseVersion, reasoning, preview?})
remember_note({body, topic?, kind?, evidence?, scope?})
recall({pattern, scope?, since?, limit?, regex?})

get_current_work({workspaceId?, buddyId?, targetBuddyId?, projectId?, includeClosed?, limit?, offset?})
new_project({key, ownerId?, workspaceId?, parentProjectId?, title, definitionOfDone, todos?, ...})
update_project({key, projectId, baseRevision, status?, ownerId?, executionState?,
                todoOperations?, evidence?, ...})
send({key, to, purpose, body, projectId?: string | null, workspaceId?, evidence?,
      visibility?: 'participants' | 'project', continueFrom?, inReplyTo?, expectsReply?,
      notBefore?, wait?, timeoutSeconds?, approval?})
reply({messageId, outcome, body, evidence})
get_message({messageId})
get_inbox({})
get_runs({projectId?, rootMessageId?, limit?, offset?})
stop({key, reason, runId? /* exactly one selector */, rootMessageId?})
retry_run({key, runId, reason})
get_automations({targetBuddyId?})
set_automation({action: 'create' | 'update' | 'disable' | 'enable', ...})
// Enable: automationId, baseRevision (updated_at string), key.
// Create/update: existing schedule, prompt/conversation and policy fields.

hire_direct_report({key, name, role, soul, ...}) // compatibility create + relationship
retire_direct_report({buddyId, reason, reassignOpenWorkToManager?})
```

Ordinary owner-directed self memory operations retain their existing scope. Target edits
require explicit read AND write grants: returning a diff is a read. Target commits require
a stable key even where the self-edit compatibility schema makes it optional. An empty
document is a valid intentional replacement. Working memory is bounded to 2,000 characters,
long-term memory to 4,000; preserve detailed source material as evidence and notes rather
than silently truncating it. Authorized soul import provisions an unconfigured canonical
profile path through the store and retains the same Buddy ID.

Historical `.2` owner routes, behind the existing authentication gate (the access PUT
was removed by the September 12 successor above):

```text
GET /api/buddies/:granteeId/access/:workspaceId
PUT /api/buddies/:granteeId/access/:workspaceId
    {targetBuddyId?, capabilities, baseRevision, key, reason, expiresAt?}
GET /api/buddies/:granteeId/capabilities/:workspaceId?targetBuddyId=...
POST /api/buddies/:targetId/reparent {managerId, key}
PATCH /api/buddies/:targetId/memberships/:workspaceId {background_enabled: true}
```

The lead's Settings → workspace → Team management access exposes the existing owner
relationship and membership controls beside grants. The target list reports the current
manager and incoming-work setting. A held message also offers the owner “Enable incoming
work”; it changes that membership and polls the original receipt, never creates a replacement
message or run. Enabling incoming work can release all queued requests admitted for that
recipient; it is not per-request approval. Recurring schedules and protected document access
remain independent. There are no new MCP tools, data tables or execution queues for recovery.

The PUT replaces one grant's complete capability set, not an additive patch. An empty set
revokes it. Creation grants target the workspace; all other grants target exact Buddy IDs.
Creation provisions initial profile/document access only for the created identity. It does
not grant incoming execution or schedule activation; these remain explicit owner choices.
Existing owner membership/profile/project/automation controls remain unchanged in purpose.
Retirement through the compatibility MCP requires a direct owner conversation, a direct
report, and target `profile.write` plus `execution.manage` grants.

## What is still outside this implementation

The two management handoffs now have a tested mechanical path. The broader business-team
program is not complete:

- General private/shared knowledge audiences, workspace-specific dense memory and isolation
  between owner-confidential provider context and restricted team execution are not delivered.
- The actual shared inbox/account is unidentified. There is no implemented outbound effect
  adapter, machine-enforced demo prerequisite, inbound deduplication or ambiguous-send recovery.
  Blocking an outreach project and writing a soul instruction are not an email send boundary.
- No live model has completed the whole natural-language Builder → lead → specialist →
  follow-up acceptance trial. Fixtures test mechanics, not independent business judgment.
- Existing sessions must load the matching app/package contract. Grants and reporting lines
  must be configured for the actual teams; this development conversation does not have
  authority to mutate those teams through another interface.

These remain in the authoritative completion project. They are not hidden behind a claim
that all historical requests or live onboarding are complete.

## Acceptance evidence

Use the native MCP boundary with a temporary durable store and the actual runtime:

1. Owner admits four existing specialists and grants selected capabilities to a lead.
2. Lead inspects capabilities, attaches the exact existing IDs and creates one new employee.
3. Permitted target profile/document reads and revision-checked imports succeed. A peer's
   private data and protected fields remain denied; stale edits lose without partial writes.
4. Lead creates bounded assignee-owned projects, dispatches them, sees actionable queue
   state, and distinguishes receipt, acknowledgement, acceptance and evidence of completion.
5. Lead follows up in the same recipient thread; replay creates no duplicates.
6. Revocation fences a previously permitted mutation and queued/running protected actions.
7. Appointment and profile editing create no provider run, schedule, training or external action.
8. With two existing held requests, simulate missing/mismatched team package methods through
   the MCP boundary. Diagnostics remain readable and mutations deny. Restore the matching
   runtime, use the real owner HTTP controls to attach/grant/enable, then claim and finish the
   original runs with recipient replies. Repeating configuration creates no duplicate work.
9. The wave_sim eight-person setup still passes. Existing Font Maker identities stay intact;
   the archived duplicate is never selected by name or reactivated.

Deployment evidence must state the actual loaded tool contract and native read results.
Fresh code/tests alone do not prove an existing provider session has refreshed its tools.
