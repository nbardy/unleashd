# 01 — @nbardy/buddies package inventory (as installed, schema v33)

Sources: `node_modules/@nbardy/buddies/src/*` (paths below are relative to that dir), DB copy opened
`sqlite3 -readonly "file:…?immutable=1"` (87.6 MB, `PRAGMA user_version`=33,
CURRENT_SCHEMA_VERSION=33 at store.js:130). Row counts/sizes were measured on 2026-09-25 against the
first DB copy (the re-copy at `db/buddies.sqlite` is 89.2 MB, so small drifts are expected).
Caller counts = textual `.method` matches in `unleashd/server/src` (tests excluded). Generic names
(`close`, `getBuddy`, `recall`) over-count.

## 0. Package size

| File | Lines | Content |
|---|---:|---|
| store.js | 5,942 | BuddiesStore class; `#migrate()` 296–1179 (884 lines) |
| team-configuration.js | 1,300 | owner "configure team" preview/apply compiler |
| coordination.js | 1,069 | buddy_runs queue/lease/admission, coordinated messages, failure/interruption notices |
| index.d.ts | 951 | types |
| coordination-work.js | 614 | membership, task hierarchy/ownership handoff, task comments |
| cli.js | 566 | `buddies` CLI (not used by server) |
| lists.js | 452 | channels (lists/posts/reads) |
| background-work.js | 377 | "until_done" background execution settlement |
| coordination-receipts.js | 326 | checkpoints, run recovery, retry undelivered |
| team-access.js | 320 | capability grants, team profile/doc access |
| knowledge.js | 232 | scoped knowledge docs + audience key |
| mailbox.js | 69 | mail effects/inbound (0 callers, 0 rows) |
| coordination-approvals.js | 56 | message-bound approvals |
| run-capacity.js / index.js / bin | 14 / 24 / 8 | |
| scripts/ (growth-lead/engineer init) + profiles/ | 545 | 2026-07-28 seed data |
| **Total src** | **12,865** (11,348 runtime JS excl. cli + d.ts) | |

## 1. Tables (35; no `*_v` temp tables remain. The v15/v17/v21 copy-migrations renamed them away; the only residue is the index name `buddy_memory_revisions_v17_by_buddy_document`)

Sizes = table + its indexes (dbstat). "Last write" = max timestamp.

| Table | Purpose | Key columns (JSON shapes) | Keys / indexes | Rows | MB | Last write | Written by → read by |
|---|---|---|---|---:|---:|---|---|
| projects | **Workspace** (a repo root) | id, slug UQ, name, root_path UQ | PK, 2 UQ | 16 | 0.02 | – | createProject/createWorkspace (store.js:1515,1552) → everywhere |
| buddies | Employee identity | id, project_id→projects (home ws), slug, name, role, status, soul_path, memory_path, provider, model, reasoning_effort, hire_quota, profile_revision, employment_mode standing\|worker | PK, UQ(project_id,slug) | 51 (48 active, 3 archived, 0 workers) | 0.04 | – | createBuddy 1564, createBuddyFromBuilder 1637, updateBuddy 1862, createTeamBuddy (team-access.js:127), hireDirectReport 5098 |
| buddy_projects | **Membership** buddy↔workspace + run limits | buddy_id, project_id, assignment_role, read_all_work, dispatch, background_enabled, max_active_runs, max_background_runs_per_hour, max_sends_per_hour, max_pending_runs, background_paused_reason | PK(buddy,project) | 61 (51 = home ws, 10 extra) | 0.03 | – | assignBuddyToProject 1966, setCoordinationMembership (coordination-work.js:188) → getCoordinationMembership (32 server callers). **All 61 rows hold default limits (30/100/100, 5); paused_reason always NULL** |
| owned_projects | **Task** (UI "Task"; code "BuddyProject") with hierarchy, ownership handoff, execution gate | workspace_id, buddy_id (owner), parent_project_id, sprint_id, title, objective, definition_of_done, status, priority, next_action, blocked_reason, source_path, external_key, revision, execution_state, execution_epoch, pending_owner_id, completion_evidence JSON string[], accepted_by, accepted_at | PK, UQ(ws,external_key), (buddy,status,prio) | 359 (129 children) | 1.14 | live | newProject 3038, updateProject 3206, upsertBuddyProject 3101, createCoordinatedProject/updateCoordinatedProject (coordination-work.js:296,461), reassignOwnedProject 2017 |
| buddy_todos | Checklist rows inside a Task | buddy_project_id, title, status, position, definition_of_done, next_action, blocked_reason, completion_evidence JSON | (project,position) | 1,175 | 1.38 | live | #insertTodo/#updateTodo 5605/5636 via updateProject `todoOperations` → listTodos 3193, getBuddyProject |
| buddy_task_comments | Append-only comments on a Task | project_id, author, body, evidence JSON string[≤32] | (project,created DESC) | 945 | 1.62 | live | appendTaskComment/listTaskComments (coordination-work.js:83,127) |
| work_items | v0 task model (pre-owned_projects) | project_id, sprint_id, buddy_id, title, kind, external_key, source_path, objective, definition_of_done, status, priority, next_action, blocked_reason | 3 idx | 15 | 0.03 | 2026-07-28 | createWorkItem 3872, upsertWorkItem 3944, updateWorkItemStatus 3993 (1 server caller routes.ts), auditWorkMigration 4066 |
| sprints | Sprint grouping | project_id, name, goal, status, starts_at, ends_at | UQ active per project | 3 | 0.01 | 2026-08-22 | createSprint 2979 (0 callers), completeSprint 3025 (0) |
| buddy_messages | **Directed request/reply** buddy→buddy or →owner; drives dispatch | from/to_buddy_id, workspace_id, buddy_project_id, purpose, body, evidence JSON string[], parent/child_conversation_id, status, outcome, reply_body, reply_evidence, replied_by, wait_until, wait_status, notification_pending, expects_reply, source_project/workspace_id, root_message_id, caused_by_run_id, not_before, after_run_id, continue_from_message_id, in_reply_to_id, superseded_by_message_id, root_stopped_at, command_key, payload_hash, return_policy JSON {allowed_operations[], launch?, return_conversation_id?}, visibility | 4 idx incl UQ(from,ws,command_key) | 585 (12 to owner) | 3.40 | live | sendMessage 2513 (legacy), sendCoordinatedMessage (coordination.js:226), replyMessage 2609, #replyMessage 2631, failMessage 2674, bindMessageConversation 2602, stopBuddyMessageRoot (coordination.js:1048), settleBackgroundReply (background-work.js:332) |
| buddy_lists | **Channel** (named stream per ws) | workspace_id, name, purpose, created_by_kind buddy\|owner, created_by_buddy_id | UQ(ws,lower(name)) | 32 | 0.02 | live | createList (lists.js:209) |
| buddy_list_posts | Channel post / thread reply | list_id, workspace_id, author_kind, from_buddy_id, thread_root_id, purpose, body, evidence JSON, buddy_project_id, sender_conversation_id, sender_run_id | 3 idx | 318 | 0.92 | live (since 09-22) | createPost (lists.js:247) → listPosts/listThread/searchPosts/pagePosts |
| buddy_list_reads | Per-buddy channel read cursor | buddy_id, list_id, last_post_id, last_post_created_at | PK | 51 | 0.03 | live | markListRead/listUnread (lists.js:434,420) |
| buddy_runs | **Run queue + lease** for every turn | input_key, input_kind chat\|message_request\|message_reply\|failure_notice, input_id, attempt, buddy_id, workspace_id, conversation_id, project_id, root_message_id, ready_at, after_run_id, status, claim_token, claim_expires_at, deadline, policy JSON {allowed_operations[], foreground?, execution{mode:'until_done',maxRuns,maxDurationSeconds}?, assignment_config?, launch?, return_conversation_id?, max_runtime_seconds?, interruption_report_*?, source_run_id?}, outcome, error, error_code, retry_of_run_id, project_epochs JSON [{id,epoch}], acknowledged_at, execution_snapshot JSON {provider,model,reasoningEffort,assignment{…},turnCapSeconds,deadline,limitingSource} | UQ(input_key,attempt), UQ live input_key, UQ live conversation slot, (status,ready_at), 2 json_extract idx | 2,515 | 14.50 | live | enqueueBuddyRun (coordination.js:476), claim 625, start 697, finish 730, hold 912, cancel 1040, retry 967, repair 942, recover 918 |
| buddy_checkpoints | Run progress checkpoint (artifacts/effects/resume) | run_id, buddy_id, workspace_id, project_id, message_id, root_message_id, artifacts, effects, resume (malformed JSON in live rows), visibility | (run,created) | 29 | 0.09 | 2026-09-13 | checkpointBuddyRun (coordination-receipts.js:92, **0 server callers**) → listRunCheckpoints |
| buddy_command_receipts | Idempotency cache: (actor,ws,key) → hash + **full result JSON** | actor, workspace_id, command_key, payload_hash, result JSON (avg 4.7 KB, max 126 KB) | PK | 5,698 | **30.1** (largest) | live, since 09-09 | coordinationCommand (coordination.js:447); also stores owner team configurations (team-configuration.js:1287). **No retention/DELETE anywhere** |
| buddy_audit_events | Append log of every tool op incl. reads | buddy_id, workspace_id, buddy_project_id, operation, payload JSON | (buddy,created), (project,created) | 23,106 | **22.8** | live, since 07-28 | recordAuditEvent 2147 (24 in-pkg + 9 server callers) → listAuditEvents, listBuddyActivity 2229, summarizeMemoryWrites 2270. Top ops: turn_input 5021, get_current_work 2958 (read), knowledge.replace 2314, memory_review 1900, append_task_comment 1892, update_project 1406 (5.5 MB payload), get_inbox 1342 (read). **No retention** |
| buddy_memory_revisions | Immutable revisions of per-buddy soul/working/long_term | buddy_id, document_kind working\|long_term\|soul, revision, base_revision_id, body, reasoning, author_kind, requested_by, provenance_json, sha256 | UQ(buddy,kind,rev) | 238 (128 authored by `migration`, 54 memory_reviewer, 41 owner, 15 buddy) | 0.59 | 2026-09-24 | #updateMemoryDocument 3434 via updateMemory 3298 / updateSoul 3318; #initializeMemoryDocuments 1206 |
| buddy_memory_heads | Current head per (buddy,kind) | buddy_id, document_kind, revision_id, generation | PK | 153 (=51×3) | 0.04 | | same; readBuddyMemory 3835, readBuddySoul 3536 |
| buddy_knowledge | **Scoped** docs: (buddy, ws, scope owner_thread\|project\|workspace, kind soul\|working\|long_term\|shared\|note, name) | revision, content | UQ 6-tuple | 1,415 (986 notes, 0 shared, 5 soul) | 3.77 | live | replaceKnowledgeDocument (knowledge.js:101); reading seeds lazily from memory heads (knowledge.js:83-93) |
| buddy_knowledge_revisions | Revision log of knowledge | document_id, revision, content, reason, author, provenance JSON | PK(doc,rev) | 2,314 | 5.74 | live | saveDocument (knowledge.js:56) |
| buddy_automations | Schedule definition | buddy_id, workspace_id, buddy_project_id, name, schedule_kind cron\|interval, schedule_expression, timezone, job_kind prompt\|sequence\|loop, job_payload JSON {prompt…}, enabled, next_run_at, last_run_at, archived_at | (enabled,next_run_at) | 16 (**1 enabled**, all `prompt`) | 0.04 | | createAutomation 4317, updateAutomation 4419, archiveAutomation 4488 |
| buddy_automation_policies | Per-automation budget | max_runtime_seconds, max_iterations, max_tokens, max_cost_usd, allowed_operations JSON | PK | 16 | 0.01 | | #insertAutomationPolicy 5795 |
| buddy_automation_runs | Per-occurrence run with **its own lease** | automation_id, scheduled_for, idempotency_key UQ, status, conversation_id, iteration, outcome, error, claim_token, claim_expires_at | 2 idx | 51 (38 complete) | 0.15 | 2026-09-24 | claimAutomationRun 4535, updateAutomationRun 4667. **0 rows share a conversation with buddy_runs**: a parallel system |
| buddy_automation_run_policies | Snapshot of policy + usage per occurrence | same as policies + tokens_used, cost_usd | PK | 51 | 0.02 | | claimAutomationRun |
| buddy_relationships | Org graph | from/to_buddy_id, kind manager\|reports_to\|consults\|reviews | UQ(from,to,kind), UQ one manager per report | 38 (30 manager, 7 consults, 1 reviews) | 0.02 | | setBuddyRelationship 2058, setTeamRelationship (team-access.js:155), reparentBuddy (coordination-work.js:148); 3 triggers freeze worker parents |
| buddy_access_grants | Owner-granted capabilities between buddies | grantee_id, workspace_id, target_id, capabilities JSON string[] of 10 TEAM_CAPABILITIES, revision, expires_at, reason, created_buddy_incoming | PK | **2, both `[]`** | 0.01 | | setBuddyAccess (team-access.js:55) → buddyCapability 100 |
| conversation_links | unleashd conversation ↔ buddy (+task) | buddy_id, work_item_id (always NULL), buddy_project_id, workspace_id, provider, provider_session_id, unleashd_conversation_id, status, started/last_active/ended_at | UQ unleashd id | 955 (868 still `active`) | 0.44 | live | linkConversation 4872, updateConversationLink 4952 (1 caller each, integration.ts) |
| buddy_builder_hires | Builder conversation → created buddy (idempotency) | conversation_id, creation_key, buddy_id UQ, workspace_id, request_fingerprint | PK(conv,key) | 42 | 0.02 | 2026-09-24 | createBuddyFromBuilder 1637 → getBuddyBuilderResult 1803 |
| buddy_builder_creations | v10 predecessor of builder_hires | conversation_id PK, buddy_id, … | | 9 | 0.01 | – | **only referenced by migration** (store.js:847,1160). Dead |
| buddy_skills | Skill file attached to buddy | buddy_id, name, instruction_path, mode | UQ | 4 | 0.01 | 2026-07-28 | assignBuddySkill 2473 (1 caller), removeBuddySkill (0) |
| buddy_delegations | Delegation w/ dispatch lease | from/to, workspace, buddy_project_id, purpose, parent/child_conversation_id, status, outcome, dispatch_token, dispatch_expires_at | | 10 (4 still pending) | 0.02 | 2026-08-22 | createDelegation 2680; claim/bind/failDelegationDispatch **0 callers** |
| buddy_reviews | Reviewer verdict on a buddy | reviewer/subject, status, verdict, score, summary, evidence JSON | | 2 | 0.02 | 2026-07-28 | createReview 2859, updateReview 2920 |
| buddy_approval_requests | Owner approval gate | buddy, workspace, project, automation_run_id, conversation_id, action, reason, risk, status, resolved_by, …, message_id, operation, arguments_json, arguments_hash, project_revision, expires_at, consumed_by_run_id | 3 idx | 3 (all pending, 0 bound to messages) | 0.02 | 2026-08-22 | createApprovalRequest 2291, resolveApprovalRequest 2437, attach/resolve/consumeMessageApproval (coordination-approvals.js:20-44, 0 server callers) |
| buddy_mail_effects / buddy_mail_inbound | Outbound/inbound email effects | payload, status, authorized, provider_receipt | | **0 / 0** | 0.01 | never | mailbox.js (**0 server callers**) |

DB total ≈ 87.6 MB. **Receipts (30.1) + audit (22.8) + runs (14.5) = 77% of bytes.** Most of the runs table is `outcome` (8.2 MB) and `policy` (1.9 MB, the same 30-item allowed_operations list repeated per run).

## 2. Public methods (BuddiesStore + 10 mixins merged by `Object.assign` at store.js:266)

srv = server/src caller count (files). 0 = unused by unleashd.

### Infra / workspace / identity
| Method @line | Behavior | Tables | srv |
|---|---|---|---|
| coordinationTransaction 272 | nested tx/savepoint | – | 1 (run-executor) |
| close 276 / backupDatabase 280 | close / VACUUM INTO | – | (generic) / 0 |
| createProject 1515 / createWorkspace 1552 | insert workspace | projects | 1 / 1 |
| getProject 1541, listProjects 1548, getWorkspace 1556 | read | projects | 0 / 0 / 0 |
| listWorkspaces 1560 | read | projects | 7 (builder*, owner-channel-reads, owner-team-configuration) |
| createBuddy 1564 | insert buddy + membership + soul/memory files | buddies, buddy_projects, memory_* | 1 (builder-mcp-server) |
| createBuddyFromBuilder 1637 | idempotent builder hire | buddies, builder_hires, memory_* | 1 (builder) |
| getBuddyBuilderResult 1803 / listBuddyBuilderResults 1820 | read builder hires | builder_hires | 2 / 1 |
| getBuddy 1832 | by id/slug | buddies | ~30 (15 files) |
| updateBuddy 1862 | profile/status/provider | buddies | 7 (builder, routes, soul) |
| listBuddies 1942 | | buddies | 8 |
| assignBuddyToProject 1966 / assignBuddyToWorkspace 1994 | insert membership | buddy_projects | 0 / 0 |
| listBuddyProjects 1980 / listBuddyWorkspaces 1998 | memberships | buddy_projects | 0 / 13 |
| getCoordinationMembership cw:179 | membership row | buddy_projects | 32 (9 files) |
| setCoordinationMembership cw:188 | patch limits/flags | buddy_projects, buddies | 1 (routes) |
| reparentBuddy cw:148 | change manager | relationships, audit, receipts | 1 (routes) |
| setBuddyRelationship 2058 / removeBuddyRelationship 2123 / listBuddyRelationships 2130 | org graph | relationships | 3 / 0 / 8 |
| isCoordinationManager cw:222 | manager check | relationships | 2 |
| countHeldDirectReports 5012 / resolveHireTarget 5043 / hireDirectReport 5098 | sub-buddy hiring with staged profile dirs | buddies, relationships, fs | 0 / 0 / 0 |
| retireDirectReport 5430 | archive sub + reassign work + cancel messages | buddies, owned_projects, messages | 1 (direct-reports) |
| assignBuddySkill 2473 / removeBuddySkill 2495 / listBuddySkills 2504 | skills | buddy_skills | 1 / 0 / 1 |

### Team access / configuration
| Method | Behavior | Tables | srv |
|---|---|---|---|
| getTeamContractVersion ta:53 | constant | – | 1 |
| setBuddyAccess ta:55 / getBuddyAccess ta:88 / listBuddyAccess ta:94 | capability grants | access_grants, receipts, audit | 0 / 0 / 2 |
| buddyCapability ta:100 / requireBuddyCapability ta:116 | grant check | access_grants, buddy_projects | 6 / 6 |
| createTeamBuddy ta:127 / setTeamRelationship ta:155 | grant-gated staff/edge writes | buddies, relationships | 2 / 2 |
| getTeamProfile ta:186 / updateTeamProfile ta:193 / readTeamDocument ta:219 / updateTeamDocument ta:231 | profile/soul/memory via grants | buddies, memory_* | 2/2/1/2 |
| getMessageExecution ta:274 | message's execution view | messages, runs | 1 |
| prepareTeamConfiguration tc:333 / applyTeamConfiguration tc:1035 / getTeamConfiguration tc:1287 | owner bulk team edit (create/memberships/relationships/grants/staffing), stored in receipts | buddies, buddy_projects, relationships, access_grants, receipts | 2 / 2 / 2 |
| teamConfigurationReadiness tc:899 / refreshTeamConfigurationResult tc:1245 | internal | | 0 / 0 |

### Messaging (directed) + background work
| Method | Behavior | Tables | srv |
|---|---|---|---|
| sendMessage 2513 | legacy direct send with wait | messages | 2 (dispatch-service, conversation-websocket) |
| sendCoordinatedMessage co:226 | idempotent send + enqueue run + launch/return policy + background exec | messages, runs, receipts, audit | 1 |
| previewCoordinatedMessage cr:32 | dry-run | | 2 |
| getCoordinatedMessageByKey co:128 | by command_key | messages | 1 |
| getMessage 2562 / listMessages 2573 | read | messages, approvals | 21 / 3 |
| bindMessageConversation 2602 | pending→active | messages | 1 |
| replyMessage 2609 / replyToOwnerMessage 2623 | →replied | messages | 1 / 3 |
| enqueueMessageReply co:424 | queue reply run | runs | 0 |
| finishMessageWait 2654 / cancelConversationMessageWaits 2661 | wait_status | messages | 4 / 0 |
| finishConversationMessages 2666 / failMessage 2674 | →failed | messages | 1 / 1 |
| stopBuddyMessageRoot co:1048 | stop a message tree | messages, runs | 2 |
| getMessageDeliveries cr:112 | delivery view | messages, runs | 1 |
| getBackgroundWork bw:50 / getProjectBackgroundExecution bw:183 / reconcileBackgroundWork bw:226 | until_done budget accounting | messages, runs, owned_projects, todos | 0 / 1 / 1 |
| backgroundParentMessage / assertBackgroundReply / settleBackgroundReply / deliverBackgroundReply bw:194-356 | internal | | 0 |

### Runs / scheduling / leases
| Method | Behavior | Tables | srv |
|---|---|---|---|
| enqueueBuddyRun co:476 | idempotent by input_key; pending cap; snapshot project epochs | runs | 2 |
| enqueueBuddyChatRun co:191 / startBuddyChatRun co:205 / abandonQueuedBuddyChatRuns co:214 | foreground chat admission | runs | 3 / 2 / 2 |
| inspectBuddyAdmission co:586 / activeRunLimitReason co:155 / coordinationActiveCounts co:139 / coordinationBackgroundActiveCounts co:181 | capacity gates (per-buddy 5, machine bg 8) | runs, buddy_projects | 2 / 0 / 0 / 0 |
| claimBuddyRun co:625 / startBuddyRun co:697 / finishBuddyRun co:730 | queued→claimed→running→terminal | runs, messages | 1 / 1 / 4 |
| withBuddyRunAuthority co:665 | per-tool-call lease + policy + project gate check | runs, buddies, messages, owned_projects | 4 |
| holdBuddyRun co:912 / recoverBuddyRuns co:918 / repairBuddyRun co:942 / retryBuddyRun co:967 / cancelBuddyRun co:1040 | hold/recover/retry/cancel | runs | 7 / 1 / 1 / 2 / 4 |
| getBuddyRun co:537 / listBuddyRuns co:544 | read | runs | 26 / 8 |
| enqueueBuddyFailureNotice co:762 / ensureInterruptionReport co:793 / reconcileInterruptionReports co:854 / enqueueInterruptionReportReturn co:878 | failure→notice run to sender | runs, messages | 0 (internal) |
| recordRunExecution cr:74 | write execution_snapshot | runs | 1 |
| checkpointBuddyRun cr:92 / listRunCheckpoints cr:101 | checkpoints | checkpoints | 0 / 3 |
| getBuddyRunRecovery cr:135 / recoverClosedBackgroundMessage cr:237 / retryUndeliveredInputs cr:300 | recovery | runs, messages | 2 / 0 / 1 |
| coordinationCommand co:447 | idempotency wrapper | receipts | 6 (+15 in-pkg) |
| createAutomation 4317 / getAutomation 4387 / listAutomations 4395 / updateAutomation 4419 / deleteAutomation 4484 / archiveAutomation 4488 | schedules | automations, automation_policies | 2 / 9 / 7 / 7 / 0 / 1 |
| listDueAutomations 4518 / claimAutomationRun 4535 / updateAutomationRun 4667 | scheduler lease | automation_runs, automation_run_policies | 1 / 2 / 8 (all scheduler.ts) |
| getAutomationRun 4652 / …ByIdempotencyKey 4660 / listAutomationRuns 4796 / …ByConversationId 4810 / listNonterminalAutomationRuns 4818 | read | automation_runs | 3 / 0 / 2 / 1 / 5 |
| assertAutomationOperationAllowed 4828 / withAutomationRunAuthority 4854 | per-op authority for automation turns (duplicates withBuddyRunAuthority) | automation_run_policies | 3 / 2 |
| linkConversation 4872 / updateConversationLink 4952 / getConversationLink 4983 / listConversationLinks 4988 | conversation binding | conversation_links | 1 / 1 / 0 / 4 |

### Tasks (owned_projects), todos, comments, legacy work
| Method | Behavior | Tables | srv |
|---|---|---|---|
| newProject 3038 / upsertBuddyProject 3101 | create Task (+todos) | owned_projects, todos | 1 / 0 |
| createCoordinatedProject cw:296 / updateCoordinatedProject cw:461 | idempotent create/update w/ ownership handoff, pause/drain/cancel, epoch bump, acceptance | owned_projects, todos, runs, messages, automation_runs, receipts, audit | 5 / 4 |
| updateProject 3206 | status/fields + todoOperations | owned_projects, todos | 1 |
| finishProjectHandoffs cw:329 | pending_owner → owner once drained | owned_projects, messages | 1 |
| reassignOwnedProject 2017 | change owner | owned_projects | 0 |
| getBuddyProject 3143 / listBuddyOwnedProjects 3155 / listTodos 3193 | read | owned_projects, todos | 20 / 12 / 0 |
| projectAncestors cw:230 / canReadCoordinationProject cw:244 / canManageCoordinationProject cw:262 / assertProjectExecution cw:273 | hierarchy + visibility + execution gate | owned_projects, messages, relationships | 1 / 8 / 2 / 0 |
| appendTaskComment cw:83 / listTaskComments cw:127 | comments | task_comments | 2 / 2 |
| createSprint 2979 / getSprint 3012 / getActiveSprint 3017 / completeSprint 3025 | sprints | sprints | 0 / 0 / 0 / 0 |
| createWorkItem 3872 / upsertWorkItem 3944 / getWorkItem 3988 / updateWorkItemStatus 3993 / listWorkItems 4021 / currentWork 4053 / auditWorkMigration 4066 | legacy work items | work_items | 0 / 0 / 1 / 1 / 1 / 0 / 0 |
| dashboard 4101 / overview 4149 / getBuddyTeamState 4127 / getBuddyContext 4273 | aggregate reads | many | 1 / 1 / 4 / 5 |

### Memory / knowledge
| Method | Behavior | Tables | srv |
|---|---|---|---|
| updateMemory 3298 / updateSoul 3318 | CAS revision of working/long_term/soul + materialize md files | memory_revisions, memory_heads, fs | 5 / 2 |
| readBuddyMemory 3835 / readBuddySoul 3536 | heads | memory_heads | 6 / 3 |
| exportCheck 3342 / fixExport 3363 | compare fs view with ledger | memory_*, fs | 0 / 0 |
| rememberNote 3552 | write immutable note **as a markdown file** in `<ws>/agent_notes/` | fs only | 3 |
| recall 3724 | ripgrep over `agent_notes/` files | fs | ~20 |
| summarizeMemoryWrites 2270 | audit-derived summary | audit | 1 |
| checkKnowledgeDocument / readKnowledgeDocument / replaceKnowledgeDocument / listKnowledgeDocuments / listKnowledgeScopes / knowledgeAudienceKey (knowledge.js:75-145) | scoped docs, CAS, authorization, session-continuity key | knowledge, knowledge_revisions, audit, receipts | 1 / 6 / 3 / 3 / 1 / 1 |

### Channels
| Methods (lists.js:209-434) | Behavior | Tables | srv |
|---|---|---|---|
| createList / getList / listLists / createPost / getPost / listPosts / listThread / searchPosts / pagePosts / newestListPost / listUnread / markListRead | channel CRUD, threads, search, unread | lists, list_posts, list_reads | 2/7/3/4/7/3/1/1/5/2/1/1 |

### Delegation / review / approval / audit / mail
| Method | Behavior | Tables | srv |
|---|---|---|---|
| createDelegation 2680 / getDelegation 2723 / updateDelegation 2804 / listDelegations 2832 | | delegations | 1 / 2 / 4 / 4 |
| claimDelegationDispatch 2728 / bindDelegationConversation 2756 / failDelegationDispatch 2782 | dispatch lease | delegations | **0 / 0 / 0** |
| createReview 2859 / getReview 2915 / updateReview 2920 / listReviews 2952 | | reviews | 1 / 1 / 4 / 3 |
| createApprovalRequest 2291 / getApprovalRequest 2398 / listApprovalRequests 2405 / resolveApprovalRequest 2437 | | approvals | 1 / 2 / 3 / 1 |
| attachMessageApproval / resolveMessageApproval / consumeProjectApproval (ca:20-44) | | approvals | 0 / 0 / 0 |
| recordAuditEvent 2147 / getAuditEvent 2184 / listAuditEvents 2196 / listBuddyActivity 2229 | | audit | 9 / 0 / 1 / 1 |
| prepare/get/authorize/claim/settleMailEffect, recordInboundMail (mailbox.js:21-62) | | mail_* | **all 0** |

**Public methods with no server caller:** backupDatabase, getProject, listProjects, getWorkspace, assignBuddyToProject, assignBuddyToWorkspace, listBuddyProjects, reassignOwnedProject, removeBuddyRelationship, getAuditEvent, removeBuddySkill, cancelConversationMessageWaits, claim/bind/failDelegationDispatch, all 4 sprint methods, upsertBuddyProject, listTodos, exportCheck, fixExport, createWorkItem, upsertWorkItem, currentWork, auditWorkMigration, deleteAutomation, getAutomationRunByIdempotencyKey, getConversationLink, countHeldDirectReports, resolveHireTarget, hireDirectReport, checkpointBuddyRun, recoverClosedBackgroundMessage, 3 message-approval methods, setBuddyAccess, getBuddyAccess, all 6 mailbox methods. That is **~45 of ~210**.

## 3. State machines

| Entity.column | States | Transitions (driver) | Live distribution |
|---|---|---|---|
| buddies.status | active, paused, archived | any via updateBuddy 1862 (owner); →archived by retireDirectReport 5430 | 48 active / 3 archived / 0 paused |
| buddies.employment_mode | standing, worker | set at create; 3 triggers freeze a worker's parent | 51 standing / **0 worker** |
| buddy_runs.status | queued → claimed → running → {complete, failed, cancelled}; claimed/running → cancel_requested → cancelled/failed | enqueue (co:476, idempotent on input_key); claim (co:658, only if admission passes, else `holdBuddyRun` sets error_code held/capacity and the run stays queued); start (co:725); finish (co:745: cancel_requested can only →cancelled; an expired run cannot complete); cancel (co:1042: queued→cancelled, otherwise →cancel_requested); recover (co:929 on boot: live→failed `interrupted`); abandon chat (co:221); project cancel (cw:581); background settled (bw:267). On failure, enqueueBuddyFailureNotice queues a `failure_notice` run to the sender, or an interruption-report run after timeout/interrupted | complete 2104, failed 252, cancelled 121, queued 30, running 8, claimed 0. error_code: held 74, max_runtime_timeout 66, execution_failed 48, user_stop 38, out_of_tokens 27, interrupted 13, provider_error 10 |
| buddy_messages.status | pending → active → replied; pending/active → failed / cancelled | bindMessageConversation 2603 / startBuddyRun (pending→active); #replyMessage 2643 / settleBackgroundReply bw:335 (→replied); failMessage 2675 / finishConversationMessages 2669 (→failed); stopBuddyMessageRoot co:1058, project cancel cw:586, ownership handoff cw:370, retire 5509 (→cancelled) | active 187, replied 252, cancelled 123, pending 23, failed 0 |
| buddy_messages.wait_status | none, waiting, replied, timed_out, cancelled | sendMessage with waitUntil; →timed_out lazily on read (2533/2567) | **all 585 = none** (the wait machinery is unused) |
| owned_projects.status | backlog, ready, in_progress, blocked, review, done, cancelled | any state to any state via updateProject 3206 / updateCoordinatedProject cw:461 (Buddy tools + owner). Guards: blocked needs a reason; changing the definition of done while moving to done without evidence demotes to in_progress; background completion needs all todos terminal + evidence (cw:599-600) and sets accepted_by | done 166, cancelled 51, in_progress 41, ready 30, backlog 29, blocked 27, review 15 |
| owned_projects.execution_state | enabled, paused, draining, cancelled | updateCoordinatedProject (cw:551) bumps execution_epoch, which invalidates queued runs through project_epochs; an ownership change moves to draining (cw:496), then finishProjectHandoffs back to enabled (cw:359) | enabled 293, paused 16, cancelled 50, draining 0; pending_owner_id never set |
| buddy_todos.status | open, in_progress, blocked, done, cancelled | #updateTodo 5636 via todoOperations; same demotion rule (→open) | done 549, open 281, cancelled 174, blocked 108, in_progress 63 |
| work_items.status | same 7 as projects | updateWorkItemStatus 3993 | 15 rows frozen since 07-28 |
| sprints.status | planned, active, completed, cancelled | createSprint / completeSprint | 3 active (orphaned) |
| conversation_links.status | active, complete, failed, cancelled | updateConversationLink 4952 (integration.ts) | 868 active: links are rarely closed |
| buddy_automations | enabled 0/1, archived_at | update/archive | 1 enabled, 15 disabled |
| buddy_automation_runs.status | claimed → running → {complete, failed, cancelled}; → cancel_requested → cancelled/failed | claimAutomationRun 4535 (also terminalizes expired claims), updateAutomationRun 4667 (scheduler.ts), project pause cw:507/569 | complete 38, failed 12, cancelled 1 |
| buddy_delegations.status | pending → active → complete/failed/cancelled | createDelegation, updateDelegation; the dispatch lease methods are unused | 4 pending forever, 4 cancelled, 1 complete, 1 failed |
| buddy_reviews | status draft→complete/cancelled; verdict needs_work/pass/fail | updateReview | 2 complete |
| buddy_approval_requests.status | pending → approved/rejected (a CHECK ties this to resolved_by) | resolveApprovalRequest 2437 (owner) | 3 pending since Aug |
| buddy_mail_effects.status | free text | mailbox.js | 0 rows |
| buddy_relationships.kind | manager, reports_to (input alias only, normalized to manager, store.js:65-85), consults, reviews | set/remove/reparent | 30 manager, 7 consults, 1 reviews |

## 4. Concept map

LOC = approximate lines in the package (store.js ranges + mixins; excludes 446 lines of shared infra and the 884-line #migrate).

| Concept | Tables | Pkg LOC | Live rows | Verdict |
|---|---|---:|---:|---|
| Identity: workspace, buddy, membership | projects, buddies, buddy_projects | ~500 (store 1515-2016) | 16 / 51 / 61 | **CORE**, but MERGE buddy_projects into buddies. Every buddy has its home membership (51 of 61 rows), every limit column is still at its default, and `dispatch`/`read_all_work` are barely used. Keep 1–3 settings as buddy columns |
| Org graph + hiring | buddy_relationships, hire/retire (5012-5570), triggers | ~690 (130+559) | 38 | **CORE (manager_id only)**. 30 of 38 rows are `manager`, at most one per report, so a `manager_id` column is enough. consults/reviews (8 rows): DEFER. Worker mode (0 rows), staged profile dirs and hire_quota (1 non-zero): DEAD |
| Team access / configuration | buddy_access_grants, receipts(team:*) | 320 + 1,300 | 2 grants, both empty | **DEAD** (grants) / **DEFER** (bulk configure: 21 `owner.configure_team` audit events). A 1,300-line compiler exists for what amounts to a few inserts |
| Directed messaging | buddy_messages | ~170 store + ~600 of coordination.js + 377 background-work + 326 receipts | 585 | **CORE**: send / reply / return to the caller is the core loop. The table has 30 columns; wait_*, notification_pending, superseded and continue_from are mostly unused, so trim to ~12 columns |
| Channels | buddy_lists, list_posts, list_reads | 452 | 32 / 318 / 51 | **CORE but MERGE with messages + task comments** into one `post` table, whose target is a buddy, channel or task. lists.js:3-8 keeps them apart on purpose because messages carry a lifecycle; that lifecycle can become a nullable reply state |
| Task comments | buddy_task_comments | ~65 | 945 | **MERGE → post (target=task)** |
| Tasks | owned_projects, buddy_todos | ~340 store + ~450 coordination-work | 359 / 1,175 | **CORE (owned_projects)**. MERGE todos into child tasks (parent_project_id already exists, with 129 children) or into a JSON checklist. Ownership handoff/draining/pending_owner (0 uses): DEFER |
| Legacy work model | work_items, sprints | ~290 | 15 / 3 (Jul 28) | **DEAD**: superseded by owned_projects, and conversation_links.work_item_id is always NULL |
| Runs / leases | buddy_runs, buddy_checkpoints, conversation_links | ~1,000 | 2,515 / 29 / 955 | **CORE (runs)**. Checkpoints are DEAD: the writer has 0 callers, the last row is from 09-13 and it holds malformed JSON. conversation_links: MERGE into run/conversation |
| Schedules | buddy_automations, automation_policies, automation_runs, automation_run_policies | ~726 | 16 / 16 / 51 / 51 | **CORE (schedule definition)**, but **MERGE automation_runs → runs** (input_kind='schedule'). Its own lease and authority check duplicate buddy_runs. Policies → one JSON column |
| Memory (owner-level) | buddy_memory_heads, buddy_memory_revisions + md file materialization + legacy import | ~574 + 307 legacy init | 153 / 238 | **MERGE → knowledge**. knowledge.js:83-93 already copies these heads into owner_thread knowledge on read, so there are two ledgers for one concept |
| Knowledge (scoped) | buddy_knowledge, buddy_knowledge_revisions | 232 | 1,415 / 2,314 | **CORE** as the single doc store. The `shared` kind has 0 rows. Filesystem notes (rememberNote/recall over `agent_notes/`) are a third memory store: MERGE into doc(kind=note) |
| Approvals / delegation / review | approvals, delegations, reviews | 182 + 179 + 120 + 56 | 3 / 10 / 2, last Aug | **DEAD** |
| Skills | buddy_skills | 40 | 4 (Jul 28) | **DEAD** |
| Mail | mail_effects, mail_inbound | 69 | 0 / 0 | **DEAD** |
| Builder | builder_hires, builder_creations | ~200 | 42 / 9 | MERGE builder_hires → the idempotency key on the event log; builder_creations **DEAD** |
| Audit | buddy_audit_events | 144 | 23,106 (22.8 MB) | **CORE as one event log**, but record mutations only: ~35% of rows (≈8.2k) are pure reads. Add retention |
| Receipts | buddy_command_receipts | ~30 + team-config usage | 5,698 (30.1 MB) | **MERGE → event log** (a unique `idem_key` plus a reference to the result entity, not a copy of it). Needs a TTL |
| Aggregates | dashboard/overview/getBuddyContext/getBuddyTeamState | 216 | – | move to server read-models |
| CLI/scripts/profiles/d.ts | – | 566 + 545 + 951 | – | DEAD for unleashd |

Overlaps:
- **projects vs owned_projects vs buddy_projects**: `projects` is the workspace, `owned_projects` is the Task, and `buddy_projects` is membership plus limits. The names do not match what the tables hold.
- **automation_runs vs buddy_runs**: same lifecycle and lease, separate authority checks (store.js:4828/4854 vs coordination.js:665), and 0 shared conversations. Merge them.
- **todos vs work_items vs sprints**: work_items and sprints have been dead since Jul 28. Todos are alive but duplicate child tasks.
- **knowledge vs memory_heads/revisions**: two revisioned doc ledgers plus a filesystem note store. One `doc` table covers all three.
- **lists/list_posts vs messages (+task_comments)**: three append streams of {author, body, evidence, created_at}.
- **audit_events vs command_receipts**: both append-only with no retention; together they are 53 MB, 60% of the DB.

## 5. Migration burden

- There are 33 schema versions. `#migrate()` store.js:296-1179 (884 lines) covers v0→v19. Ten module migrators follow: coordination v20-21, approvals v22, team-access v23, background v24, team-config v25, knowledge v26, receipts v27, worker-mode v29, task-comments v30, lists v31-33; mailbox is unversioned `CREATE IF NOT EXISTS`. Legacy passes also run at boot: #migrateLegacyMemoryPolicies 1180, #initializeMemoryDocuments 1206, #migrateLegacyNotes 3651, #normalizeReportsToEdges 1398, #collapseDuplicateManagerEdges 1425, #gcStagedProfiles 5404. In total that is about 1,450 lines of migration and legacy code.
- Signs of pain in the code: a v12 step kept verbatim because a wrong schema shipped (store.js:861-897); two builds that both used v18 (1129); a v20 from a separate build (coordination.js:63); three table copies just to widen a CHECK (v15, v17, v21).
- **A one-time export/import removes all of it.** Open v33 read-only, write the clean schema in Section 6, and keep the v33 file as an archive. Dead tables are simply not imported, and audit/receipts can be cut to the last N days.

## 6. Proposed minimal data model (11 tables; +1 optional)

```sql
CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);

CREATE TABLE buddy (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  slug TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  manager_id TEXT REFERENCES buddy(id),           -- was buddy_relationships(kind=manager)
  provider TEXT, model TEXT, reasoning_effort TEXT, -- pass-through strings
  soul_path TEXT,                                  -- git-shareable view of doc(kind='soul')
  background_enabled INTEGER NOT NULL DEFAULT 0,
  max_active_runs INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL, UNIQUE(workspace_id, slug));

CREATE TABLE task (                                -- was owned_projects (+ todos as children)
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  owner_id TEXT NOT NULL REFERENCES buddy(id), parent_id TEXT REFERENCES task(id),
  title TEXT NOT NULL, done_criteria TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','in_progress','blocked','review','done','cancelled')),
  paused INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 1,
  next_action TEXT, blocked_reason TEXT, evidence TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE channel (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, purpose TEXT NOT NULL,
  created_by TEXT, created_at TEXT NOT NULL, UNIQUE(workspace_id, name));   -- created_by NULL = owner

CREATE TABLE post (                                -- messages + list_posts + task_comments
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  author_id TEXT REFERENCES buddy(id),             -- NULL = owner
  target_kind TEXT NOT NULL CHECK(target_kind IN ('buddy','owner','channel','task')),
  target_id TEXT,
  root_id TEXT REFERENCES post(id), reply_to_id TEXT REFERENCES post(id),
  task_id TEXT REFERENCES task(id),
  purpose TEXT, body TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
  reply_state TEXT CHECK(reply_state IN ('awaiting','replied','cancelled','failed')), -- NULL = no reply owed
  reply_body TEXT, reply_evidence TEXT, replied_at TEXT,
  conversation_id TEXT, return_conversation_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE post_read (buddy_id TEXT, channel_id TEXT, last_post_id TEXT, PRIMARY KEY(buddy_id, channel_id));

CREATE TABLE doc (                                 -- knowledge + memory_heads (+ fs notes)
  id TEXT PRIMARY KEY, buddy_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('buddy','workspace','task','thread')), scope_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('soul','working','long_term','note','shared')), name TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(buddy_id, workspace_id, scope_kind, scope_id, kind, name));
CREATE TABLE doc_revision (doc_id TEXT, revision INTEGER, content TEXT, reason TEXT, author TEXT,
  provenance TEXT, sha256 TEXT, created_at TEXT, PRIMARY KEY(doc_id, revision));

CREATE TABLE schedule (                            -- automations + policies
  id TEXT PRIMARY KEY, buddy_id TEXT NOT NULL, workspace_id TEXT NOT NULL, task_id TEXT,
  cron TEXT NOT NULL, timezone TEXT NOT NULL, prompt TEXT NOT NULL,
  limits TEXT NOT NULL, enabled INTEGER NOT NULL, next_run_at TEXT, archived_at TEXT);

CREATE TABLE run (                                 -- buddy_runs + automation_runs + conversation_links
  id TEXT PRIMARY KEY, input_key TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
  input_kind TEXT NOT NULL CHECK(input_kind IN ('chat','post','reply','schedule','failure_notice')),
  input_id TEXT NOT NULL, buddy_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  conversation_id TEXT, task_id TEXT, task_epoch INTEGER, after_run_id TEXT, retry_of TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','cancel_requested','complete','failed','cancelled')),
  lease_token TEXT, deadline TEXT, allowed_ops TEXT NOT NULL,
  snapshot TEXT, outcome TEXT, error_code TEXT, error TEXT,
  ready_at TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT,
  UNIQUE(input_key, attempt));
CREATE UNIQUE INDEX run_live_input ON run(input_key) WHERE status IN ('queued','running','cancel_requested');
CREATE UNIQUE INDEX run_conversation_slot ON run(conversation_id) WHERE status IN ('running','cancel_requested');

CREATE TABLE event (                               -- audit_events + command_receipts
  seq INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, workspace_id TEXT NOT NULL,
  buddy_id TEXT, task_id TEXT, op TEXT NOT NULL, payload TEXT NOT NULL,
  idem_key TEXT, payload_hash TEXT, result_ref TEXT,
  UNIQUE(actor, workspace_id, idem_key));           -- mutations only; TTL-pruned
```
Optional 12th table if the server needs a conversation binding before the first run:
`conversation(id PK, buddy_id, workspace_id, task_id, scope)`.

### Current table → new home
| Current | New home |
|---|---|
| projects | workspace |
| buddies | buddy |
| buddy_projects | buddy.background_enabled / max_active_runs. The 10 memberships outside a buddy's home workspace need an owner decision: re-home or drop |
| buddy_relationships | buddy.manager_id (manager rows); consults/reviews (8) dropped or kept as a doc note |
| buddy_access_grants, buddy_skills, buddy_mail_*, buddy_builder_creations | delete |
| buddy_builder_hires | event.idem_key on buddy create |
| owned_projects | task |
| buddy_todos | task (parent_id = owning task, position) |
| work_items, sprints | delete (kept in the v33 archive) |
| buddy_messages | post (target buddy/owner, reply_state) |
| buddy_lists / buddy_list_posts / buddy_list_reads | channel / post (target channel, root_id) / post_read |
| buddy_task_comments | post (target task) |
| buddy_delegations, buddy_reviews, buddy_approval_requests | delete |
| buddy_runs | run |
| buddy_automation_runs + run_policies | run (input_kind='schedule'); importing the 51 historical rows is optional |
| buddy_automations + policies | schedule |
| buddy_checkpoints | delete |
| conversation_links | run.conversation_id (or the optional `conversation` table) |
| buddy_memory_heads/revisions | doc/doc_revision (scope_kind='buddy'); soul = doc kind soul |
| buddy_knowledge/revisions | doc/doc_revision |
| agent_notes/*.md written by rememberNote | doc kind note (optional import) |
| buddy_audit_events | event (mutations only, last N days) |
| buddy_command_receipts | event.idem_key (last N days) |

## 7. Migration must-preserve (zero-loss: posts/messages, memories, soul)

The owner confirmed the 35→~10 table plan. Three data classes must survive with zero loss. Counts below
are from the fresh copy `db/buddies.sqlite` (2026-09-25), which is newer than the counts used in §1–6.

### 7.1 Source → target

| Data | Source (rows today) | Target | Field mapping (lossless) |
|---|---|---|---|
| Directed messages | `buddy_messages` (600) | `post` target_kind buddy\|owner | id kept; from_buddy_id→author_id; to_buddy_id→target_id (NULL → target_kind 'owner'); purpose, body, evidence verbatim; status→reply_state (pending/active→awaiting, replied, failed, cancelled; expects_reply=0 & not replied → NULL); reply_body/reply_evidence/replied_at verbatim; root_message_id→root_id; in_reply_to_id→reply_to_id; buddy_project_id→task_id; child_conversation_id→conversation_id. **Keep every other column in a `legacy JSON` column on the imported row** (outcome, source_*, not_before, command_key, return_policy, …) so nothing is dropped even where the new model has no field |
| Channels | `buddy_lists` (32) | `channel` | id, workspace_id, name, purpose, created_by_buddy_id (NULL for owner), created_at verbatim |
| Channel posts | `buddy_list_posts` (321) | `post` target_kind channel | id kept; list_id→target_id; from_buddy_id→author_id (author_kind 'owner' → NULL); thread_root_id→root_id; purpose, body, evidence, buddy_project_id→task_id, sender_conversation_id, sender_run_id (→legacy), created_at verbatim |
| Read cursors | `buddy_list_reads` (51) | `post_read` | 1:1 |
| Task comments | `buddy_task_comments` (962) | `post` target_kind task | id kept; project_id→target_id and task_id; author ('owner' or buddy id)→author_id; body, evidence, created_at verbatim |
| Owner memory heads | `buddy_memory_heads` (153 = 51×3) + `buddy_memory_revisions` (238: working 88, long_term 83, soul 67) | `doc` (scope_kind 'buddy', scope_id = buddy_id, kind working\|long_term\|soul) + `doc_revision` | Every revision row → doc_revision (revision, body→content, reasoning→reason, author_kind/requested_by→author, provenance_json, sha256, created_at). doc.revision/content = the head's revision. base_revision_id and the revision id kept in provenance |
| Scoped knowledge | `buddy_knowledge` (1,451) + `buddy_knowledge_revisions` (2,365) | `doc` + `doc_revision` | id kept; scope_kind owner_thread→'thread', project→'task', workspace→'workspace'; scope_id, kind, name, revision, content verbatim; all revisions copied |
| Soul file | `<root_path>/<soul_path>` or absolute soul_path (48 buddies have a path) | stays a file, `buddy.soul_path` kept | The file is a rendered view of the soul head (`#renderMemoryDocument`, store.js:1350: front matter `version/updated/document: soul`, then the body). The DB head stays authoritative; the file is re-rendered only if it is byte-different from the render |
| Filesystem notes | `<ws>/agent_notes/*.md` written by rememberNote | untouched (files) or optional import to doc kind note | Not in the DB; the migration must not delete them |

### 7.2 Soul: file vs DB today (checked read-only: `tools/soul-check.mjs`)

Each of the 51 buddies' soul head (`buddy_memory_heads` kind soul → revision body) was compared with its file after removing the front matter:

| Result | Buddies | Notes |
|---|---:|---|
| Body identical, file version = DB revision | 44 | Files for revision ≥2 are 1 byte longer (trailing newline from the render); trimmed bodies are equal |
| Body identical, file has no front matter | 4 | growth-lead, growth-engineer, growth-operator, gtm-critic: seeded 2026-07-28 in `~/git/buddies/profiles/*/BUDDY_SOUL.md` and never re-rendered. The body matches revision 1 |
| No soul_path, empty soul head (revision 1, body '') | 3 | builder-ba05b0aa2a8106ba, builder-ddd9a6971e2720c6, builder-eac587b1ac0e9902 |
| Differ / file missing | **0** | |

Integrity: all 238 `buddy_memory_revisions.sha256` values equal sha256(body); every head points at a revision of its own buddy and kind.

**A second soul store diverges from the head.** 5 `buddy_knowledge` rows with kind='soul' (owner_thread scope) differ from the buddy's soul head:
builder-908b36c6d714b2e5 (knowledge rev 4), builder-28978554c7b8e865 (rev 3), builder-03dcaf078826cd40 (rev 3),
betting-deployment-lead-f5cd058594bb (rev 2), quant-lead-ada2cbd159e3 (rev 2).
These are per-thread soul edits that never reached the head or the file. The import must keep them as separate docs (scope 'thread') and flag them for an owner decision. Do not collapse them into the buddy-level soul.

Other checks: every `buddy_knowledge` row's content equals its latest revision; no orphan knowledge docs; no broken `thread_root_id` or `in_reply_to_id` references.

### 7.3 Verification (run before and after, both read-only, then diff)

1. **Counts per buddy.** Messages sent/received, channel posts authored, owner posts per channel, task comments per task, memory revisions per (buddy, kind), knowledge docs and revisions per (buddy, scope_kind, kind). The new DB must reproduce every tuple exactly, e.g. `SELECT author_id, target_kind, count(*) FROM post GROUP BY 1,2` against the union of the three source tables.
2. **Content hashes per buddy.** For each buddy b and each class c, compute sha256 over the sorted list of `id|created_at|body|evidence` (posts) or `doc_key|revision|content` (docs). The old and new hashes must be equal. Use the same canonical serializer on both sides.
3. **Revision-chain check.** For each doc, the set of (revision, sha256(content)) in doc_revision must equal the source revisions. For memory, the imported sha256 must equal the source `sha256` column.
4. **Soul files.** Before the migration, record sha256 of each soul file; after, the files must be byte-identical or unchanged, and `soul-check.mjs` rerun against the new DB must report the same 44/4/3 split with 0 differ.
5. **Keep the v33 file** (`VACUUM INTO` backup) as the archive; the new DB is written to a new path and swapped in only after checks 1–4 pass.
