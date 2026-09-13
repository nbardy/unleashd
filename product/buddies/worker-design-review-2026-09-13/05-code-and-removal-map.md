# Code changes, removals and migration

September 13, 2026. Proposed changes for [v2](03-v2.md). No production source was
edited as part of this design task. Source IDs refer to [versioned excerpts and
hashes](source-index.md), not an assumption that a mutable checkout equals the
running server. Paths below are current unless explicitly marked proposed/new.

## Baseline and package authority

Unleashd depends on `@nbardy/buddies` through
`vendor/nbardy-buddies-0.1.0.tgz`. Its provenance names source commit
`b70c0def1373034aeff56e409adb97d66ff6d7f7`. All installed `src/` files matched that
archive in this review. The installed store declares schema version 27.

The source worktree at that commit is
`/Users/nicholasbardy/git/.codex-worktrees/buddies/wave-sim-ceo-second-pass-20260913`.
The older `/Users/nicholasbardy/git/buddies` main checkout is at
`842631961d7d3c51d3dfdc9cc9ae444532a4b020`; its store declares schema 19. Do not
implement against that older file or edit `node_modules` and then repack it as
canonical source. Use an isolated branch from the verified packaged baseline,
reconcile successors, run package tests, commit the package, then vendor with
provenance through the existing tool. This proposal does not change the separate
tarball-versus-submodule decision. [P01, V01, V02]

Unleashd itself has substantial pre-existing changes and preserved integration
worktrees. Keep them intact. Its source HEAD at capture was
`1187a8b6660b95c0c60bd8fada105f015b98cc39`; file hashes, not that HEAD alone,
identify the reviewed uncommitted source. The CLI wrapper submodule HEAD was
`3135ac5bae665b8bc2f53ae0b3462b370cd5f835`.

## Canonical package touchpoints

Package paths in this table refer to the verified source tree above; P evidence
was read from the byte-matching installed package.

| Current file / function | Change for v2 | Authority kept here |
|---|---|---|
| `src/store.js`: schema migration, Buddy creation, `getBuddyTeamState`, `retireDirectReport` [P01] | Add Worker mode; atomically require its canonical parent; preserve profile staging/repair before executable readiness; distinguish Worker history visibility from ordinary archival filtering | Identity, relationships, task/checklist storage, lifecycle |
| `src/team-access.js`: `createTeamBuddy`, `setTeamRelationship`, `buddyCapability` [P06] | Implement granted `create_worker` composition and Worker retirement rules; reject changing a live Worker's parent; grants still checked, no hiring quota | Staffing/profile/document grants and membership |
| `src/team-configuration.js`: `prepareTeamConfiguration` and apply [P08] | Preview Worker-management policy without converting existing staff; retain setup/admission/return diagnostics as distinct facts | Owner setup transactions, exact plan replay |
| `src/coordination-work.js`: `createCoordinatedProject`, `updateCoordinatedProject`, `finishProjectHandoffs` [P04] | Adapt Task vocabulary; add candidate/criteria/acceptance provenance; publish blocked/review causes; retain revisioned ownership transfer and drain | One Task outcome and handoff authority |
| `src/coordination.js`: `sendCoordinatedMessage`, `enqueueBuddyRun`, `inspectBuddyAdmission`, `claimBuddyRun`, `finishBuddyRun` [P02] | Separate Mail delivery from request creation; admit host-stamped work/coordination classes; enforce Worker-wide single writer; make foreground independent of background quotas | Atomic command replay, admission, claims, cancellation |
| `src/background-work.js`: `getBackgroundWork`, `reconcileBackgroundWork` [P03] | Keep old elapsed-time managed-message behavior for legacy requests. New requests use explicit request/session/task binding, not `message.buddy_project_id` and open child replies | Versioned legacy controller until its write path can retire |
| `src/coordination-receipts.js`: `checkpointBuddyRun`, `retryUndeliveredInputs`, `recoverClosedBackgroundMessage` [P05] | Reuse checkpoints, effects and deduplication; report commits checkpoint/task changes/source cause together; request recovery preserves history and accounting | Durable evidence, delivery and recovery receipts |
| `src/knowledge.js`: `authorize`, `replaceKnowledgeDocument`, `listKnowledgeDocuments`, `knowledgeAudienceRevision` [P07] | Use one explicit binding audience for multi-task work; preserve authority generations and create-only notes; add cursor/kind filtering to existing authorized discovery | Disclosure, versioned content and context-reuse fence |
| `src/coordination-approvals.js`: `consumeProjectApproval` [P09] | Preserve typed owner action consumption and legacy approval receipts while Task names change | Approval scope and one-time exact action consumption |
| `src/mailbox.js` [P10] | Keep external-mail effect preparation/claim/settlement separate from internal Mail | External delivery deduplication and effect receipts |

Two focused new package modules are recommended: **`src/execution-policy.js`**
for the one policy/accounting resolver, and **`src/worker-execution.js`** for
request/session/report/continuation transactions. These are proposed paths, not
files found in the baseline. They extend the existing store methods. Neither
spawns provider processes or implements a second executor.

### Minimum new durable state

Choose the next migration number from the actual delivery baseline; do not
hard-code “schema 28” while other work may land.

| State | Minimum fields / invariant |
|---|---|
| Worker mode | Explicit Buddy mode; worker requires one immutable-for-lifetime canonical manager edge; no duplicate parent authority |
| Context/work binding | Buddy, existing background context ID, audience ref/generation, config revision, task refs, authorization ref, revision; at most one active work binding per Worker |
| Execution request | ID/key, source kind/ref, target/binding, original authority, intended input, task refs, handled causes and disposition; Mail reference optional |
| Solo session | ID/binding, policy version, granted solo seconds, accrued admission segments, check-in watermark, state/cause revision and original account |
| Accounting | Root authorization total/expiry, consumption, reservations by work/review/report attempt and settlement; nonnegative available total enforced transactionally |
| Pending cause | Source identity/version, audience, responsible parent, handled/disposition revision and durable delivery intent; implemented within unified request/input records and receipts |
| Task acceptance | Criteria/candidate revision, immutable artifact refs, reviewer identity and observation; existing assignment `accepted_by` retained with its old meaning |

Add a partial unique execution constraint keyed by Worker/Buddy ID for host-stamped
work runs in claimed/running/draining ownership states, not by Task or conversation.
Legacy run classes need an explicit compatibility fence during cutover. A record
that says cancelled but whose process still runs must continue holding occupancy.
Do not add user-editable Assignment, Batch, Report or Review completion tables.

## Shared contracts and server adapters

| Current file(s) | Change | Evidence |
|---|---|---|
| `shared/src/buddy-resources.ts` | Publish versioned Mail/Prompt/Report inputs; Task names and role catalog; keep compatibility translation at the edge | C01 |
| `shared/src/buddy-work.ts` | Extend existing Task/checklist/candidate/acceptance types; replace new UI's message-derived execution view with a canonical Task execution projection | C02 |
| `shared/src/buddy-coordination.ts`, `buddy-observation.ts`, `buddy-message.ts` | Request/session/account/hold projections and report origins; Mail delivery remains distinct from request admission | C03–C05 |
| `shared/src/buddy-team.ts`, `buddy-access.ts` | Worker mode, parent inspection and explicit Worker-management grants; standing employment and owner permissions remain intact | C06–C07 |
| `shared/src/conversation-config.ts`, `conversation-kind.ts`, `index.ts` | Carry binding/request/audience identity durably; preserve opaque conversation IDs and compatibility hydration; export shared schemas once | C08–C10 |
| `shared/src/provider-catalog.ts`, canonical config resolver | Keep model/effort strings and catalog validation; no second defaults table in Worker UI | C08, C11 |
| `server/src/buddies/operations.ts` | Dispatch new operation schemas; enforce role/target/task/session authority through the package; isolate legacy operations from new catalogs | S02 |
| `server/src/buddies/mcp-server.ts`, `mcp-input-schema.ts`, `mcp-config.ts` | Register 12/18-tool profiles and optional granted diagnostics/admin; one schema/description registry; explicit adapter for legacy resource contract | S01, S09; schema adapter is already used by S01 |
| `server/src/buddies/control-server.ts` | Keep host-issued owner/employee/maintenance capabilities separate; add constrained reporter result path and current-claim fences | S08 |
| `server/src/buddies/contract.ts`, `coordination-store.ts` | Add typed package ports for request/session/accounting/report operations; do not implement authoritative policy in TypeScript adapters | S21–S22 |
| `server/src/buddies/run-executor.ts` | Execute durable typed inputs in the selected compatible context; hold/review/resume from canonical request state; retain deadline, drain and human-thread delivery checks | S03 |
| `server/src/buddies/scheduler.ts` | Make new schedule occurrences and pending causes feed the shared executor; poll due check-ins and required reviews; retain legacy occurrence semantics during migration | S04 |
| `server/src/buddies/dispatch-service.ts` | Compatibility entry/adapter only for old dispatch; new typed requests converge on the same creation/admission path | S26 |
| `server/src/buddies/integration.ts` | Construct role-specific lean briefs using current Task references and explicit binding audience; no broad owner's-backlog/private-chat copy | S05 |
| `server/src/buddies/knowledge.ts`, `resources.ts` | Read authority from actual binding, not first Task or model argument; accurately expose existing knowledge search and paginated resource summaries | S06–S07 |
| `server/src/buddies/team-observation.ts`, `team-readiness.ts`, `directory.ts`, `visibility.ts` | One canonical Worker/session/limits projection; preserve setup, admission and return reasons; hide standalone Workers while permitting parent history inspection | S18–S20, S30 |
| `server/src/buddies/direct-reports.ts` | Adapt retirement naming/Worker policy without bypassing existing ordinary-staff grants | S29 |
| `server/src/buddies/owner-mcp.ts`, `owner-resources.ts`, `owner-team-configuration.ts`, `routes.ts` | Keep owner identity host-bound; add explicit owner work authorization and shared projections; adapt Task aliases on HTTP and owner MCP together | S15–S17, S25 |
| `server/src/buddies/builder-mcp-server.ts` | Keep provisioning scope; share Task/document/profile schemas with owner resources and retire duplicate soul aliases once clients migrate | S27 |
| `server/src/conversations/creation-service.ts`, `buddy-creation-service.ts`, `config-store.ts` | Reuse inert creation/link repair and stable fingerprints for background contexts; persist new binding fields without inventing provider sessions | S12, S14, S28 |
| `server/src/conversations/runtime.ts` | Shared provider turn ownership and snapshot watermarks; independent human input; report/work deadline causes distinct from explicit user stop | S13 |
| `server/src/server.ts`, `server/src/constants/timeouts.ts` | Compose the shared services; explicitly pass foreground/watchdog policy; no scattered background fallback deciding Worker session length | S23–S24 |
| `server/src/lifecycle/session-loader.ts` and existing adapter/config hydration | Preserve Worker Buddy identity, background placement, transcript visibility and opaque IDs on reload; avoid treating config-only records as newly created chats | S31, S14; architecture guide |

Add a focused **`server/src/buddies/progress-reporting.ts`** service (proposed/new)
for snapshot preparation, bounded reporting and result validation. It calls the
existing provider execution seam and package transactions. Reuse the shutdown,
abort and event-drain pattern in `memory-review-runner.ts`; preserve the latter's
separate policy and its benchmark. [S10–S11]

## Provider seam

`vendor/agent-cli-tool/src/session.ts` already supports native flags or emulated
forking and rejects unsupported harnesses. `shared/src/index.ts` has
`providerSupportsFork`, which describes merge-style session forks. Neither proves
that an active Worker can be snapshotted and stripped of its old capabilities.
[H01, C10]

The baseline reporter therefore uses a supplied permitted snapshot and fresh
restricted execution. If native fork optimization is later justified, change
session/fork helpers and relevant harness config at the CLI wrapper edge; keep
provider-specific behavior in `server/src/providers/*` and the thin wrapper.
`runtime-types.ts`/canonical config carry supported parameters. Do not build
Buddies, task accounting or report delivery into the CLI submodule. Commit and
push submodule work inside it before bumping the outer pointer; no main push is
authorized by this design task.

## Desktop/mobile touchpoints

| Current file(s) | Change |
|---|---|
| `BuddyDirectory.tsx`, `buddies-shaping.ts` | Consume canonical ordinary/Worker visibility and parentage; include a parent Worker section rather than standalone roster cards [U01, U14] |
| `BuddyProjectExecution.tsx` | Show Task status/candidate/acceptance separately from session/request state; remove `message?.execution` as the new-work state authority [U02] |
| `BuddyTeamExecution.tsx`, `BuddyExecutionProfile.tsx` | Show one resolved Limits view and effective configuration; keep settings distinct from observed running configuration [U04–U05] |
| `BuddyMessages.tsx` | Mail receipt/thread display separate from execution receipt; system progress reports labeled; retain exact owner approvals and safe conversation links [U03] |
| `BuddyBackgroundTasks.tsx`, `atoms/buddy-background.ts` | Current “Background tasks” is a list of conversations. Replace that role with Worker/request inspection and label transcript history honestly; Task counts come from work records [U06, U15] |
| `BuddyMemoryWorkspace.tsx`, `BuddyMemoryPanel.tsx` | Keep audience-visible memory; expose shared references through existing document search, without promising private Worker memory access [U09] |
| `buddy-tabs.ts`, Buddy dashboard/detail and `BuddyDetailMobile.tsx`, `BuddyDetailWorkTab.tsx` | Add parent Worker inspection through existing routes/links and shared Buddy components; preserve Back/reload behavior in both shells [U07–U08, U12] |
| `components/buddies/api.ts`, `types.ts`, `ui-contract.ts` | Consume the one shared wire projection and schema; adapt Task vocabulary without a second view-owned status model [U13 and existing component imports] |
| `atoms/conversations.ts`, `atoms/actions.ts` and derived Buddy views | Preserve one WS message spine, per-ID structural subscriptions and separate streaming buffers; background transcript presentation changes remain derived views [U10–U11, U15] |

**Naming collision:** existing `Conversation.isWorker` and `workersByProjectAtom`
refer to swarm/worker conversations. They are not persistent Buddy Workers. Use
explicit `BuddyWorker` types and Buddy-derived views; do not reuse that boolean or
silently change swarm grouping. [U16]

Any new UI file/class should be named for its component. Preserve `usePolledFetch`
for one-shot/fanned-out loads, shared schemas, `<Link>` routes and the
`allConversationIdsAtom` availability check. No mobile fork of state or second
WebSocket is necessary.

## Explicit removal ledger

Removal means stopping new use and eventually deleting the redundant write path;
it does not mean deleting historical records or disabling unrelated features.

| Current thing | Target and removal condition |
|---|---|
| `send(delivery.kind="work")` as new work creation | New Worker requests use Prompt. Stop new writes after all launchers use the versioned contract; retain legacy requests/receipts until drained and readable |
| `send` flags/`continueFrom`/`expectsReply` as routing and lifetime controls | Mail + typed Prompt; retain old parser only for compatibility receipts/callers, not new instructions |
| Separate `reply` in new employee MCP | Threaded Mail; retain owner approval reply handler and legacy recipient response settlement behind adapters |
| Public `checkpoint` and `retry_run` tools | Report checkpoint variant and Prompt recovery variant; reuse their underlying durable implementations |
| `assign_work`/`continue_worker`/`retire_worker` from v1 | Do not implement; use Prompt and one `retire_buddy` operation |
| Public `new_project`/`update_project` work names | New Task names, same IDs/tables; workspace/repository resources remain separate |
| Public `retire_direct_report` name | One retirement operation with explicit Worker versus ordinary-staff authority; no automatic bulk transfer |
| Legacy delegation/review completion helpers and marker parsing | Do not expose for new work. Delete write helpers when no stored active legacy policy needs them; retain history rendering and provenance |
| Child `expects_reply` messages implicitly suspending all parent work | Explicit affected-Task blockers and typed execution causes; old message-root behavior retained only for legacy work |
| New-work completion/limits inferred through latest message | Canonical Task + request/session/account projection; legacy UI adapter remains labeled |
| Repeated defaults and policy calculations in server consumers | One package resolver. Remove a duplicate only after preview, claim, timer and UI read the same resolved policy |
| General lead self-send loops for implementation | New sustained work assigned to Workers; retain short lead coordination and authorized historical attempts |
| New direct scheduled long implementation in ordinary lead context | Schedules enqueue coordination or saved Task/Worker templates through the same request path; legacy loop/sequence policy drained before removal |
| Standalone Worker roster entries and “background conversation = Task” labeling | Parent Worker inspection and true Task records; historical transcripts remain available |
| Any proposed Worker/Report/Review service duplicating Buddy/task storage | Do not create it. Minimal request/session/account records live in the canonical package |
| Native fork as mandatory reporting mechanism | Fresh restricted snapshot path; native fork stays optional after measured capability tests |

Do **not** remove owner grants, private audiences, explicit configuration intent,
claim fences, cancellation/drain, checkpoints, Task evidence, historical failures,
the restricted memory reviewer, direct reports, ordinary schedules, external-mail
effect records, or the real-provider test boundary to make an object count smaller.

## Delivery gates

1. **Package boundary:** migration, atomic Worker creation/provisioning repair,
   report/outbox, Task acceptance, Worker-wide claims, accounts and stale/replayed
   decisions on one real isolated store fixture. Preserve packaged timeout and
   foreground regression tests.
2. **MCP/runtime boundary:** real scoped control path and strict schemas. Prove
   role catalogs, one writer, no unauthorized recovery/renewal, no action tools in
   reporters, and human foreground independence under background saturation.
3. **Provider journey:** two Tasks under one Worker, progress snapshot during work,
   required review, same-context continuation, cancellation and recovery evidence.
4. **Client boundary:** render/API coverage in both shells, real transcript links,
   Task/session/limits agreement and existing history/privacy regression cases.
   Run `pnpm test:client`, relevant server tests, `pnpm -C client exec tsc -b` and
   `bash tools/check-client-invariants.sh` when implementing these changes.
5. **Integration/provenance:** preserve and inspect current isolated UI/release
   work, vendor the committed package with its correct source provenance, verify
   loaded adoption before a production-complete claim, and retain original-thread
   acceptance targets from the pending handoff.

This design review validates documentation and source correspondence only. It
does not claim these implementation gates have passed.
