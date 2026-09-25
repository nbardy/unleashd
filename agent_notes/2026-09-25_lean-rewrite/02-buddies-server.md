# 02 — Buddies: server, MCP and client-facing surface (scoping, read-only)

This document covers `server/src/buddies/*` at unleashd HEAD `cbb8820`: 49 files and **15,280 lines**. The working tree matches HEAD for these files. It also covers the MCP helper processes, the HTTP surface, the run and scheduling machinery, the client consumers, and the boundary between unleashd and the package. §8 designs the lean server against the approved 11-primitive model: **workspace, buddy, task, channel, post, post_read, doc, doc_revision, schedule, run, event**.

Nothing in the repository was edited. File:line citations come from single-file reads. Usage figures come from read-only queries of the live DB and of the copy at `unleashd-lean-scope/db/buddies.sqlite`. The audit range is 2026-07-28 to 2026-09-25.

Buddy code outside `server/src/buddies` that the redesign also touches:

| Where | Lines | Note |
|---|---|---|
| `server/src/conversations/buddy-creation-service.ts` | 368 | Builds creation, automation and background conversations |
| `server/src/conversations/runtime.ts` | 3,510 (254 "buddy" mentions) | Chat admission, MCP assembly, coordination turns, briefing refresh |
| `shared/src/buddy*.ts` (14 files) | 1,541 | Zod schemas for the wire and for tools |
| `server/test/*buddy*`, `*channel*` | 58 files, 20,353 lines | Tests |
| Client Buddy TS/TSX + CSS | 13,968 + 6,609 | See §5 |
| `@nbardy/buddies` `src/*.js` | 11,361 | store.js 5,942; team-configuration.js 1,300; coordination.js 1,069 |

---

## 1. Per-file inventory and verdicts (all 49)

Verdict key:
- **CORE**: stays, in some form, in the lean server.
- **MERGE→X**: folds into module X.
- **DELETE**: goes away. Often because its tables disappear under the 11-primitive model.
- **PKG**: moves into the Buddies package.
- **UCORE**: moves into unleashd core because it is not Buddy-specific.

"Prod importers" lists production callers only. The number in brackets is the count of test files that import it.

| # | File | Lines | Responsibility | Main exports | Prod importers [tests] | Verdict | Reason |
|---|---|---|---|---|---|---|---|
| 1 | operations.ts | 2,473 | One large switch over every `buddy.*` op: schemas, authorization helpers, and an audit row for every call, reads included (`:2460`) | `BuddyOperationsService`, `BuddyOperationInputSchemas`, `MESSAGE_BUDDY_OPERATIONS` | 14 modules + server.ts [31] | **REWRITE** → `mcp.ts` handlers (~400) | The switch runs `:774-2018`, about 40 cases. Dead cases: `delegate`, `request_review`, `complete_delegation`, `complete_assignment`, `submit_review`, `request_human_approval`, `checkpoint` (throws at `:1016`), `hire_direct_report`. The authorization rules at `:2209-2403` repeat checks the package already makes. |
| 2 | routes.ts | 1,652 | Owner HTTP API (~67 routes), a `guard` wrapper, and a rewrite of archived payloads | `registerBuddyRoutes` | server.ts [14] | **REWRITE** (~300) | 16 routes have no client caller (§3). Legacy adapters sit at `:1223-1271` and `:1639`. |
| 3 | scheduler.ts | 975 | Cron/interval math, a complete legacy automation-run executor (claim, lease, cancel, recover, pending terminals, degraded runs, memory-capture turn), and the 1 s tick that drives run-executor | `BuddyScheduler`, `nextAutomationRunAt`, `minimumAutomationGapSeconds` | operations, buddy-creation-service, server.ts [3] | **REWRITE** → `schedule.ts` (~100) | There are two automation executors (§4). The `sequence` and `loop` job kinds have 0 rows. `MEMORY_CAPTURE_PROMPT` (`:62`) is dead in production because `memoryReviewAfterEachTurn:true` is set at `server.ts:762` (checked at `:633`). |
| 4 | channel-responder.ts | 844 | @mention replies, the thread follow-up gate, seats, and reply posts written by the server | `createChannelResponder`, `threadConversationId` | channel-routes, server.ts [3] | **CORE** (~400) | Real feature. Carries authority bug B1 (§6). |
| 5 | run-executor.ts | 731 | Claims queued runs, builds a prompt for each input kind, creates and validates conversations, sweeps for recovery | `BuddyRunExecutor` | scheduler, server.ts [10] | **MERGE→runner.ts** (~300) | The prompt is chosen by a string switch (`:421-427`, `:453-511`). Recovery and admission policy (`:128-327`) repeat package rules. |
| 6 | contract.ts | 608 | Hand-written TS port of the package API | `BuddiesStorePort`, record types | ~30 files | **DELETE** | The package should ship its own `.d.ts`. Drift is caught only by `typeof fn !== 'function'` probes (`coordination-store.ts:163`, `owner-team-configuration.ts:34`). |
| 7 | builder.ts | 564 | Buddy Builder: hires, soul-file staging, relationships, initial projects, briefing | `BuddyBuilderService`, `BUDDY_BUILDER_BRIEFING` | builder-mcp-server, control-server, mcp-server, routes, soul, runtime.ts, conversation-routes.ts, server.ts [2] | **DELETE** except the ~40-line briefing | Under the new model "create buddy" is a single `buddy` insert through `team_admin`. The `buddy_builder_hires`/`creations` tables go away. |
| 8 | mcp-server.ts | 556 | Stdio MCP helper process. It opens its own `BuddiesStore` (`:437`), runs ops in-process, and relays only `send` over HTTP (`:500-536`). Also has a Builder mode (`:439-477`). | `createBuddyMcpServer`, `createLegacyBuddyMcpServer` | owner-mcp [22] | **REWRITE** → in-process `mcp.ts` | `mcp-config.ts` never passes the legacy contract flag (`:528`), so that path is test-only. Nested ternaries choose each tool's description, schema and post-processing (`:268-384`). |
| 9 | memory-review.ts | 504 | Post-turn memory reviewer: prompt, model ladder, receipts on disk, queue with concurrency 2, 120 s timeout | `BuddyMemoryReviewer` | memory-review-runner, runtime.ts, server.ts [5] | **CORE** (~250) | 1,947 reviews audited. Receipts are one file per job, all loaded into memory at init (`:180-206`). Move them to `event` rows. |
| 10 | integration.ts | 498 | Loads the package, composes the per-turn **briefing**, updates link status, settles legacy delegations | `createBuddiesIntegration`, `parseBuddyReviewResult` | buddy-creation-service, server.ts [14] | **CORE** briefing (~180); **DELETE** the rest | `settleDelegation` (`:446-471`) runs the legacy closure every time a Buddy conversation ends. There are 10 delegations, the last on 2026-08-22. |
| 11 | dispatch-service.ts | 480 | Executes `send`. Keyed durable path (`:137-272`), unkeyed legacy child-conversation path (`:273-401`), 100 ms wait-poll loops (`:226-247`, `:375-393`), return-branch preparer (`:408-480`) | `createBuddyDispatchService`, `createReturnConversationPreparer` | server.ts [14] | **MERGE→runner** (~120) | There are two send executors. Only the dashboard's "Send work" form (`BuddiesDashboard.tsx:321`, no key) reaches the unkeyed path. |
| 12 | team-access.ts | 447 | Profile validation, team op schemas, capability grants, `messageExecution` projection | `teamStore`, `teamAuthority`, `messageExecution`, `isRestrictedBuddyContext` | 7 modules [5] | **DELETE** | `buddy_access_grants` goes away (2 rows today). The authority rule becomes owner vs self vs manager-of. |
| 13 | control-server.ts | 432 | Loopback HTTP listener with 3 capability kinds, a 25 h TTL (`:21`), and routes `/v1/messages`, `/v1/owner/*`, `/v1/memory-review` | `BuddyControlServer` | mcp-server, memory-review-mcp, memory-review-runner, owner-mcp, server.ts [10] | **REPLACE** → `grants.ts` (~120) that hosts the in-process MCP endpoint | It exists only because the tools run in separate processes. |
| 14 | memory-review-runner.ts | 383 | One launch handler per reviewer harness; polices tool names | `createMemoryReviewRunner` | server.ts [2] | **MERGE→memory-review** (~120) | Most of it polices tool names for the stdio helper's namespace. |
| 15 | team-readiness.ts | 318 | Projection behind `get_capabilities` | `inspectTeamReadiness` | operations, resources | **DELETE** | Grants are gone. The tool list is the capability statement. |
| 16 | channel-routes.ts | 290 | Owner posts (media plus @mention dispatch), DM and wake, unread, owner-read, responding, workspace tasks, media upload | `registerChannelRoutes` | routes, server.ts [2] | **MERGE→routes/channels** | Split out only because of wiring. |
| 17 | builder-mcp-server.ts | 241 | Builder tool table. The current contract registers 3 read tools (`:209-214`) | `executeBuddyBuilderTool` | control-server, mcp-server [2] | **DELETE** | Folds into `team` and `team_admin`. |
| 18 | resources.ts | 257 | Opaque doc revision tokens, a document adapter, `compactCapabilities`, `compactInbox` | `executeDocumentResource`, `compactInbox` | mcp-server, owner-resources | **DELETE** | A projection layered on another projection (operations → resources → MCP). `doc_revision.id` is the revision. |
| 19 | channel-pages.ts | 225 | Keyset paging for channels, threads and task feeds | `readPage`, `readFeed` | operations, routes | **PKG** | This is a store query on `post`. |
| 20 | owner-resources.ts | 202 | Owner-actor copies of the profile, document and project ops | `executeOwnerResource` | control-server, owner-mcp, routes [3] | **DELETE** | The same handlers run with `grant.owner=true`. |
| 21 | channel-reply-gate.ts | 200 | Bare CLI `<yes>`/`<no>` gate run on the seat model, 90 s timeout (`:33`) | `createCliReplyGate` | channel-responder, server.ts [1] | **CORE** (~120) | — |
| 22 | knowledge.ts | 197 | Scoped document and notes ledger, audience authority | `knowledgeStore`, `scopedDocumentOperation`, `recallKnowledge` | integration, memory-review, operations, owner-resources, routes [2] | **PKG**, shrunk to `doc`/`doc_revision` | The audience scopes (`owner_thread`, `project`, `workspace`) need a decision (§8.6). 1,451 knowledge rows exist. |
| 23 | team-observation.ts | 182 | `get_team_state` projection | `observeBuddyTeam` | operations, routes | **DELETE** | Replaced by a `runs` query. |
| 24 | owner-channel-reads.ts | 180 | Owner unread marks in a host JSON file | `ownerChannelReads` | channel-routes, server.ts [2] | **DELETE** → `post_read` with reader=`owner` | The 11-primitive `post_read` can hold the owner as a reader. The header's rule, that owner reads never move Buddy marks, still holds because the reader key differs. |
| 25 | directory.ts | 146 | `list_buddies` search with cursor | `listBuddyContacts` | operations | **MERGE→`team` tool** (~20) | — |
| 26 | mcp-config.ts | 146 | Resolves `node [--import tsx] <entry>` and builds 3 stdio specs | `resolveBuddyMcpLaunch`, `buddyMcpServers`, … | mcp-server, memory-review-runner, runtime.ts, conversation-routes.ts [3] | **DELETE** | Replaced by `{kind:'http', url, headers}`. |
| 27 | channel-media.ts | 139 | Copies local media into the channel directory | `requireCanonicalPostMedia` | channel-responder, channel-routes, operations | **CORE** | — |
| 28 | owner-mcp.ts | 124 | Stdio relay for `configure_team` and 7 owner resources (`:90-111`) | `createOwnerTeamMcpServer` | none [3] | **DELETE** | Pure relay process. |
| 29 | closure.ts | 124 | Settles legacy delegation and review rows | `BuddyClosureService` | integration [1] | **DELETE** | Its tables are deleted. |
| 30 | coordination-store.ts | 119 | Type-cast interface over the package | `coordinationStore` | 12 modules + server.ts [19] | **DELETE** | The package ships the types. |
| 31 | buddy-conversation-slots.ts | 114 | Stable derived conversation ids per generation (DM, seats) | `stableConversationId`, `scanGenerations` | buddy-direct, channel-responder, server.ts [2] | **CORE** (in channels.ts) | — |
| 32 | owner-team-configuration.ts | 93 | Owner scope and provider validation around package team configuration | `configureOwnerTeam` | control-server, owner-resources, routes, server.ts [2] | **DELETE** | `team-configuration.js` (1,300 lines) goes away with grants. HTTP callers pass every workspace plus a synthetic `ownerInputId` (`routes.ts:281-285`, `:1519`), so the check means nothing there anyway. |
| 33 | buddy-direct.ts | 86 | Opens a DM; "wake" queues `WAKE_MESSAGE` into it | `createBuddyDirect` | channel-routes, server.ts [2] | **MERGE→channels** | — |
| 34 | direct-reports.ts | 82 | `hire_direct_report` / `retire_direct_report` | `executeDirectReportOperation` | operations | **DELETE** | Hire: 0 uses. Retire: 4. `team_admin` covers both. |
| 35 | chat-run-admission.ts | 48 | Enqueue, start and abandon a foreground chat run | `chatRunAdmission` | server.ts [6] | **MERGE→runner** | — |
| 36 | work-query.ts | 49 | Filter, sort and snapshot-hash for pages of work | `queryBuddyWork` | operations, owner-resources | **DELETE** | Replaced by a plain task query with keyset paging. |
| 37 | soul.ts | 53 | Versioned soul read and CAS update | `readBuddySoul`, `updateBuddySoul` | 4 modules [1] | **PKG** (soul = `doc` kind) | — |
| 38 | assignment-config.ts | 71 | Pins a per-send provider/model and asserts it matched | `resolveBuddyAssignmentConfig`, … | run-executor, server.ts [1] | **MERGE→runner** (~30) | Becomes a `run.config` column. |
| 39 | memory-review-mcp.ts | 69 | Stdio relay for 5 reviewer tools | `createMemoryReviewMcpServer` | none [1] | **DELETE** | Relay process. |
| 40 | channel-text.ts | 61 | Mention parsing, transcript lines, snippets | `mentionedBuddyIds`, … | channel-responder, channel-routes, operations | **CORE** | The client keeps its own 344-line version. |
| 41 | change-feed.ts | 59 | In-process change bus with 3 entry points ("doors") plus HTTP middleware | `notifyBuddiesChanged`, … | operations, owner-resources, server.ts [1] | **MERGE→events.ts** (~30) | Door 1 fires inside the MCP child process, where nothing listens (B2). |
| 42 | document-preview.ts | 51 | Line-diff preview plus cap check | `previewBuddyDocument` | knowledge, operations, owner-resources | **DELETE** | Drop preview. CAS on `doc_revision` is enough. |
| 43 | mcp-input-schema.ts | 43 | Discriminated-union wrapper and legacy flattener | `mcpObjectInput`, … | mcp-server, owner-mcp | **DELETE** | Use flat schemas. |
| 44 | memory-review-tools.ts | 43 | Reviewer tool table (5) | `MEMORY_REVIEW_TOOLS` | 3 modules [1] | **MERGE→mcp.ts** | The reviewer grant selects the memory subset. |
| 45 | visibility.ts | 39 | Rewrites **every** `/api/buddies` JSON response (`routes.ts:259-260`) | `visibleBuddyPayload` | routes | **DELETE** | Filter out archived Buddies in the queries. |
| 46 | cursor-ephemeral.ts | 30 | Deletes Cursor transcripts after hidden runs | `discardCursorTranscript` | channel-reply-gate, memory-review-runner [1] | **UCORE** or an agent-cli `ephemeral` option | Harness concern. |
| 47 | channel-post-feed.ts | 20 | In-process "post written" bus | `announceChannelPost` | 4 modules [1] | **MERGE→events.ts** | Same cross-process gap as #41. |
| 48 | provider-capability.ts | 16 | `harnessMcpCapability === 'required'` predicate | `assertBuddyProviderSupportsMcp` | 8 modules + runtime.ts | **UCORE** | Called from 9 sites (§6). |
| 49 | public-automation-run.ts | 16 | Strips the claim token from automation-run rows | `publicAutomationRun` | operations, routes | **DELETE** | The legacy automation-run table goes away. |

**Tally.** CORE or rewritten-core: 10 files (~6.2k lines today, ~2.0k target). DELETE: 25 files (~5.8k lines). MERGE: 12. PKG: 3. UCORE: 2.

---

## 2. MCP tool surface (today)

### 2.1 Processes started per Buddy turn

| Turn type | stdio MCP servers (each a `node --import tsx …` in dev) | Opens SQLite? | Tools |
|---|---|---|---|
| Buddy turn, owner input | `unleashd_buddy` + `unleashd_owner` (`runtime.ts:1140-1190`) | buddy: **yes** (`mcp-server.ts:437`) | 31 + 8 = **39** |
| Background, coordination or automation turn | `unleashd_buddy` | yes | ≤31, filtered by `--allowed-operation` argv (`mcp-config.ts:82-84`) |
| Builder turn | `unleashd_buddy --builder`, which opens the store unused and relays everything, + `unleashd_owner` | yes | 3 + 8 |
| Memory review | `unleashd_memory` | no | 5 |

### 2.2 Buddy MCP (`mcp-server.ts`)

The tool set is `TOOL_NAMES` (`:35-70`), minus the `replaced` set (`:254-260`), plus `get_document`/`update_document` (`:201-252`). "Audit n" counts all-time rows in `buddy_audit_events`.

| Tool | Input | Does | Store calls | Audit n | Under the 11-primitive model |
|---|---|---|---|---|---|
| get_capabilities | targets, messageIds, intent | Grants and readiness projection | `inspectTeamReadiness`, `compactCapabilities` | 499 | delete |
| create_buddy | key, name, role, soul, … | Create identity | `createTeamBuddy` | 0 | `team_admin` (owner) |
| set_relationship | from, to, kind, present, key | Manager/consults edge | `setTeamRelationship` | 0 | `team_admin` (`buddy.manager_id`) |
| get_profile / update_profile | targetBuddyId, changes | Profile | `getTeamProfile` / `updateTeamProfile` | 16 / 0 | `team` / `team_admin` |
| stop / retry_run | runId \| rootMessageId, key | Run control | `cancelBuddyRun`, `stopBuddyMessageRoot`, `retryBuddyRun` | 55 / 17 | `runs{action}` |
| list_buddies | query, scope, cursor | Directory | `listBuddyContacts` | 106 | `team` |
| get_message | messageId | Message plus execution | `getMessage`, `messageExecution` | 855 | `runs{id}` |
| get_runs | project/root filters | Runs | `listBuddyRuns` + per-row message reads | 136 | `runs` |
| get_team_state | limit, view, states | Coordination metadata | `observeBuddyTeam` | 521 | `runs` |
| append_task_comment / list_task_comments | projectId, key, body | Comments | `appendTaskComment` / `listTaskComments` | 1,926 / 506 | `task_write{comment}` / `tasks{projectId}` |
| get_current_work | limit, view, statuses | Projects and todos | `listBuddyOwnedProjects` → `queryBuddyWork` | 2,995 | `tasks` |
| get_inbox | limit, filter, order, cursor | Messages, 9 legacy sections, list unread | 9 reads (`operations.ts:1208-1337`) + `compactInbox` | 1,351 | `inbox` = my open runs + unread channels |
| get_automations / set_automation | `{command:{action…}}` | Schedules | `listAutomations`, `create/updateAutomation` | 85 / 32 | `schedule` |
| new_project / update_project | key, title, todoOperations, evidence, baseRevision | Tasks | `create/updateCoordinatedProject` | 322 / 1,423 | `task_write` |
| remember_note / recall | topic, body / pattern | Notes | `scopedNote`, `recallKnowledge` | 422 / 857 | `doc_write{kind:'note'}` / `doc_read{query}` |
| send | key, to, delivery{inform\|request\|work}, body | Mail plus background work | **HTTP** → `/v1/messages` → `dispatchService.send` | 598 | `send` → a `run` for the recipient |
| reply | messageId, outcome, body, evidence | Answer mail | `replyMessage` | 132 | implicit: the run's final outcome returns to the parent run |
| new_list / post | key, name / listId, body, threadId | Channel writes | `createList`, `createPost` | 60 / 357 | `channel_post` |
| get_list / get_thread / search_posts | anchors, query | Channel reads | `readPage`, `searchPosts`, `markListRead` | 117 / 43 / 31 | `channel_read` |
| retire_direct_report | buddyId, reason | Archive a report | `executeDirectReportOperation` | 4 | `team_admin` |
| get_document / update_document | ref, revision, content, key | Soul or memory CAS | → soul/memory ops | (127 / 90) | `doc_read` / `doc_write` |

Legacy tools are gated by run policy (`:145-155`, `:199`): `complete_assignment`, `complete_delegation`, `submit_review`. The legacy contract adds `get_soul`, `update_soul`, `get_memory`, `update_memory` and `hire_direct_report`. Four handlers are unreachable from any tool: `delegate`, `request_review`, `request_human_approval` and `checkpoint`.

### 2.3 Owner MCP (`owner-mcp.ts`): pure relay

| Tool | Relays to |
|---|---|
| `configure_team` (key, configuration{workspaceId, create, memberships, relationships, access, staffing}, preview, expectedPlanHash) | `/v1/owner/team-configuration` → `configureOwnerTeam` → package `prepare/applyTeamConfiguration` |
| `get_profile`, `update_profile`, `get_document`, `update_document`, `new_project`, `update_project`, `get_current_work` (each + workspaceId) | `/v1/owner/resource` → `executeOwnerResource` |

### 2.4 Builder MCP

The current contract has `list_workspaces`, `list_buddies` and `list_created_buddies`. The legacy contract also has `get_soul`, `update_soul`, `update_profile`, `set_relationship`, `new_project` and `create_buddy`. All of them relay to `/v1/owner/builder-operation`.

### 2.5 Memory-review MCP

`get_soul`, `get_memory{doc}`, `update_memory{doc,content,reasoning,baseVersion}`, `remember_note{topic,body}` and `recall{pattern,limit}`, all via `/v1/memory-review`.

### 2.6 Duplicates

- **Profile** has 5 entry points: buddy, owner, builder, `PATCH /:bid/profile` and `resources/update_profile`.
- **Documents** have 4 tool families: buddy, owner, reviewer and builder.
- **Notes** have 2: buddy and reviewer.
- **Tasks** have 3: buddy, owner and builder.
- **Staffing** has 3: buddy atoms, builder and `configure_team`.
- **Observation** has 5 overlapping reads: `get_inbox`, `get_message`, `get_runs`, `get_team_state`, `get_capabilities`.
- **`reply`** is `send` with `inReplyTo`.

In total there are **47 registrations across 4 servers**. Under the new model they become 12 tools on one endpoint (§8.3).

---

## 3. HTTP surface

The client's callers were inventoried in full: 52 distinct method+path pairs, all under `/api/buddies`. A Python substring scan of `client/src` and `tools/` re-checked them.

### 3.1 `routes.ts`

| Line | Method | Path | Purpose | Client caller | Fate (11-primitive) |
|---|---|---|---|---|---|
| 278 | POST | /team-configuration | configure_team | BuddyTeamConfiguration | delete → buddy CRUD |
| 288 | GET | /team-configuration | saved config | BuddyTeamConfiguration | delete |
| 303 | GET | /capabilities/archive | constant `{available:true}` | BuddySettings | delete |
| 307 | GET | /:bid/access/:ws | grants | BuddyTeamConfiguration | delete |
| 354 | GET | /workspaces/:ws/inactive-access | orphan grants | BuddyInactiveAccess | delete |
| 397 | GET | /:bid/capabilities/:ws | capability decisions | **none** | delete |
| 409 | POST | /:bid/reparent | manager | BuddyCoordination | `PATCH /buddies/:id` |
| 416 | GET | /:bid/team-state | observation | BuddyTeamExecution | `GET /runs?buddyId` |
| 447 | GET | /:bid/coordination | bundle | BuddyCoordination | fold into GET buddy |
| 471 | PATCH | /:bid/memberships/:ws | background enable/pause | BuddyCoordination, BuddyMessages | `PATCH /buddies/:id` |
| 480, 485, 498 | POST | /runs/:rid/{cancel,repair,retry} | run control | BuddyCoordination, BuddyTeamExecution | `POST /runs/:id/{cancel,retry}`; repair dropped |
| 513 | POST | /messages/:mid/stop | stop chain | BuddyCoordination, BuddyProjectExecution | `POST /runs/:id/cancel?tree=1` |
| 532, 535, 586 | GET/POST/PATCH | /projects/:pid/{execution,run} | until_done work | BuddyProjectExecution, BuddyCoordination | `POST /tasks/:id/run`, `GET /runs?taskId` |
| 604 | GET | /api/buddies | dashboard | **none** | delete |
| 609 | GET | /overview | overview | useBuddyData | keep |
| 618 | GET | /workspaces/:ws/activity | active jobs | channel-data | `GET /runs?workspaceId&live` |
| 735 | POST | /builder | Builder conversation | create-buddy-builder | keep |
| 755, 763 | GET | /builder/:cid/result(s) | Builder results | **none** | delete |
| 794 | POST | /:bid/messages | unkeyed legacy send | BuddiesDashboard | delete (or `POST /runs`) |
| 799 | GET | /messages | messages | BuddyMessages | `GET /runs` |
| 819, 828 | GET/POST | /lists | channels | channel-data | keep |
| 848, 869, 891 | GET | /lists/:lid/posts, /threads/:pid, /posts?projectId | feeds | channel-data | keep |
| 912 | POST | /messages/:mid/team-configuration | apply proposal | BuddyTeamConfiguration | delete |
| 957 | POST | /messages/:mid/reply | owner reply | BuddiesDashboard, BuddyDetailMobile | `POST /runs/:id/reply` |
| 964 | GET | /approvals | approvals | **none** | delete |
| 983 | POST | /approvals/:id/resolve | resolve | BuddyAutomationsTab | delete |
| 1014 | DELETE | /:bid | archive | BuddySettings | keep |
| 1048 | GET | /:bid | detail (delegations, reviews, legacyWorkItems, skills, approvals) | useBuddyData, BuddyTeamConfiguration | keep, slimmed |
| 1110 | PATCH | /:bid/profile | profile | **none** | delete |
| 1164, 1170 | GET/PUT | /:bid/soul | soul | BuddySoulEditor | `/docs/:bid/soul` |
| 1190 | GET | /:bid/context | raw context | useBuddyData | delete |
| 1200, 1211 | POST | /:bid/relationships, /:bid/skills | raw writes, no grant checks | **none** | delete |
| 1224–1268 | * | delegations, review-requests, reviews (410), `PATCH reviews` | legacy | **none** | delete |
| 1273–1390 | GET/PUT/POST | /:bid/memory{,/scopes,/:doc,/notes,/recall} | memory | BuddyMemoryWorkspace | `/docs` |
| 1412 | GET | /:bid/projects | projects | useBuddyData | `GET /tasks?buddyId` |
| 1423 | POST | /:bid/projects | create | **none** | `POST /tasks` |
| 1450, 1471 | GET/POST | /projects/:pid/comments | comments | BuddyTaskComments | posts on the task (§8.6) |
| 1491 | PATCH | /projects/:pid | update | BuddyProjectExecution | `PATCH /tasks/:id` |
| 1506, 1538 | GET/POST | /:bid/automations | schedules | useBuddyData, BuddyCoordination | `/schedules` |
| 1511 | POST | /resources/:operation | owner resource (7 ops) | only `update_profile` is used | `PATCH /buddies/:id` |
| 1529 | GET | /automations/health | health | **none** | delete |
| 1558, 1586, 1602 | PATCH/DELETE/POST | /automations/:aid{,/run} | schedule edit/run | both automations tabs | `/schedules/:id` |
| 1617, 1629 | GET/POST | /automations/:aid/runs, /automation-runs/:id/cancel | legacy run history | both tabs | `GET /runs?scheduleId`, `/runs/:id/cancel` |
| 1639 | PATCH | /work-items/:id | legacy | **none** | delete |

### 3.2 `channel-routes.ts`

All 8 routes have callers and all stay:
- POST `lists/:lid/posts` (`:131`)
- POST `:bid/direct` (`:169`)
- POST `:bid/wake` (`:178`)
- GET `channels/unread` (`:188`)
- POST `lists/:lid/owner-read` (`:200`)
- GET `lists/:lid/responding` (`:214`)
- GET `workspaces/:ws/tasks` (`:221`)
- POST `lists/:lid/media` (`:254`)

### 3.3 Elsewhere

- `server.ts:640`: GET `/api/buddies/:bid/memory-reviews`. **No client caller.**
- `control-server.ts`, on a loopback listener at a random port with a bearer capability:
  - POST `/v1/messages` (`:374`)
  - POST `/v1/owner/{team-configuration,resource,builder-operation}` (`:218-293`)
  - POST `/v1/memory-review` (`:294`)

  Only the MCP helpers call these.
- The `change-feed.ts:50` middleware on `/api/buddies` turns every non-GET 2xx into a `buddies_changed` event.
- WS, server→client: `buddy_archived`, `buddies_changed`, `channel_changed` (`shared/src/index.ts:1107-1113`). There are no Buddy-specific client→server messages.

**17 routes have no client caller:** `GET /:bid/capabilities/:ws`, `GET /api/buddies`, `GET builder/:cid/results`, `GET builder/:cid/result`, `GET approvals`, `PATCH /:bid/profile`, `POST /:bid/relationships`, `POST /:bid/skills`, `POST /:bid/delegations`, `PATCH delegations/:id`, `POST /:bid/review-requests`, `POST /:bid/reviews`, `PATCH reviews/:id`, `POST /:bid/projects`, `GET automations/health`, `PATCH work-items/:id`, and `GET /:bid/memory-reviews`. Seven of them write raw rows with no grant or revision check (B3).

---

## 4. Run and scheduling machinery

### 4.1 Lifecycle by trigger

**A. Owner chat.**
1. `processQueue` calls `needsForegroundChatRun` (`runtime.ts:2390`).
2. `enqueueBuddyChatRun` writes a `buddy_runs` row with `input_kind='chat'`, and a 1 s `setInterval` starts **per waiting conversation** (`runtime.ts:101`, `:2404-2407`).
3. `startBuddyChatRun` applies a per-Buddy FIFO limit of 5 (`chat-run-admission.ts:5-8`) and returns `admitted`, `waiting` or `gone`. `gone` rejoins after 1 s (`:2425-2431`).
4. The briefing is composed (`integration.ts:177-421`), and an audit row `buddy.turn_input` is written (5,120 rows so far).
5. Two tokens are issued (`issue` and `issueOwner`) and two stdio specs built (`runtime.ts:1140-1190`). Each turn costs 2 node spawns and 1 SQLite open (143 ms warm, 3.3 s cold).
6. The deadline timer is set (`:1108`).
7. On settle, `finishBuddyChatRun` runs (`server.ts:321-335`), then link status and the legacy `settleDelegation`, then the memory-review enqueue.
8. The reviewer uses the codex→muse→claude ladder, a third stdio helper and a 120 s timeout (`memory-review.ts:310`).

**B. Channel @mention.**
1. Owner `POST /lists/:lid/posts`.
2. `respondToOwnerPost` (`channel-responder.ts:770`) queues the reply per (thread, Buddy).
3. `openSeat` opens the seat, then `untilIdle` waits in a 250 ms loop (`:400-405`).
4. The prompt is sent with `origin:'owner_input'` (`:610-613`), so the turn goes through path A.
5. The server posts the reply as the Buddy (`:562`).
6. `considerThreadPost` (`:798`) runs the gate for the other Buddies in the thread. The chain caps at 3 Buddy posts (`:120`, `:809`). A `<yes>` from the gate triggers another `owner_input` turn.

**C. Automation.** Two executors, split by whether `'conversationId' in job_payload` (`scheduler.ts:388`, `:486`):
- **Thread schedule.** `runExecutor.enqueueSchedule` (`run-executor.ts:85-126`) pages through all of the Buddy's runs to find an outstanding one, then enqueues `input_kind='schedule'`. **0 such runs ever.** Its 6 definitions are all disabled.
- **Legacy.**
  1. `claimAutomationRun` takes a lease of `max_runtime + 60 s` (`scheduler.ts:396-400`).
  2. The automation conversation runs prompt, sequence or loop turns.
  3. `persistTerminalRun` and `pendingTerminals` record the result, and `nextRunAt` is computed.
  4. Startup recovery (`:448`) and a cancel state machine (`:323-373`) handle interruptions.

  51 runs have taken this path, and 1 of its 10 definitions is enabled (`0 22 * * *`). **It is the only automation path that has ever run.**

**D. Background `until_done` work or delegation.**
1. The MCP helper calls `/v1/messages`. The control server checks the token, `requireAllowed` and `requireAutomationOwner` (`control-server.ts:374-386`).
2. `prepareMessage` runs (`operations.ts:2021-2158`), then `dispatchService.send` on the keyed path:
   1. `previewCoordinatedMessage` computes the route.
   2. `resolveAssignmentConfig` resolves the provider/model.
   3. `prepareReturnConversation` creates or refreshes `buddy-return-<sha>` with a frozen 60 KB handoff (`dispatch-service.ts:408-480`).
   4. `sendCoordinatedMessage` runs inside `withBuddyRunAuthority`.
3. On the tick, `runExecutor.poll` runs the hold checks (membership, project gate via `inspectBuddyAdmission`, destination busy or missing), then claims the run (cap 8, `:221`).
4. `execute` builds the prompt by input kind and creates `buddy-run-<id>`. `runCoordinationMessage` passes the claim token to the helper as env (`runtime.ts:1156-1167`) and arms a deadline timer.
5. On finish, `finishBuddyRun` records the result. The package's `reconcileBackgroundWork`, **called every tick** (`run-executor.ts:139`), continues `until_done` work and enqueues a `message_reply` or `failure_notice` on the lead's return thread. The return prompt is built at `:453-462`, and interruption reports at `:464-499`.
6. The unkeyed dashboard send bypasses runs entirely (`dispatch-service.ts:273-401`).

### 4.2 Timers and pollers

| # | Timer | Period | Where | Work per firing |
|---|---|---|---|---|
| T1 | Scheduler tick | **1 s** (`server.ts:763`; the default is 30 s at `scheduler.ts:272`) | `scheduler.ts:284` | T2, `retryPendingTerminals`, `listDueAutomations`, legacy claims |
| T2 | run-executor poll | every T1 | `run-executor.ts:128-327` | stale-chat abandon (once), `retryUndeliveredInputs`, `reconcileBackgroundWork`, legacy cancel scan, paginated live-run scan, `recoverBuddyRuns`, `finishProjectHandoffs`, active re-check, **paginated queued scan** with `inspectBuddyAdmission` per candidate, claim |
| T3 | Chat admission poll | 1 s **per waiting conversation** | `runtime.ts:2406` | `startBuddyChatRun` |
| T4 | Admitted chat deadline | `TURN_MAX_RUNTIME_MS` | `runtime.ts:1108` | timeout |
| T5 | Provider watchdogs | max / bridge / idle | `runtime.ts:2905-2953` | kill |
| T6 | Background creation and run deadline | run.deadline | `run-executor.ts:564`, `:593` | reject / expire |
| T7 | Legacy automation deadlines | policy | `scheduler.ts:893`, `:967` | abort |
| T8 | Send wait loops | **100 ms**, ≤600 s | `dispatch-service.ts:239`, `:387` | poll SQLite |
| T9 | Seat idle wait | 250 ms loop | `channel-responder.ts:403` | wait |
| T10 | Reply gate | 90 s | `channel-reply-gate.ts:33` | stop |
| T11 | Memory review | 120 s | `memory-review.ts:310` | abort |
| T12 | Change-feed debounce | 250 ms | `server.ts:475-483` | broadcast |
| T13 | Capability TTL | 25 h, checked lazily | `control-server.ts:21` | — |
| T14 | Client backstop | ~30 s | `usePolledFetch` | refetch |

### 4.3 Leases, claims and recovery: where they overlap

| Mechanism | Overlaps with |
|---|---|
| `buddy_runs` claim_token and deadline, checked in `withBuddyRunAuthority` (`coordination.js:665-695`, allowed ops at `:690`) | The legacy automation lease; the control-server token (a second credential for the same turn) |
| `buddy_automation_runs` lease (`store.js:4537-4590`) and `withAutomationRunAuthority` (`:4854`) | Duplicates the `buddy_runs` concept |
| Delegation dispatch lease (`store.js:2728`) | Legacy; unreachable |
| Control-server tokens (3 kinds), revoked at turn end | Claim token; owner-input provenance |
| `BUDDY_AUTOMATION_CLAIM_TOKEN` env to the helper | Re-checked in-process |
| Startup sweeps: `abandonQueuedBuddyChatRuns` (`run-executor.ts:129`), `recoverInterruptedRuns` (`scheduler.ts:448`), reviewer running→interrupted (`memory-review.ts:192`) | Three separate recovery paths |
| Per-tick recovery: confirmed-drained, or deadline + 10 min (`run-executor.ts:20`, `:156-184`) | Package `recoverBuddyRuns` (`coordination.js:918`) |
| `retryUndeliveredInputs`, `reconcileBackgroundWork`, `finishProjectHandoffs` every 1 s | Should fire on the write that changes state |
| Per-conversation admission poll (T3) | The executor's queued scan (T2); both poll the same FIFO |

---

## 5. Client side

- **`components/buddies/*` TS/TSX:** 45 files, 10,669 lines. The largest are `ChannelBrowser.tsx` (979), `BuddyTeamConfiguration.tsx` (976), `channel-data.ts` (827), `BuddyMessages.tsx` (670), `ChannelComposer.tsx` (635), `BuddyCoordination.tsx` (474) and `sigil/render.ts` (467).
- **Other Buddy TS/TSX:** 3,299 lines, including `BuddiesDashboard.tsx` (560), `mobile/channels/ChannelsMobile.tsx` (700), `mobile/buddies/*` (1,169), `hooks/useBuddyData.ts` (264), atoms (394), and `BuddyReviewMessage.tsx` + `utils/buddy-review-message.ts` (268, legacy).
- **CSS:** 6,609 lines. **Client total: 20,577.**
- **Routes:** 52 method+path pairs (§3). URLs are also built dynamically in these places:
  - `BuddyCoordination.change()` (`:66`)
  - `BuddyMemoryWorkspace` (`:89`)
  - `buddy-direct-actions` (`:27`)
  - the channel-data feeds (`:134`, `:147`, `:163`)
- **WS:** handles `buddy_archived`, `buddies_changed` (invalidates every `/api/buddies*` and `buddy-*` key, `atoms/resources.ts:286`) and `channel_changed` (`atoms/actions.ts:776-781`). It sends none.
- **Client code that dies under the new model:**
  - `BuddyTeamConfiguration` (976) and `BuddyInactiveAccess` (106): grants and team configuration
  - review-marker UI (268)
  - legacy automation-run UI in both automations tabs
  - the approvals UI
  - the delegation, review, skills and work-items fields of the `/:bid` bundle
  - `BuddyCoordination` repair and memberships sections

  That is roughly 1.8–2.2k lines of TS/TSX.

---

## 6. Boundary analysis

### 6.1 Bugs and hazards found (verify live before acting)

- **B1. Channel follow-ups carry owner authority.**
  - `channel-responder.ts:610-613` sends every seat turn with `origin:'owner_input'`. That includes gated follow-ups triggered by *another Buddy's* post.
  - `runtime.ts:1140-1143` grants owner controls to any `owner_input` turn, and `:1180-1190` attaches `unleashd_owner` (`configure_team`, owner document writes).
  - Result: Buddy-authored thread text reaches a turn that holds owner authority. This contradicts CORE_DESIGN ("quoted messages … cannot" supply owner authority).
- **B2. In-process buses don't cross the MCP process boundary.** `operations.ts:669` (`notifyBuddiesChanged`) and `:1790` (`announceChannelPost`) run inside the `mcp-server.ts` child process (`:188`, `:527`). The listeners live only in the main server (`server.ts:476`, `:555`). Consequences:
  - Buddy MCP writes never push `buddies_changed`, so the client waits for its ~30 s backstop.
  - A Buddy's `post` never triggers `channel_changed` or the follow-up gate.

  Tests miss this because they run the operations in-process.
- **B3.** 7 owner routes that have no client caller write raw rows with no grant or revision check.
- **B4.** Every MCP read writes an audit row (`operations.ts:2460`). Examples: get_current_work 2,995, get_inbox 1,351, get_message 855, out of 23,453 total.
- **B5.** agent-cli writes muse MCP config under the legacy `mcp_servers` key with `transport:`. Muse 1.4.0 documents `mcpServers`, and when both keys are present it drops the member (`vendor/agent-cli-tool/src/muse-mcp-settings.ts:90,122`).

### 6.2 One rule enforced in several places

| Rule | Sites |
|---|---|
| Allowed ops per turn | Tool registration (`mcp-server.ts:263`); `executeOperation` (`operations.ts:677`); `prepareMessage` (`:2022`); control `requireAllowed` (`control-server.ts:375`); `assertCurrent` ×3 per send plus each wait iteration (`dispatch-service.ts:134`, `:201`, `:216`, `:231`); package `withBuddyRunAuthority` (`coordination.js:690`); `assertAutomationOperationAllowed` (`control-server.ts:397-408`, `operations.ts:2025`, `dispatch-service.ts:103`); reviewer skip (`memory-review.ts:259`). **At least 7 sites for `send`.** |
| Buddy belongs to workspace | `operations.ts:650-655`, `:2300`, `:2343`, `:2153`; observation; readiness; directory; package |
| Provider supports MCP | 9 call sites of `provider-capability.ts` |
| Model/effort validity | `team-access.ts:17-35`, `owner-team-configuration.ts:65-77`, `routes.ts:1118-1152`, Builder schemas |
| Owner scope | `owner-team-configuration.ts:50`, `owner-resources.ts:60`, control `:224-236`. Vacuous on HTTP. |
| Soul size | builder.ts, `integration.ts:20`, `routes.ts:1173` |
| Archived hidden | route guard (`routes.ts:250-258`), `visibleBuddyPayload`, WS `buddy_archived`, package `status==='active'` checks |
| Change notification | 3 doors (`change-feed.ts:11-17`), one broken (B2) |
| Stale-run recovery | §4.3: three sweeps plus the package's |

### 6.3 Logic in unleashd that belongs in the package, and vice versa

- **In unleashd, belongs in the package:**
  - authorization helpers (`operations.ts:2209-2403`, `SELF_SCHEDULE_LIMITS` at `:87`)
  - read projections (inbox at `:1208-1337`, `resources.ts`, observation, readiness, directory, work-query, channel-pages, `messageExecution`)
  - soul CAS
  - cron parsing (`scheduler.ts:72-233`)
  - hand-written store types (`contract.ts`, `coordination-store.ts`)

  Under the 11-primitive model most of these are **deleted**, not moved, because their tables go.
- **In the package, really unleashd's:**
  - conversation linkage (`conversation_links`, `child_conversation_id`, `return_policy.return_conversation_id`, `bindMessageConversation`, `finishConversationMessages`)
  - foreground chat admission (`run-capacity.js`)
  - `cli.js` (566 lines), a fallback that the briefing still advertises (`integration.ts:369`)

---

## 7. Transport check

| Harness | agent-cli today | CLI supports HTTP MCP? | Per-turn bearer | How |
|---|---|---|---|---|
| claude 2.1.282 | stdio only: `--strict-mcp-config --mcp-config '{mcpServers:{…command,args}}'` (`harnesses/claude.ts:31-56`) | yes, `type:"http"` | `headers` with `${VAR}` expansion from env. Expansion inside `--mcp-config` is inferred, not yet tested. | same flag |
| codex 0.156.1 | stdio only: `-c mcp_servers.<n>.command/args/env_vars` (`harnesses/codex.ts:17-36`) | yes, `url` means `streamable_http` (verified with `codex mcp get -c …`) | `bearer_token_env_var` or `env_http_headers`; inline `bearer_token` is rejected | `-c mcp_servers.<n>.url=…` |
| cursor-agent 2026.09.23 | stdio only: temp plugin `.mcp.json` + `--plugin-dir --approve-mcps` (`cursor-mcp-plugin.ts:37-58`) | yes, `{url, headers}`. Config is accepted; the plugin path is not verified end to end. | `${env:VAR}` in headers | plugin `.mcp.json` |
| muse 1.4.0 | stdio only: settings `mcp_servers` through `XDG_CONFIG_HOME` (`muse-mcp-settings.ts:84-145`) | yes, `type:"streamable-http"` | literal headers only, so the token sits in a 0600 temp file | settings file |

`McpServerSpec {command,args,cwd?,env?,required?}` (`vendor/agent-cli-tool/src/types.ts:68-80`) is **stdio-only**. The required-startup probe (`mcp-startup.ts:18-50`, `execute.ts:269-283`) spawns the command.

**What an in-process HTTP MCP endpoint needs:**

1. **agent-cli.** Turn `McpServerSpec` into a union: `{kind:'stdio',…} | {kind:'http', url, headers?, required?}`. Each encoder gets one HTTP handler:
   - claude: `type:'http'` with `${VAR}` headers
   - codex: `url` + `env_http_headers`
   - cursor: `{url, headers:${env:}}`, with `buildCursorMcpPluginDir` returning `{dir, env}`
   - muse: `type:'streamable-http'` with literal headers, plus fixing the key to `mcpServers`

   Also add an HTTP startup probe (`initialize` + `tools/list`), exports and live tests. Commit inside the submodule first.
2. **Server.** `@modelcontextprotocol/sdk` 1.30.0 ships `StreamableHTTPServerTransport`. Run it stateless (`sessionIdGenerator: undefined`), building one `McpServer` per request from the `TurnGrant` found by bearer token.
3. **Mount point.** Use a **separate loopback listener**; reuse the control-server's port. Do not mount on the main Express app: AGENTS.md requires the auth gate to stay first with no exemptions, and turn tokens are not the owner secret. The old server keeps the listener until its turns drain, and reload already waits for idle (`docs/architecture.md`, "Backend reload").
4. **Gains.** No per-turn node/tsx spawns. No second SQLite open, which removes 143 ms–3.3 s per turn. The event buses work again (B2). Three credentials become one. Four files are deleted outright, and the relay halves of two more.
5. **Risks.** A stall in the main event loop now stalls tool calls. The Cursor and Muse HTTP paths need a live test. On Muse the token lands on disk.

---

## 8. Lean server + MCP design against the 11-primitive model

### 8.1 How primitives map to today's concepts

| Primitive | Absorbs today | Server consequence |
|---|---|---|
| workspace | projects/workspaces + memberships (`background_enabled` moves to buddy×workspace, or a flag on `buddy` if single-home) | membership routes shrink to one PATCH |
| buddy | buddies, relationships (`manager_id` column; 30 manager / 7 consults / 1 reviews edges today), profile, archive, builder hires, access grants (2 rows), skills (4) | team-access, team-readiness, owner-team-configuration, direct-reports, builder and package `team-configuration.js` are all deleted. Authority becomes **owner \| self \| manager-of (transitive)** |
| task | owned_projects/buddy_projects + todos (JSON or child rows), evidence, execution state | work-query and the project-execution view collapse into `tasks` + `runs?taskId` |
| channel, post, post_read | lists, list posts (321), list reads, owner-channel-reads.json; task comments (962) become posts with `task_id` and no channel, or a per-task channel | owner-channel-reads.ts deleted; comments tools merge into `task_write` / `tasks` |
| doc, doc_revision | soul, memory heads/revisions, knowledge (1,451), notes | soul.ts, knowledge.ts, document-preview.ts, resources.ts deleted; one CAS path |
| schedule | automations (thread schedules only) | the legacy executor is deleted |
| run | buddy_runs + messages (600) + automation runs + delegations + reviews + checkpoints + approvals | **mail is a run**: `send` = enqueue a run for the recipient, `reply` = its outcome delivered by a return run on the parent's thread. Deletes dispatch-service's two paths, closure, message projections |
| event | audit events (writes only), memory-review receipts, turn_input | reviewer receipts move off disk; no audit on reads |

### 8.2 Modules (target ≈ 1,900 lines in `server/src/buddies`, down from 15,280)

| Module | Budget | Contents | Replaces |
|---|---|---|---|
| `grants.ts` | 100 | `TurnGrant {token, buddyId, workspaceId, conversationId, runId, claimToken, role: Worker\|Owner\|Reviewer}`; `issue`, `revoke`, `lookup`; loopback listener serving `/mcp` | control-server, mcp-config |
| `mcp.ts` | 400 | Tool table `{name, schema, handler(grant, input)}`; `toolsFor(role)`; stateless streamable-HTTP | mcp-server, owner-mcp, builder-mcp-server, memory-review-mcp/-tools, mcp-input-schema, owner-resources, resources, operations |
| `runner.ts` | 350 | The one executor over `run`. `RunInput = Chat \| Mention \| FollowUp \| Schedule \| Mail \| Work \| Return` (sum type), with `prepare` per variant returning `{conversationId, prompt, role}`; claim → turn → settle; one startup recovery; `wake()` on enqueue/settle plus a 5 s backstop tick | run-executor, dispatch-service, chat-run-admission, assignment-config, legacy scheduler, T3 per-conversation poll |
| `schedule.ts` | 80 | cron → next; due-scan enqueues `Schedule` runs | scheduler.ts |
| `briefing.ts` | 150 | `composeBriefing(buddy, workspace, docs, tasks)` | integration.ts |
| `channels.ts` | 500 | mention and gated follow-up responder, seats/slots, gate, media, text, DM/wake | 8 channel files |
| `routes.ts` | 250 | ~35 owner routes over the primitives (§8.4) | routes, channel-routes |
| `memory-review.ts` | 220 | queue, prompt, ladder; reviewer grant on the same endpoint; receipts as `event` rows | memory-review, memory-review-runner |
| `events.ts` | 30 | `BuddyEvent = Changed \| Posted{post}`, emitted by `mcp.ts`/`routes.ts`, now in-process | change-feed, channel-post-feed |

### 8.3 MCP tools (12) and role subsets

| Tool | Input sketch | Worker | Owner | Reviewer |
|---|---|---|---|---|
| `tasks` | `{taskId? , status?, buddyId?, cursor}` (includes comments when taskId is set) | ✓ | ✓ | – |
| `task_write` | `{taskId? , create?, changes?, todos?, comment?, key, baseRevision}` | ✓ own/reports | ✓ | – |
| `inbox` | `{}` → my open runs (mail in/out), unread channels | ✓ | ✓ | – |
| `send` | `{to, body, kind:'inform'\|'request'\|'work', taskId?, limits?, key}` | ✓ | ✓ | – |
| `runs` | `{action:'list'\|'get'\|'cancel'\|'retry', id?, filter?}` | ✓ own/caused | ✓ | – |
| `channel_read` | `{channelId\|postId\|query, before?, after?}` | ✓ | ✓ | – |
| `channel_post` | `{channelId\|newChannel, body, threadId?, taskId?, key}` | ✓ | ✓ | – |
| `doc_read` | `{buddyId?, kind:'soul'\|'working'\|'long_term'\|'note', query?}` | ✓ self | ✓ | ✓ self |
| `doc_write` | `{kind, content, baseRevision, reason, key}` (a note is an append) | ✓ self | ✓ | ✓ memory/notes only |
| `schedule` | `{action, id?, cron, prompt, conversationId}` | ✓ self within limits | ✓ | – |
| `team` | `{query?}` → directory and profiles | ✓ | ✓ | – |
| `team_admin` | `{action:'create'\|'update'\|'archive', buddyId?, fields}` | – | ✓ | – |

Authority lives in **one** package function, `authorize(actor, op, target)`, where `actor = Owner \| Buddy(id)`. Tool subsetting is presentation only. The server never re-checks allowed ops. The `claimToken` binding makes a background grant die with its run.

### 8.4 Owner HTTP routes kept

- `buddies`: GET list/overview, GET `:id`, PATCH `:id`, DELETE `:id`, POST `builder`
- `tasks`: GET, POST, PATCH `:id`, POST `:id/run`
- `runs`: GET, POST `:id/cancel|retry|reply`
- `docs`: GET/PUT `:bid/:kind`, POST `:bid/notes`, POST `:bid/recall`
- `schedules`: GET, POST, PATCH, DELETE, POST `:id/run`
- `channels` (8 existing routes) + `lists` GET/POST + 3 feeds

That is about 35 routes, down from about 75.

### 8.5 Delete outright

- **Files (26):** control-server, owner-mcp, memory-review-mcp, memory-review-tools, mcp-config, mcp-input-schema, builder-mcp-server, builder (all but the briefing), closure, direct-reports, contract, coordination-store, public-automation-run, visibility, resources, owner-resources, owner-team-configuration, team-access, team-readiness, team-observation, directory, work-query, soul, document-preview, owner-channel-reads, chat-run-admission.
- **Operations:** delegate, request_review, complete_*, submit_review, request_human_approval, checkpoint, hire/retire_direct_report, create_buddy/set_relationship as Buddy tools, get_capabilities, get_team_state, get_message/get_runs (folded into `runs`), the legacy public contract, and the soul/memory op names.
- **Execution paths:** the legacy automation executor, sequence/loop jobs, MEMORY_CAPTURE_PROMPT, the unkeyed send and its 100 ms waits (`wait` is dropped; read `inbox` later), the T3 poll, and `settleDelegation` on every conversation end.
- **Routes:** the 17 with no caller plus team-configuration, access, inactive-access, approvals, repair, and the legacy automation-run routes.
- **Client (~2k lines):** BuddyTeamConfiguration, BuddyInactiveAccess, review markers, approvals, legacy run history, and the dead parts of BuddyCoordination.

### 8.6 Open decisions for the owner

1. **Doc audiences.** Today's knowledge scopes are `owner_thread`, `project` and `workspace`, and they keep a private owner chat out of team turns (CORE_DESIGN "audience" rules). Options:
   - (a) add a `scope` column on `doc`, or
   - (b) drop audiences: one memory per Buddy, private-by-owner.

   (b) is leaner but changes the privacy contract.
2. **Task comments.** Model them as posts with `task_id` (no channel) or as `event` rows.
3. **Mail as runs.** There is no separate message table. Mail history is the run history, with body and outcome on the run. Confirm that "delivered but held" still reads acceptably as `run.status='queued', held_reason`.
4. **The one enabled legacy automation** (`0 22 * * *`): migrate it to a thread schedule or drop it.
5. **Muse as a Buddy harness** puts the token on disk. Accept that, or keep muse for the reviewer ladder only.
6. **Fix B1 before or independently of the rewrite:** seat turns need a non-owner origin.
