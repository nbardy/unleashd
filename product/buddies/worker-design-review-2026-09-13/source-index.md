# Source evidence index

Captured 2026-09-13T05:37:03.212887+00:00. Exact excerpts and full-source SHA-256 values are in [source-evidence.json](source-evidence.json). This is a source observation, not a claim about the running process.

Unleashd HEAD `1187a8b6660b95c0c60bd8fada105f015b98cc39` has substantial pre-existing uncommitted work. Installed package source commit `b70c0def1373034aeff56e409adb97d66ff6d7f7`; its source files match the vendored archive. The package source worktree at that commit is `/Users/nicholasbardy/git/.codex-worktrees/buddies/wave-sim-ceo-second-pass-20260913`. The main checkout at `/Users/nicholasbardy/git/buddies` is older and is not this baseline.

| ID | Source | Inspected anchors |
|---|---|---|
| D01 | [product/buddies/LATEST_HUMAN_DESIGN.md](/Users/nicholasbardy/git/unleashd/product/buddies/LATEST_HUMAN_DESIGN.md:56) | `## Workers` at 56, `## Explicitly unresolved` at 179 |
| D02 | [product/buddies/BUDGETS_AND_LIMITS.md](/Users/nicholasbardy/git/unleashd/product/buddies/BUDGETS_AND_LIMITS.md:75) | `## Frequent check-ins` at 75, `## Accounting proposal` at 209, `## Implemented behavior` at 247 |
| D03 | [product/buddies/final-designs-2026-09-13/07-workers-mail-and-prompt-successor.md](/Users/nicholasbardy/git/unleashd/product/buddies/final-designs-2026-09-13/07-workers-mail-and-prompt-successor.md:88) | `## Mail and Prompt` at 88, `Task ownership` at 81 |
| D04 | [product/buddies/final-designs-2026-09-13/08-check-ins-and-solo-sessions-successor.md](/Users/nicholasbardy/git/unleashd/product/buddies/final-designs-2026-09-13/08-check-ins-and-solo-sessions-successor.md:13) | `## Decision and rationale` at 13 |
| D05 | [product/buddies/PLANNING_SUB_BUDDIES.md](/Users/nicholasbardy/git/unleashd/product/buddies/PLANNING_SUB_BUDDIES.md:14) | `A direct report` at 14, `Two older tools` at 31 |
| D06 | [product/buddies/PLANNING_PRIMITIVES.md](/Users/nicholasbardy/git/unleashd/product/buddies/PLANNING_PRIMITIVES.md:19) | `## Send and reply` at 19, `Human chats` at 81 |
| P01 | [src/store.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/store.js:123) | `const CURRENT_SCHEMA_VERSION` at 123, `  getBuddyTeamState(` at 4113, `  retireDirectReport(` at 5415 |
| P02 | [src/coordination.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/coordination.js:114) | `  beginBuddyChatRun(` at 114, `  sendCoordinatedMessage(` at 132, `  inspectBuddyAdmission(` at 459, `  claimBuddyRun(` at 491, `  withBuddyRunAuthority(` at 522, `  finishBuddyRun(` at 585 |
| P03 | [src/background-work.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/background-work.js:24) | `export function normalizeBackgroundExecution` at 24, `getBackgroundWork(messageId)` at 48, `const waiting =` at 75, `const complete =` at 93, `reconcileBackgroundWork(messageId)` at 223 |
| P04 | [src/coordination-work.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/coordination-work.js:184) | `  createCoordinatedProject(` at 184, `  updateCoordinatedProject(` at 349, `accepted_by=` at 247 |
| P05 | [src/coordination-receipts.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/coordination-receipts.js:85) | `  checkpointBuddyRun(` at 85, `  recoverClosedBackgroundMessage(` at 295, `  retryUndeliveredInputs(` at 358 |
| P06 | [src/team-access.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/team-access.js:106) | `  createTeamBuddy(` at 106, `  setTeamRelationship(` at 126, `  buddyCapability(` at 79 |
| P07 | [src/knowledge.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/knowledge.js:33) | `function authorize(` at 33, `  replaceKnowledgeDocument(` at 99, `  listKnowledgeDocuments(` at 113, `  knowledgeAudienceRevision(` at 141 |
| P08 | [src/team-configuration.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/team-configuration.js:329) | `export const` at 329 |
| P09 | [src/coordination-approvals.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/coordination-approvals.js:17) | `export const` at 17, `consumeProjectApproval` at 42 |
| P10 | [src/mailbox.js](/Users/nicholasbardy/git/unleashd/server/node_modules/@nbardy/buddies/src/mailbox.js:19) | `  prepareMailEffect(` at 19, `  claimMailEffect(` at 38 |
| C01 | [shared/src/buddy-resources.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-resources.ts:3) | `BUDDY_RESOURCE_CONTRACT_VERSION` at 3, `export const SendBuddyResourceSchema` at 47, `export function buddySendOperation` at 80 |
| C02 | [shared/src/buddy-work.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-work.ts:4) | `export const BuddyBackgroundExecutionSchema` at 4, `export const BuddyWorkProjectSchema` at 66 |
| C03 | [shared/src/buddy-coordination.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-coordination.ts:2) | `export const BuddyRunSchema` at 2, `export const BuddyMembershipSettingsSchema` at 38 |
| C04 | [shared/src/buddy-observation.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-observation.ts:2) | `export const` at 2 |
| C05 | [shared/src/buddy-message.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-message.ts:3) | `export const` at 3 |
| C06 | [shared/src/buddy-team.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-team.ts:1) | `export const` at 1 |
| C07 | [shared/src/buddy-access.ts](/Users/nicholasbardy/git/unleashd/shared/src/buddy-access.ts:1) | `export const` at 1 |
| C08 | [shared/src/conversation-config.ts](/Users/nicholasbardy/git/unleashd/shared/src/conversation-config.ts:117) | `export const BuddyContextSchema` at 117, `export const ConversationConfigSchema` at 28 |
| C09 | [shared/src/conversation-kind.ts](/Users/nicholasbardy/git/unleashd/shared/src/conversation-kind.ts:20) | `export const ConversationKindSchema` at 20 |
| S01 | [server/src/buddies/mcp-server.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/mcp-server.ts:32) | `const TOOL_NAMES` at 32, `const replaced =` at 233, `const LEGACY_COMPLETION_TOOLS` at 124 |
| S02 | [server/src/buddies/operations.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/operations.ts:347) | `export const MESSAGE_BUDDY_OPERATIONS` at 347, `export const DEFAULT_DELEGATED_BUDDY_OPERATIONS` at 397, `export class BuddyOperationsService` at 490 |
| S03 | [server/src/buddies/run-executor.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/run-executor.ts:26) | `export class BuddyRunExecutor` at 26, `  private async execute(` at 263, `  private settleHumanThreadDelivery(` at 425 |
| S04 | [server/src/buddies/scheduler.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/scheduler.ts:211) | `export class BuddyScheduler` at 211 |
| S05 | [server/src/buddies/integration.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/integration.ts:132) | `export function createBuddiesIntegration` at 132, `function compactProject` at 34 |
| S06 | [server/src/buddies/knowledge.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/knowledge.ts:51) | `export function knowledgeAuthority` at 51, `export function recallKnowledge` at 151 |
| S07 | [server/src/buddies/resources.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/resources.ts:33) | `export function executeDocumentResource` at 33, `export function compactInbox` at 144 |
| S08 | [server/src/buddies/control-server.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/control-server.ts:72) | `export class BuddyControlServer` at 72, `issueMemoryReview` at 189 |
| S09 | [server/src/buddies/mcp-config.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/mcp-config.ts:85) | `export function buddyMcpServers` at 85 |
| S10 | [server/src/buddies/memory-review-runner.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/memory-review-runner.ts:14) | `export function createMemoryReviewRunner` at 14, `extraArgs:` at 45 |
| S11 | [server/src/buddies/memory-review.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/memory-review.ts:8) | `export const MEMORY_REVIEW_MODEL` at 8, `export const MEMORY_REVIEW_INSTRUCTIONS` at 45 |
| S12 | [server/src/conversations/creation-service.ts](/Users/nicholasbardy/git/unleashd/server/src/conversations/creation-service.ts:57) | `export function createConversationService` at 57 |
| S13 | [server/src/conversations/runtime.ts](/Users/nicholasbardy/git/unleashd/server/src/conversations/runtime.ts:528) | `runCoordinationMessage(` at 528, `beginBuddyChatRun` at 289, `expireCoordinationRun()` at 536 |
| S14 | [server/src/conversations/config-store.ts](/Users/nicholasbardy/git/unleashd/server/src/conversations/config-store.ts:109) | `export class ConversationConfigStore` at 109 |
| S15 | [server/src/buddies/owner-mcp.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/owner-mcp.ts:7) | `export function createOwnerTeamMcpServer` at 7 |
| S16 | [server/src/buddies/owner-resources.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/owner-resources.ts:14) | `export const OwnerResourceSchemas` at 14 |
| S17 | [server/src/buddies/routes.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/routes.ts:165) | `export function` at 165 |
| S18 | [server/src/buddies/team-observation.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/team-observation.ts:9) | `export function` at 9 |
| S19 | [server/src/buddies/team-readiness.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/team-readiness.ts:28) | `export function` at 28 |
| S20 | [server/src/buddies/visibility.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/visibility.ts:3) | `export function` at 3 |
| S21 | [server/src/buddies/coordination-store.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/coordination-store.ts:7) | `export interface CoordinationStore` at 7 |
| S22 | [server/src/buddies/contract.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/contract.ts:259) | `export interface BuddiesStorePort` at 259 |
| S23 | [server/src/server.ts](/Users/nicholasbardy/git/unleashd/server/src/server.ts:648) | `new BuddyRunExecutor` at 648, `new BuddyScheduler` at 644, `beginBuddyChatRun:` at 256 |
| S24 | [server/src/constants/timeouts.ts](/Users/nicholasbardy/git/unleashd/server/src/constants/timeouts.ts:42) | `TURN_MAX_RUNTIME_MS` at 42 |
| S25 | [server/src/buddies/owner-team-configuration.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/owner-team-configuration.ts:56) | `export function configureOwnerTeam` at 56 |
| S26 | [server/src/buddies/dispatch-service.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/dispatch-service.ts:63) | `export function createBuddyDispatchService` at 63 |
| H01 | [vendor/agent-cli-tool/src/session.ts](/Users/nicholasbardy/git/unleashd/vendor/agent-cli-tool/src/session.ts:11) | `export function prepareSession` at 11 |
| H02 | [vendor/agent-cli-tool/src/runtime-types.ts](/Users/nicholasbardy/git/unleashd/vendor/agent-cli-tool/src/runtime-types.ts:1) | `file start (no named anchor matched)` at 1 |
| H03 | [server/src/providers/index.ts](/Users/nicholasbardy/git/unleashd/server/src/providers/index.ts:1) | `file start (no named anchor matched)` at 1 |
| U01 | [client/src/components/buddies/BuddyDirectory.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyDirectory.tsx:11) | `export function BuddyDirectory` at 11 |
| U02 | [client/src/components/buddies/BuddyProjectExecution.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyProjectExecution.tsx:24) | `export function BuddyBackgroundProgress` at 24, `export function BuddyProjectExecution` at 58 |
| U03 | [client/src/components/buddies/BuddyMessages.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyMessages.tsx:14) | `export function BuddyMessages` at 14, `function BuddyMessageCard` at 58 |
| U04 | [client/src/components/buddies/BuddyTeamExecution.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyTeamExecution.tsx:12) | `export function BuddyTeamExecution` at 12 |
| U05 | [client/src/components/buddies/BuddyExecutionProfile.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyExecutionProfile.tsx:10) | `export function` at 10 |
| U06 | [client/src/components/buddies/BuddyBackgroundTasks.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyBackgroundTasks.tsx:8) | `export function` at 8 |
| U07 | [client/src/components/buddies/buddy-tabs.ts](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/buddy-tabs.ts:14) | `export const EMPLOYEE_TABS` at 14 |
| U08 | [client/src/mobile/buddies/BuddyDetailMobile.tsx](/Users/nicholasbardy/git/unleashd/client/src/mobile/buddies/BuddyDetailMobile.tsx:79) | `export function` at 79 |
| U09 | [client/src/components/buddies/BuddyMemoryWorkspace.tsx](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyMemoryWorkspace.tsx:7) | `export function` at 7 |
| U10 | [client/src/atoms/conversations.ts](/Users/nicholasbardy/git/unleashd/client/src/atoms/conversations.ts:268) | `chatConversationIdsAtom` at 268 |
| U11 | [client/src/atoms/actions.ts](/Users/nicholasbardy/git/unleashd/client/src/atoms/actions.ts:481) | `handleMessage` at 481 |
| U12 | [client/src/mobile/buddies/BuddyDetailWorkTab.tsx](/Users/nicholasbardy/git/unleashd/client/src/mobile/buddies/BuddyDetailWorkTab.tsx:17) | `export function` at 17 |
| U13 | [client/src/components/buddies/types.ts](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/types.ts:65) | `export interface BuddyProject` at 65 |
| U14 | [client/src/components/buddies/buddies-shaping.ts](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/buddies-shaping.ts:32) | `export function` at 32 |
| V01 | [tools/vendor-buddies.mjs](/Users/nicholasbardy/git/unleashd/tools/vendor-buddies.mjs:123) | `const sourceCommit` at 123, `const firstHash` at 161 |
| V02 | [vendor/nbardy-buddies-0.1.0.provenance.json](/Users/nicholasbardy/git/unleashd/vendor/nbardy-buddies-0.1.0.provenance.json:6) | `sourceCommit` at 6 |

Normal resource catalog: `checkpoint`, `create_buddy`, `get_automations`, `get_capabilities`, `get_current_work`, `get_document`, `get_inbox`, `get_message`, `get_profile`, `get_runs`, `get_team_state`, `list_buddies`, `new_project`, `recall`, `remember_note`, `reply`, `retire_direct_report`, `retry_run`, `send`, `set_automation`, `set_relationship`, `stop`, `update_document`, `update_profile`, `update_project`.

Count: **25** before further per-turn restrictions. Legacy completion helpers appear only for compatible restricted policies; owner and Builder MCP servers are separate.

Additional sources are pinned in [source-addendum.json](source-addendum.json).

| ID | Source | Anchor |
|---|---|---|
| S27 | [server/src/buddies/builder-mcp-server.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/builder-mcp-server.ts:141) | `name: 'get_soul'` |
| S28 | [server/src/conversations/buddy-creation-service.ts](/Users/nicholasbardy/git/unleashd/server/src/conversations/buddy-creation-service.ts:95) | `export function createBuddyCreationService` |
| S29 | [server/src/buddies/direct-reports.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/direct-reports.ts:6) | `export` |
| S30 | [server/src/buddies/directory.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/directory.ts:26) | `export function listBuddyContacts` |
| S31 | [server/src/lifecycle/session-loader.ts](/Users/nicholasbardy/git/unleashd/server/src/lifecycle/session-loader.ts:79) | `export function createSessionLoader` |
| C10 | [shared/src/index.ts](/Users/nicholasbardy/git/unleashd/shared/src/index.ts:604) | `export function providerSupportsFork` |
| C11 | [shared/src/provider-catalog.ts](/Users/nicholasbardy/git/unleashd/shared/src/provider-catalog.ts:56) | `export const ProviderCatalogEntrySchema` |
| U15 | [client/src/atoms/buddy-background.ts](/Users/nicholasbardy/git/unleashd/client/src/atoms/buddy-background.ts:5) | `export const buddyBackgroundConversationsAtomFamily` |
| U16 | [client/src/atoms/conversations.ts](/Users/nicholasbardy/git/unleashd/client/src/atoms/conversations.ts:285) | `export const workersByProjectAtom` |
