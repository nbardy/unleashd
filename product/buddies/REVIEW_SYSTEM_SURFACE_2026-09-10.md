# Buddies: system surface, use cases, and readiness

## Later implementation checkpoint

The subsequent [owner-to-team setup redesign](DESIGN_OWNER_TEAM_SETUP.md) addresses the
live onboarding failures that the mechanical team tests did not cover. It is the latest
setup design; its owner control and complete acceptance path are not shipped yet.

The review below preserves its earlier September 10 findings and test snapshot.
[Team operations](DESIGN_TEAM_OPERATIONS.md) and the
[return handoff](../../agent_notes/2026-09-10_buddy-team-operations-return-handoff.md)
record the subsequent implementation, contract `2026-09-10.2`, verification and remaining
privacy/inbox/live-acceptance gaps. Read those for current team-management instructions.

Reviewed 2026-09-10 against the working application and its installed schema-22 package.

The core design is strong enough to keep and the wave_sim team setup is ready for a
supervised first trial after the running application loads the changes. The whole
business-running system is **not fully implemented or live-validated**. This review
distinguishes the current contract from broader proposals and gives an implementation order.

## 1. What is settled

An employee is an ordinary Buddy. Chief of Staff, lead, engineer, designer and researcher
are responsibilities expressed through identity, relationships and work. They need no
special runtime classes. A direct report is persistent; a harness sub-agent is temporary.

The owner rejected hiring quotas on September 9. Creating an identity and connecting it
to a manager are independent operations. The new implementation removes quota admission
checks and controls. The legacy database column is inert compatibility data. Execution
limits apply to model work and remain separate from the reporting graph.

Keep the current typed resource architecture. Use messages for requests, evidence-bearing
replies for results, and schedules for repeated inputs. Keep projects as the authority for
commitments and documents/notes as the authority for learning. A conversation carries
context; each execution is a separate run with fresh authority.

The [Builder contract](DESIGN_BUILDER_TEAM_SETUP.md) is implemented. The
[coordination contract](DESIGN_BUDDY_COORDINATION.md) remains the intended execution design
with the differences recorded below. The three whole-system redesigns are alternatives,
not three accepted or delivered architectures:
[typed resources](REDESIGN_01_TYPED_RESOURCES.md),
[event ledger](REDESIGN_02_EVENT_LEDGER.md),
[shared spaces](REDESIGN_03_SHARED_SPACES.md).
Their historical quota and background-default recipes are superseded by the Builder contract.

## 2. Final core data model to retain

This is a semantic projection of actual resources, not replacement SQL or a second set of
wire types. Existing identifiers, timestamps and compatibility fields remain in source.

| Resource | Minimal information | Current authority / limit |
|---|---|---|
| Buddy | ID, name, role, status, home workspace, execution profile | `buddies`; no separate lead or sub-Buddy entity |
| Workspace | ID, name, root path | Existing workspace store; a folder is not a sandbox |
| Membership | Buddy + workspace; read/dispatch/background settings and execution limits | `buddy_projects` is the legacy table name for memberships, not owned work |
| Relationship | From Buddy, to Buddy, kind | Canonical `manager` edge; one manager and no cycles. `consults` permits a second collaboration connection without a second manager |
| Project | Owner, workspace, optional parent, objective, definition of done, status, revision, execution state, evidence | `owned_projects`; parent and child currently must share a workspace |
| Todo | Project, title, status, order, completion definition, blocker/next action | Flat children of a project; further decomposition uses child projects |
| Memory document | Buddy, kind, body, revision, reason, provenance | Existing immutable revisions and document heads for soul/working/long-term; files are projections |
| Note | Buddy/workspace provenance, topic/kind, body, evidence, timestamp | Append-only workspace notes searched on demand; no automatic task-status copying |
| Message | Sender, recipient or owner, workspace/project, purpose, body/evidence, source/recipient thread, lineage, optional delay, expected reply, final result | Existing request/reply record; open purpose/outcome strings |
| Conversation | Thread ID, transcript, configuration and Buddy link | Existing Conversation runtime; does not itself confer permanent execution authority |
| Run | Input reference/key, attempt, Buddy/workspace/thread/project, lineage, readiness, status, deadline, private claim, policy, outcome/error | Durable execution queue; public projections omit credentials |
| Schedule | Buddy/workspace/thread, optional project, prompt, cron/interval/timezone, policy, enabled state and next due | Existing automation definitions; current-thread prompts feed the run queue |
| Receipt / audit | Command identity and result; actor, operation, time, provenance | Reliability and inspection records, not new user work objects |

No Team table is required for this reporting tree. “On a team” currently means workspace
membership plus relationships. Named teams with an independent roster or project-specific
collaborator grants are not implemented. Add such a relation only when that distinction is
needed; do not create another employee type.

Project status and permission to execute are separate. The internal execution states are
`enabled | paused | draining | cancelled`; callers request enabled, paused or cancelled,
while draining represents ownership transfer. Revision checks protect concurrent changes.
Completion requires evidence. An outcome string on a message does not complete a project.

There are still two execution record families: new `buddy_runs` and older automation runs.
The logical model is smaller than the physical implementation today. Consolidating those
paths is material remaining work, not a reason to add a third queue.

## 3. API and MCP surface that actually exists

Canonical input definitions are in [operations.ts](../../server/src/buddies/operations.ts)
and [builder.ts](../../server/src/buddies/builder.ts). Registration and per-context exposure
live in [mcp-server.ts](../../server/src/buddies/mcp-server.ts) and
[builder-mcp-server.ts](../../server/src/buddies/builder-mcp-server.ts).
MCP supplies identity/workspace/run authority outside tool arguments. Availability depends
on the current conversation; knowing an operation name does not grant it.

### Builder tools

| Tool | Signature / behavior |
|---|---|
| `list_workspaces` | Discover registered folders |
| `list_buddies` | Discover existing identities before creating duplicates |
| `list_created_buddies` | Read this Builder conversation's saved identities, relationships, work and background setting |
| `create_buddy` | `{creationKey?, workspaceId?, workspacePath?, workspaceName?, additionalWorkspacePaths?, name, role, soul, managerBuddyId?, backgroundEnabled?, provider?, model?, reasoningEffort?}` |
| `set_relationship` | `{key, fromBuddyId, toBuddyId, kind: 'manager' | 'consults'}` |
| `new_project` | `{key, buddyId, workspaceId?, parentProjectId?, title, objective?, definitionOfDone, status?: 'backlog' | 'ready' | 'blocked', nextAction?, blockedReason?}` |
| `get_soul` / `update_soul` | Read and revision-check the soul of a saved Buddy from this Builder conversation |
| `update_profile` | Change the provider/model/effort of a saved Buddy from this conversation |

The setup writer is deliberately scoped to identities created in that conversation.
Reorganizing preexisting staff uses owner controls. A stable creation key should be supplied
even though the compatibility schema makes it optional. Changed arguments under a saved key
are rejected. Replaying setup preserves later owner changes and returns canonical current work.

### Ordinary employee tools

The following are concise signatures; source schemas define bounds and optional legacy fields.
Always supply stable keys for new coordinated mutations. Project writes in coordinated runs
require them even where compatibility schemas still accept omission.

```ts
list_buddies({ workspaceId?, limit?, offset? })
get_current_work({ workspaceId?, buddyId?, projectId?, targetBuddyId?,
                   includeClosed?, limit?, offset? })
get_inbox({})
get_message({ messageId })
get_runs({ projectId?, rootMessageId?, limit?, offset? })

new_project({ key, ownerId?, workspaceId?, parentProjectId?, title,
              objective?, definitionOfDone, status?, todos?, ... })
update_project({ key, projectId, baseRevision, status?, ownerId?,
                 executionState?, todoOperations?, evidence?, approvalId?, ... })

send({ key, to, purpose, body, evidence?, workspaceId?, projectId?,
       continueFrom?, inReplyTo?, notBefore?, expectsReply?,
       wait?, timeoutSeconds?, approval? })
reply({ messageId, outcome, body, evidence })

stop({ key, reason, runId? /* exactly one target */ , rootMessageId? })
retry_run({ key, runId, reason })

get_automations({ targetBuddyId? })
set_automation({ action: 'create', key?, targetBuddyId?, projectId?,
                 name, prompt?, conversationId?, scheduleKind: 'cron' | 'interval',
                 scheduleExpression, timezone?, policy?, ... })
// Also update and disable variants. Creation is DISABLED, not scheduled execution.

get_soul({})
update_soul({ content, reasoning, baseVersion })
update_memory({ doc: 'working' | 'long_term', content, reasoning, baseVersion })
remember_note({ topic?, kind?, body, evidence?, scope? })
recall({ pattern, scope?, since?, limit?, regex? })

hire_direct_report({ ... })
retire_direct_report({ ... })
```

Important behavior:

- `reply` has no command `key` argument. Settlement is tied to the assigned message and
  responding identity/conversation; evidence is required.
- A fresh send creates a recipient conversation. `continueFrom` references the earlier
  message and reuses its recipient thread. `inReplyTo` sends informational progress back
  along the stored return route with `expectsReply: false`.
- A final reply queues a fresh bounded run in the source thread. The old run is not revived.
  A lead may finish its turn while waiting for engineers without failing the request.
- Waiting defaults to false. An explicit wait defaults to 120 seconds and is capped at 600.
  Timeout stops waiting, not the recipient's ability to reply later.
- A delayed self-send requires a bounded source run and `expectsReply: false`.
- Direct-report creation remains a convenience operation. Automated/delegated recipient
  conversations cannot hire, reparent staff or grant themselves more tools. Removing quotas
  did not remove these authority boundaries.
- `set_automation` can draft or disable a schedule. The authenticated owner surface enables
  it. A prompt without `conversationId` uses the current linked conversation. A background
  message run's allowlist does not expose schedule creation.
- Structured executable approval currently covers exact `buddy.update_project` control
  arguments, revision and expiry. `purpose: 'approval'` alone never authorizes an external action.

### Owner HTTP and internal execution

[routes.ts](../../server/src/buddies/routes.ts) contains the owner API:

| Area | Representative routes under `/api/buddies` |
|---|---|
| Setup and inspection | `POST /builder`, `GET /builder/:conversationId/results`, `GET /overview`, `GET /:buddyId` |
| Organization | `PATCH /:buddyId/profile`, `POST /:buddyId/relationships`, `POST /:buddyId/reparent`, `PATCH /:buddyId/memberships/:workspaceId` |
| Work | `GET/POST /:buddyId/projects`, `PATCH /projects/:projectId`, `PATCH /projects/:projectId/execution` |
| Messages | `GET /messages`, `POST /:buddyId/messages`, `POST /messages/:messageId/reply` for owner replies |
| Execution | `GET /:buddyId/coordination`, `POST /runs/:runId/{cancel,repair,retry}`, `POST /messages/:messageId/stop` |
| Knowledge | `GET/PUT /:buddyId/soul`, memory document reads/writes, note creation and recall |
| Schedules | Definition CRUD, enable/disable, manual run, history and cancellation |

Host controls remain distinct from employee MCP. Private control capabilities and claims
bridge tools into the existing Conversation runtime. There is one application WebSocket
bridge. Public run schemas redact claims; they are not model inputs.

Legacy delegation/review routes and conditional completion tools remain for old records.
The internal [CoordinationStore](../../server/src/buddies/coordination-store.ts) still uses
many `Record<string, unknown>` arguments and casts. The public schemas are concrete, but
the package/application TypeScript boundary still needs tightening.

## 4. How the atoms compose

### Set up wave_sim

1. Resolve `~/git/wave_sim`; inspect existing identities and this Builder's receipts.
2. Create Project Lead and four leads. Create Product Engineer, Product Designer and
   Market Researcher: eight identities total. Save seven manager edges.
3. Connect Product Lead to the single Market Researcher with `consults`; GTM remains manager.
4. Save relevant role context: the five target segments, critical product design, and
   evidence requirements for Frontier Research's handoff to Simulation.
5. Create an umbrella project and lead/individual child projects. Save preparation as ready
   work and outreach as blocked on demo videos and identifying/configuring the actual inbox.
6. Verify canonical saved cards and enable the existing background capability for this
   explicitly requested working team. This capability creates no run or schedule.
7. The owner opens Project Lead and starts work. Setup itself launches no employee runs.

The sample fixture has nine projects: umbrella, seven staff investigation projects, and
separate blocked outreach. The precise task breakdown is model planning, not hardcoded
wave_sim product logic. “Coastal Engineering is the biggest market” remains an owner
hypothesis to investigate. The unspecified inbox folder under `~/git` is not guessed.

### Chief → lead → engineer → review → follow-up

```text
Chief reads accessible work
  → creates/selects Lead-owned project and sends instructions + document references
  → Lead creates child projects and sends Engineer / Designer requests
  → recipients work, record project evidence, and reply
  → reply runs resume Lead's original thread
  → Lead requests review using another send
  → Lead sends revisions with continueFrom pointing at Engineer's earlier message
  → Engineer replies; Lead aggregates evidence and replies to Chief
```

No new delegation, review or aggregation engine is needed. Multi-recipient work is several
sends; collecting results is an inbox/work query. A reviewer can refuse or request changes
through an ordinary outcome. A Lead receiving a result must judge whether it meets the
definition of done; neither a finished provider turn nor a reply proves business success.

### Recurring Chief wakeup

Draft a prompt schedule tied to the Chief's current conversation, enable it through the
owner control, and let each due occurrence enqueue a bounded run. The prompt reads inbox,
runs and current work, then sends whatever steering is warranted. Busy/missed ticks coalesce
instead of launching simultaneous turns. Execution requires the server to be running.

This supplements normal reply-triggered continuations. Polling every conversation is not
necessary to detect ordinary completed requests. Live interruption inside arbitrary provider
tools is not promised; separate active-turn notification work is not integrated here.

## 5. Use-case coverage

“Implemented” means present in this working copy with the evidence in section 8. It does
not mean a live model has demonstrated reliable independent business management.

| Use case | State | Fit or remaining limit |
|---|---|---|
| Eight-person wave_sim setup | Implemented and tested | Persistent identities, reporting tree, collaboration, initial work, replay and restart recovery |
| Leads/reports nested in directory | Implemented | Placement follows manager relationships; search and explicit links still discover staff |
| Create identities without quotas | Implemented and tested | No headcount gate; execution limits are separate |
| Shared Researcher serving Product and GTM | Core fits | One manager, collaboration messages and shared evidence; no confidential memory partition per client |
| Chief discovers staff and current projects | Scoped support | Membership and work-read scope must cover each workspace; title alone does not grant all knowledge |
| Lead delegates and recipient starts working | Implemented and tested | Send admits a recipient run when background capability and execution limits permit |
| Recipient creates tasks/subtasks | Supported with limits | Flat todos and nested projects; no arbitrary nested-todo or dependency DAG |
| Parallel engineering/design and result collection | Core fits | Separate conversations and requests; concurrent filesystem edits still need isolated worktrees |
| Lead ends turn, then resumes on completion | Implemented and runtime-tested | Reply creates a new source-thread run with fresh restricted authority |
| Follow-up in the same employee thread | Implemented and runtime-tested | `continueFrom` retains the earlier recipient thread |
| Review, critique and Frontier → Simulation handoff | Core fits | Purposes, evidence and work; quality of theory/review is behavioral, not guaranteed by schema |
| Informational progress / bounded waiting | Implemented | Informational sends do not create reply loops; timeout leaves later replies possible |
| Delayed solo continuation | Implemented with bounds | Self-send is tied to a source run; no unbounded always-running goal engine |
| Recurring wakeup in the current Chief thread | Implemented with activation boundary | Owner enables a drafted schedule; current-thread scheduling is tested with a deterministic provider |
| Unattended Lead hires/reorganizes its staff | Incomplete for this expectation | Recipient runs cannot hire; Builder cannot modify preexisting staff. Needs a bounded owner-granted staffing capability if desired |
| Program spanning multiple workspaces | Partial | Scoped reads/sends exist; cross-workspace project parentage in the design is rejected by the current package |
| Project pause/cancel/ownership transfer/retry | Implemented core, further integration required | Current lifecycle tests pass; newer separate changes and legacy execution paths still need reconciliation |
| Discussion of already-completed work | Gap | New runs bound to a done project are rejected; allow historical discussion without authorizing new work |
| Decision history with motivations and sources | Implemented | Versioned memory plus append-only evidence notes; selective capture, not universal recording of every thought |
| Long-lived thread sees updated knowledge | Partial | Work can be queried live; injected dense memory remains the conversation's startup snapshot |
| Owner-private versus team-visible knowledge | Incomplete | No general per-document/message disclosure model or isolated memory for each collaborator |
| Owner oversight and quiet top level | Partial | Messages/work/run history and nested directory exist; fully designed notification/handled semantics remain incomplete |
| Research and draft outreach before demos | Supported | Initial work and role instructions preserve the condition |
| Guarantee no customer email before demo videos | Not implemented as an external-action guarantee | Needs actual mailbox integration and a check at the send boundary; prose and blocked projects do not constrain all shell tools |
| Replay inbound mail / avoid duplicate outbound email | Not implemented | External IDs, effect receipts and ambiguous-send reconciliation belong to an adapter |
| Hard dollar/token spending cap | Not implemented | Runtime/iteration/concurrency/rate controls exist; token/cost policy fields are not measured enforcement |
| Offline autonomous work / transparent crash adoption | Outside current scope | Queue/history persist; a running executor is required; interrupted uncertain work needs explicit recovery |
| Group chat / portable team export and restore | Not delivered as full features | Addressed messages compose coordination; shared transcript semantics and grant-safe portable teams need separate contracts |

## 6. Visibility, memory and logs: the unresolved boundary

Four questions must remain distinct: where a Buddy appears, what the owner is notified
about, what another Buddy may read, and what a run may do. Hiding a report at the top level
answers only the first question.

Current project visibility comes from ownership, management, owned ancestors, an explicit
workspace read-all setting, or a qualifying addressed project message. Current `get_message`
also allows reading an attached message when the caller can read its project. It is not a
strict participants-only message privacy model. The broad read behavior must be considered
before claiming that attached private discussion stays private.

Soul, working and long-term memory belong to the Buddy across conversations. A shared
Researcher can carry learned information between contexts. Application read checks do not
erase what a provider session has already seen. Workspace files are likewise not isolated
merely by a database membership row.

Keep four distinct records: transcript for discussion/execution, machine audit for state
changes, authored notes for supporting evidence, and dense memory for selected knowledge.
Do not copy transcripts into every lead's memory. A minimal next extension should give
shared briefs/evidence an explicit read scope and retain private documents separately,
including search, context refresh and export behavior. No generic policy language is needed
to specify a few concrete audiences. The exact disclosure/refresh contract is not final yet.

## 7. Remaining work in useful order

1. **Finish integration and run one real trial.** Reconcile the separate dirty coordination
   work against the current package without reintroducing quotas. Load the resulting app at
   an idle boundary. Run the actual natural-language Builder request, inspect eight hires,
   then ask Project Lead for one bounded investigation and verify a real reply/follow-up.
   Mechanical fixture success is necessary but not a provider-behavior evaluation.
2. **Close execution inconsistencies.** Unify admission, cancellation, project gates, handoff
   and drain across current-thread prompts and legacy automation jobs. Resolve done-project
   discussion, cross-workspace parentage, and current-state reads in long-lived threads.
   Give the package/application boundary concrete types and correct stale tool descriptions.
3. **Complete knowledge sharing.** Define shared versus private documents/messages and
   enforce that through reads, recall, context assembly and exports. Verify the shared
   Researcher scenario without claiming isolation that the runtime cannot provide.
4. **Connect the real inbox only when it is identified.** Implement a narrow external action
   adapter with demo-evidence checking, configured account/scope, durable effect receipts,
   inbound deduplication and unknown-send recovery. Existing owner authorization should be
   honored within its scope; elapsed time or a pending approval must never substitute for it.
5. **Close the remaining autonomy/product decisions.** Decide whether an explicitly
   authorized Chief may activate recurring schedules and create/reorganize staff during
   background runs. Expose that as bounded capabilities if needed. Finish owner attention
   and active-turn notification integration; add machine dependencies only for concrete
   workflows that need them.

The important simplification is to reduce overlapping execution and authority paths.
Replacing every resource with events or inventing a Team runtime would add migration work
without closing these gaps. Do not use a count of MCP names as a measure of simplicity:
distinct read, create, revise, send and reply operations have useful, understandable contracts.

## 8. Evidence and delivery boundary

Verified on September 10:

| Check | Result |
|---|---|
| Full server suite, `pnpm test:server` | 259 passed, 1 live-provider test skipped, 0 failed |
| Full client suite, `pnpm test:client` | 60 passed, 0 failed |
| Exact package source, `npm test` | 63 passed, 0 failed |
| Server TypeScript check and compiled build | Passed |
| Client TypeScript build check (`tsc -b`) | Passed |
| Shared ESM/CJS build | Passed |
| Client invariant gates | All 6 passed |
| Updated stdio MCP test formatting | Biome passed |
| Installed package versus archive | Store, coordination modules and declarations match byte for byte |

The eight-person scenario is in
[buddy-builder-team.test.ts](../../server/test/buddy-builder-team.test.ts).
The Chief/Lead/Engineer/reviewer chain and current-thread schedules use the real Conversation
runtime with a deterministic provider in
[buddy-coordination.test.ts](../../server/test/buddy-coordination.test.ts).
Inline result rendering is covered by
[buddy-builder-results.test.tsx](../../client/test/buddy-builder-results.test.tsx).
These are not live-model or browser-interaction tests.

The two initially failing stdio tests inherited the current session's run credentials into
their separate fixture databases. Filtering inherited `UNLEASHD_BUDDY_*` variables in those
fixture children fixed them; the production claim/authority checks were preserved.

Package source commit: `ed9af1539eaaf8750c43f804b4caa5dfd2f7d06a`, clean branch
`codex/builder-team-20260909`, based on schema-22 commit
`d5e6b25017fbb6d74089e49dd1a07ee9f874bcb5`.
Archive SHA-256: `2a1e738ccb256b4af7bed680a9f230dfa37805c4977b72901fb80c22bb186780`.
The archive and lockfile are installed in this working copy. Its `releaseReady` provenance
field describes reproducible packaging, not the completeness of the business workflow.

The older coordination worktree still has five modified files, including later lifecycle
work and old quota logic. It has not been silently merged. Application changes are mixed
with other uncommitted work. Nothing was pushed, no live wave_sim team was provisioned,
and no customer email or recurring schedule was created. The running server's loaded
version still needs confirmation before treating this as a live rollout.

Historical context remains in the
[integration handoff](../../agent_notes/2026-09-09_buddies-integration-handoff.md) and the
source-corpus appendix of [redesign 1](REDESIGN_01_TYPED_RESOURCES.md#11-source-review-coverage).
That earlier review located 45 documents and 19 parent conversation transcripts; it was
not a claim to have recovered every historical conversation. Future decision notes should
cite this dated snapshot and explicitly supersede individual choices instead of rewriting
the motivation history.
