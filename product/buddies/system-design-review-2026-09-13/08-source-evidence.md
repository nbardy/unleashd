# Dated source evidence

Captured: 2026-09-13T03:59:42.678049+00:00. Repository HEAD: `1187a8b6660b95c0c60bd8fada105f015b98cc39`.

This is a preserved evidence appendix for the September 13 design review. Local files may contain uncommitted work; HEAD alone does not identify them. Each record pins the complete inspected file with SHA-256 and preserves selected literal excerpts. The manifest contains the same excerpts in machine-readable form. Neither this appendix nor old implementation reports establishes current production behavior.

Native read receipts and user-supplied handoff provenance are described in [the intake](01-handoff-inventory-and-history.md). Current operational state remains in native projects and receipts.

Archive SHA-256: `76fda9860849fe0e95d2655426c74dbe440718dc2691342e1e192dcc26be43cd`. Read-only byte comparison: 26 installed package files compared, all match = True. This proves disk package parity at capture, not the loaded backend build.

## Source index

| ID | Source | SHA-256 |
|---|---|---|
| [S01](#s01) | `agent_notes/2026-09-13-foreground-buddy-capacity-handoff.md` | `6d41c9877f77efc20413ce45f8d114100cfa5a38c742c89e6edd20e9f0125b61` |
| [S02](#s02) | `product/buddies/PLANNING_PRIMITIVES.md` | `ac8e529d3fbc4dd79e94ad83295daf4539b290437056d39d755d9ed4a3279fe6` |
| [S03](#s03) | `product/buddies/PLANNING_SUB_BUDDIES.md` | `d099ca8afc581cec6df08c2e44f7bf090cca5246c406251158bf51f446d661c2` |
| [S04](#s04) | `product/buddies/PLANNING_MEMORY.md` | `bd0cd6c686d808df209130c54947d63557bad8d4c11f0fc3937d652fa33775df` |
| [S05](#s05) | `product/buddies/AUTOMATION_OWNERSHIP.md` | `7a76863f9c30a9d663914a6f8fa25fa760d9eb7b2c64c72b61320ceafba9e588` |
| [S06](#s06) | `product/buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md` | `8a5206160d837282fc285fff8198d321a756c8bdb41a8e99eaa65686b290391d` |
| [S07](#s07) | `product/buddies/TEAM_OPERATOR_GUIDE.md` | `d2d8aacc1c5277407fac14caf7ac42a1228bf9c3e301e4126d67d8b77856b663` |
| [S08](#s08) | `docs/architecture.md` | `7538b209cc3319e205a5abeb5d65f069bde85148ac441106be34d6f54e11fa6c` |
| [S09](#s09) | `docs/pass-through-pattern.md` | `652c440178316717944859bca3f0a079744e28fca5f3bf5b877b6afbc9c1cf2b` |
| [S10](#s10) | `agent_notes/2026-08-19_sub-buddies-design.md` | `18a10435f97b04569e8c6cc5f220a4c866968e48737c2aeed919e912dcbd334e` |
| [S11](#s11) | `agent_notes/2026-08-20_direct-reports-handoff.md` | `81fdc2263d5a540014c933d1693855e6138dfff6bfb795a24a9bc3f41b0c5dfa` |
| [S12](#s12) | `agent_notes/2026-08-21_buddy-automations-reference.md` | `989311593c3aaf9b803f6d77bfe1283446f43ad6eab343433893ed0a8347cd4c` |
| [S13](#s13) | `agent_notes/2026-08-24_automation-execution-ownership-design.md` | `e02d4eee66fb6ff03d242c6a096eeecb0bf03937bcad705b20300241c3a1673a` |
| [S14](#s14) | `product/buddies/DESIGN_BUDDY_COORDINATION.md` | `de92f6f8160dda1186ee68aeefa562061f7d44337dbd6af28e5ca395b26cc33e` |
| [S15](#s15) | `product/buddies/REDESIGN_01_TYPED_RESOURCES.md` | `4f87315b6345d9c0f91df4cc53886cd3fff71814addd109ed56e84b695a854dd` |
| [S16](#s16) | `agent_notes/2026-09-13_background-execution-before-operator-guide.md` | `238a16f30dbf6bfa49cdaf38ca8b14544529d8cada79b74bb82aac58cf5bb965` |
| [S17](#s17) | `product/buddies/coordination-reliability-2026-09-12/04-decision.md` | `abefc2d3f0a7292bb16b671ff902675368c8931eda8c5517957d4de6b9db7731` |
| [S18](#s18) | `product/buddies/coordination-reliability-2026-09-12/05-closed-timeout-successor.md` | `f0814de549c11ca1dbc3be2251dd91d84af299740627fb67ff82df7443d87120` |
| [S19](#s19) | `product/buddies/wave-sim-second-pass-2026-09-13/03-second-pass-decision.md` | `bd3c8d6884e22f110fa5658e21cfaaaa00fd2928d2999e9ca1d4e90c1ed16106` |
| [S20](#s20) | `product/buddies/IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md` | `311152c5aa3823a9c60af8412a89455fee47967f6100fbfd12b2fb408de98ba6` |
| [S21](#s21) | `docs/incident-2026-09-10-buddy-chat-timeout.md` | `48f41487d93ef8a0d6713e9e0cf23ca07c1fa87e0576e8935ac43204daed761b` |
| [S22](#s22) | `docs/incident-2026-09-12-buddy-history-loss.md` | `e02ed4c80d3dd074ef9bbd2346127987b4200362d91e03788fbc2fbdd1ef2194` |
| [S23](#s23) | `shared/src/buddy-resources.ts` | `54411920c60eb9dd74c52fd313b731c019500e946531eb738c1bb5e015588789` |
| [S24](#s24) | `shared/src/buddy-work.ts` | `c8f6bd17d852776d1358173d7f27218bd2d95f0086f6661365e0f59ec51a419a` |
| [S25](#s25) | `node_modules/@nbardy/buddies/src/coordination.js` | `474608ada3e5f7fb62b15386ef5a5c068ce036f7a2a3a10e63e87d9d5d908e2a` |
| [S26](#s26) | `node_modules/@nbardy/buddies/src/coordination-work.js` | `cca05dae7bbd597f05cccdf3325e973fba0379cf9fd87b3447054a207ce83b3c` |
| [S27](#s27) | `node_modules/@nbardy/buddies/src/background-work.js` | `8837de54fc1078d7a86b53d5e6a8571770d0adcde487f435ebe3c29606df1f4f` |
| [S28](#s28) | `server/src/conversations/runtime.ts` | `54386f62e2127833c3e48f7fa5158cde498bac7fe0c3d098a2429376a879eb35` |
| [S29](#s29) | `server/src/buddies/integration.ts` | `e93867fa7d9c5eaca4fd05570b6673fe9675380e1927b958c8b1a7d888272a15` |
| [S30](#s30) | `server/src/conversations/creation-service.ts` | `0c1835d58f7028efcbec3ab59d559be10ca5433f1926f5b4bfcaa47a7d98fd3f` |
| [S31](#s31) | `vendor/nbardy-buddies-0.1.0.provenance.json` | `36b3da72036a5c0fdddf4ef71e2a5328a653ed7f3beff34002fb0b62a838b904` |
| [S32](#s32) | `tools/vendor-buddies.mjs` | `5df27390e9d39d0ce2fb421db87ea095368988e89dd3b867cac64aa7a2222cf6` |
| [S33](#s33) | `server/test/conversation-runtime.test.ts` | `0b2bf2affcb6c68c4328778885cfe981facd029f9d34e0a41d056299116520d0` |
| [S34](#s34) | `server/src/buddies/run-executor.ts` | `40d4919568b280cfb605b7b8e44e6d9ba453add91babde10ef7b0e015f98bd89` |
| [S35](#s35) | `product/buddies/IMPLEMENTATION_READINESS_PRIVACY_2026-09-12.md` | `8e305a26a36faf648c860c7cc714d973c5715da80b9acb77b32e19e45f4c3e39` |
| [S36](#s36) | `agent_notes/20260910T080351Z_01M255GCKDGHAXVBF6MBY40Z43_owner-selects-independent-luna-review-after-ever_buddies-development-lead_fe6ef8cd.md` | `f51cbde2fd34b5db30fdbd7e0cd9fc943e016131a6380dd7d63d91055d9d528d` |

## S01

Source: `agent_notes/2026-09-13-foreground-buddy-capacity-handoff.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `6d41c9877f77efc20413ce45f8d114100cfa5a38c742c89e6edd20e9f0125b61`  
Working-tree status: `?? agent_notes/2026-09-13-foreground-buddy-capacity-handoff.md`

Preserved lines 1–235:

````text
# Foreground Buddy conversations blocked by background capacity — engineering handoff

Date: 2026-09-13  
Status: diagnosed; no product fix implemented  
Owner direction: execution limits may throttle autonomous/background work, but must never
prevent a foreground owner conversation from starting.

## Outcome

This was not a maximum-conversation-count failure. Foreground Buddy chats and autonomous Buddy
work currently share the same execution-capacity counters. Buddies Development Lead has
`max_active_runs = 2` in the unleashd workspace. When two runs were active, a new owner message
was rejected by the coordination store, returned to the app queue, and retried once per second.

The retry path creates a misleading user experience:

- the submitted user message briefly appears and is then removed;
- the conversation falls back to the title `New conversation`;
- the sidebar and header say only `queued`, without the capacity reason;
- every conversation retries independently, so a newer conversation can take a newly freed slot
  before an older queued conversation;
- each retry is recorded as a new `starting -> failed -> queued` attempt, producing an
  observability and write storm while no provider process starts.

The capacity guard is useful for background work. Applying it to direct owner conversations, and
representing capacity waiting through a one-second failure loop, is the defect.

## Live incident evidence

The affected workspace and Buddy were:

- workspace: `project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c` (`unleashd`)
- Buddy: `buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd` (Buddies Development Lead)
- configured membership limit: `max_active_runs = 2`
- configured pending limit: `max_pending_runs = 100`

Timeline, in UTC:

1. `f9eaa5f6-82e2-491c-8a88-95cb7c407a5e` was running from `03:18:15.529`.
2. `2882b4ce-4200-43e7-b3f5-5d9f3f922bb9` was running from `03:25:52.242`.
3. Conversation `89d40447-9d68-4b53-9688-67c154dbfae2` was created at
   `03:28:15.562`. Its owner message entered the app queue while both execution slots were full.
4. The turn-attempt ledger shows this conversation retrying every second. At `03:36:16.049` it
   had produced 458 attempt records and 457 terminal `spawn_failed` records without ever reaching
   `running`.
5. Conversation `fd2b4690-a228-47d4-82fd-8e81b6573098` was created at
   `03:28:31.568`.
6. The older active run ended at `03:29:34.750`. The newer `fd2b4690...` owner message claimed
   the freed slot at `03:29:35.278`, just before the independently timed retry of `89d40447...`.
   This demonstrates non-FIFO admission.
7. `fd2b4690...` completed successfully at `03:33:48.601`; it was not rejected by a conversation
   count limit.

The evidence sources were the live `buddy_runs`, `buddy_projects`, and `conversation_links`
records in the configured Buddies store, plus
`~/.agent-viewer/observability/turn-attempts.jsonl{,.1}`. These are observations from the running
development environment, not fixture-only results.

## Root cause

### 1. Foreground and background runs share one capacity pool

The installed Buddies package's `coordinationActiveCounts()` combines active `buddy_runs` and
active `buddy_automation_runs` without retaining foreground/background classification. Admission
then rejects when either the global active count reaches 8 or the Buddy count reaches the
membership's `max_active_runs`.

Relevant installed-package seams:

- `node_modules/.../@nbardy/buddies/src/coordination.js:109-130`
- `node_modules/.../@nbardy/buddies/src/coordination.js:461-489`
- `node_modules/.../@nbardy/buddies/src/coordination-work.js:25-35`

`beginBuddyChatRun()` is explicitly the foreground owner-chat path, but it enqueues and claims
through the same admission policy. A failed claim throws the untyped message
`Conversation execution slot is unavailable`.

### 2. Unleashd converts capacity rejection into a polling loop

`server/src/conversations/runtime.ts:1121-1136` recognizes that error by its message. It removes
the just-added user message, publishes the now-empty conversation, and throws a local
`BuddyChatCapacityUnavailableError`.

`server/src/conversations/runtime.ts:2946-3010` restores the queue item to `pending`, creates a
fresh attempt record, and schedules another `processQueue()` call after 1,000 ms. Each conversation
owns its own retry timer. There is no central waiter or FIFO order.

The existing test at `server/test/conversation-runtime.test.ts:461-518` codifies this behavior as
the expected foreground policy: first admission fails, one-second timer fires, and the provider
then starts. That test protects the behavior that now needs to change.

### 3. The client exposes state, not cause

- `client/src/components/Chat.tsx:222-227` derives pending/sending state from `Conversation.queue`.
- `client/src/components/Chat.tsx:732-745` renders only `N queued`.
- `client/src/components/Sidebar.tsx` labels any non-empty queue as
  `Conversation has queued work`.

The client cannot distinguish same-conversation sequencing from capacity denial. Because the
server removes the submitted user message on capacity rejection, the thread visually appears to
bounce back to an empty conversation.

### 4. The 50-conversation value is unrelated

`CHAT_INBOX_LIMIT = 50` in `client/src/atoms/conversations.ts:214-270` caps only the recent chat IDs
rendered in the inbox. It does not reject conversation creation or turn execution.

## Required product semantics

1. A direct owner message in a normal foreground Buddy conversation is admitted immediately when
   that conversation is otherwise idle.
2. `max_active_runs`, the global active-run cap, hourly budgets, background enablement, and
   background pause state govern autonomous/background work. They do not consume or deny the
   owner's foreground-chat entitlement.
3. Same-conversation serialization remains intact. Sending another message to a conversation
   that already has an active turn may queue behind that turn; this is different from waiting for
   a Buddy-wide background slot.
4. If the host needs a true process-safety ceiling, foreground capacity must be modeled separately
   and explicitly. The system should reserve foreground headroom or let foreground work exceed a
   soft background ceiling. It must not silently convert an owner message into an indefinite
   generic queue.
5. Owner input remains visible and durable from submission onward. Admission transitions must
   never make the message disappear.
6. Waiting work must have one durable, reasoned state and event-driven wake-up. It must not emit a
   failed attempt every second.
7. Admission ordering must be deterministic. Older accepted work must not lose slots to newer
   conversations because their local timers happen to fire first.

## Recommended implementation

### Package: separate foreground entitlement from background limits

Change the authoritative source package in `/Users/nicholasbardy/git/buddies`, not the installed
copy under `node_modules`.

Recommended policy:

- retain `max_active_runs` as the autonomous/background concurrency control;
- exclude runs with `policy.foreground === true` from the per-Buddy background count;
- exclude foreground runs from the global background cap of 8;
- retain `conversation_busy` so one conversation cannot run two turns concurrently;
- keep inactive-Buddy, workspace-membership, scope, and authority checks for foreground work;
- give admission failures typed codes/results rather than matching an English error string.

If a separate hard foreground safety limit is required, introduce it as a host-level operational
limit with reserved foreground capacity. Do not reuse the employee's background-work budget.

### Server: remove the foreground capacity retry loop

Once foreground admission no longer shares the background cap:

- delete or narrow `BuddyChatCapacityUnavailableError` handling;
- do not pop the owner message from `this.messages` after an accepted submission;
- do not create a new attempt and timer every second;
- keep the existing queue for messages waiting behind an active turn in the same conversation;
- if a typed, genuinely transient host-capacity result remains, preserve one queued attempt and
  wake it from a central capacity-release signal rather than polling.

### Client: make any legitimate waiting state explicit

For same-conversation queuing, render language such as `Waiting for this turn to finish` rather
than the context-free `queued`. If a rare host-level wait remains, carry a structured queue reason
over the WebSocket contract and render the exact reason. Do not infer causes from `queue.length`.

The visible user message or queued card must stay in the thread while waiting. A conversation
with accepted owner input must not revert to an empty `New conversation` presentation.

### Packaging

After package changes and package-level tests pass:

1. Commit the clean `/Users/nicholasbardy/git/buddies` source change.
2. Run `pnpm vendor:buddies` from this repository. The vendoring script requires a clean source
   commit and writes the reproducible archive plus provenance.
3. Refresh the workspace install/lockfile through the repository's normal pnpm flow so runtime
   tests exercise the new archive rather than a stale installed package.
4. Preserve unrelated changes in this already-dirty worktree.

## Regression plan

Prefer one integration test across the real package/runtime boundary, supported by focused unit
coverage.

Package tests:

- with two active background runs for one Buddy and `max_active_runs = 2`, a foreground owner chat
  claims and starts immediately;
- with eight active background/automation runs globally, a foreground owner chat still starts;
- a third background run remains queued at the configured limit;
- foreground work still fails closed for inactive identity, missing membership, invalid scope, or
  an already-busy destination conversation;
- capacity inspection reports background saturation without reporting the foreground owner chat
  as blocked.

Server integration test:

- construct a real Buddies store, membership limit of 2, two held background runs, a real
  `Conversation` runtime with a fixture provider, and an owner foreground message;
- assert the foreground provider starts on the first admission attempt;
- assert the user message stays visible;
- assert the conversation queue does not retain a capacity-wait item;
- assert exactly one attempt reaches `running` and no one-second retry timer or repeated
  `spawn_failed` record is produced.

Runtime/client regressions:

- replace the current test named
  `foreground Buddy capacity waits in the queue and starts without another send`; it encodes the
  rejected policy;
- preserve tests for same-conversation queue ordering and interruption;
- render a stable queued user card/message while legitimately waiting behind the same active turn;
- verify desktop and mobile use the same structured waiting reason;
- run `pnpm test:server`, `pnpm test:client`, `pnpm -C client exec tsc -b`, and
  `bash tools/check-client-invariants.sh`.

## Acceptance criteria

- Starting a foreground owner conversation never waits for `max_active_runs` or the global
  background cap.
- Background runs still obey their configured per-Buddy and global limits.
- A submitted foreground message never disappears or causes the conversation to revert to
  `New conversation`.
- No capacity condition produces repeated one-second failed attempts.
- No newer foreground or background request can leapfrog an older accepted waiter through timer
  timing.
- The UI states why any message is waiting and distinguishes same-thread sequencing from
  autonomous-work throttling.
- The packaged Buddies provenance points to the tested source commit, and the running application
  is verified against that package after a safe dev-runtime reload.

## Non-actions in this handoff

No source behavior, package archive, database setting, active run, queue item, Buddy profile,
schedule, or relationship was changed. In particular, `max_active_runs` was not raised as a
workaround; that would preserve the incorrect coupling and only postpone recurrence.
````


## S02

Source: `product/buddies/PLANNING_PRIMITIVES.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `ac8e529d3fbc4dd79e94ad83295daf4539b290437056d39d755d9ed4a3279fe6`  
Working-tree status: `M product/buddies/PLANNING_PRIMITIVES.md`

Preserved lines 1–155:

````text
# Buddy coordination primitives

Current contract · updated 2026-09-13

For the full setup-to-result workflow, start with the
[team operator guide](TEAM_OPERATOR_GUIDE.md).

| Capability | Implementation |
|---|---|
| Native send variants and revisioned work resources | `shared/src/buddy-resources.ts`, `buddy-work.ts` |
| Durable requests, returns, claims and bounded work chains | Package coordination/background-work store |
| Shared creation and input admission | `creation-service.ts`, `run-executor.ts`, `dispatch-service.ts` |
| MCP and owner HTTP access | `mcp-server.ts`, `owner-resources.ts`, `routes.ts` |
| Inbox, replies and project execution in both shells | Shared Buddy components and mobile shell |
| Scheduling and cancellation | [Ownership contract](AUTOMATION_OWNERSHIP.md) |

Buddy messages use the local durable message store. They do not require an
external email account. External mailbox integration is a separate adapter and
authorized effect scope.

## Send and reply

Native `send` requires `key`, `to`, `purpose`, `body` and `delivery`. Optional outer
fields are `evidence`, `workspaceId` and `notBefore`. The sender identity, source
run and original callback conversation come from trusted host context. The stable
key makes retries idempotent; retry the same intended send with the same key.

`delivery` selects exactly one variant:

| Kind | Fields inside delivery | Behavior |
|---|---|---|
| `inform` | optional `projectId`, `inReplyTo` | Information with no reply obligation |
| `request` | optional `projectId`, `continueFrom` | Request one durable response |
| `work` | required `projectId`; optional `maxRuns`, `maxDurationSeconds` | Continue recipient-owned work until evidence-backed completion or a terminal disposition |

```json
{"key":"finding-1","to":"buddy-recipient","purpose":"inform","body":"The export fixture passes.","evidence":["test:export"],"delivery":{"kind":"inform"}}
```

```json
{"key":"review-1","to":"buddy-recipient","purpose":"review","body":"Review the export and return evidence.","delivery":{"kind":"request"}}
```

```json
{"key":"export-work-1","to":"buddy-recipient","purpose":"implementation","body":"Complete the project criteria and record the evidence.","delivery":{"kind":"work","projectId":"buddy-project-recipient-owned","maxRuns":3,"maxDurationSeconds":900}}
```

Create recipient-owned work first with `new_project`, a stable key, concrete
`definitionOfDone` and bounded todos. Then send its project ID with `delivery.kind`
`work`. A reporting line authorizes ordinary supervision; a project reference
alone does not grant dispatch, membership or private-content access. Self-owned
background work uses `to: "self"` and the same work variant.

Work defaults to 20 runs and 3,600 seconds, with schema maxima of 100 runs and
86,400 seconds. Actual run admission, immutable operation policy and runtime
limits still apply. These fields do not measure or grant spending, external
actions or training.

`continueFrom` identifies an earlier message from the same sender to the same
recipient in that workspace, retaining its destination. `inReplyTo` is an
informational return from the original recipient to the original sender in the
source workspace. These are message IDs, not caller-selected conversation IDs.
Stopped roots and missing destinations require explicit inspection and repair;
repeating a send does not authorize revival of stopped work.

`reply({messageId, outcome, body, evidence})` records the addressed recipient's
response. Purposes and outcomes are open strings. Only the owner can answer
owner-directed messages. Sending an approval request does not grant permission;
the exact action requires an explicit owner response.

## Admission, continuation and completion

A successful send returns durable message and execution receipts. It does not
prove that a provider has started. Use `get_message`, `get_runs` and
`get_capabilities` to inspect actual admission, blockers, acknowledgment and
completion evidence. Readiness settings are prerequisites, not a process
heartbeat. Message receipts are constrained by the current conversation audience;
participating in private mail under the same identity does not publish it to an
unrelated team turn.

Fresh recipient work uses inert shared conversation creation and linking, then
claimed input admission. Creation itself does not execute a prompt. Requests
with valid background continuation routes reuse their established destinations.
Human chats (`placement: default`) are owner control points. Replies, failure
notices and informational returns addressed there remain in the durable mailbox;
delivery settles as `mailbox_only` without provider admission or transcript
injection. Work requests and schedules require a background destination. The
runtime enforces this boundary again immediately before automated input.
The routed Mailbox tab (`/buddies/:buddyId/mailbox`) exposes messages, replies,
evidence and owner decisions in both shells. Source
restrictions narrow the host's `MESSAGE_BUDDY_OPERATIONS` policy. Team tools can
be present while particular actions remain denied: creation requires staffing
authority, attaching existing identities requires relationship authority, and
private documents have separate scope checks. There is no hiring quota or blanket
recipient hiring prohibition.

For managed work, the recipient reads `get_current_work` and `get_inbox` on each
attempt and accepts work with a revision-checked `update_project`. Record progress,
blockers and evidence on the project and its todos. Every non-cancelled todo must
be done with evidence before the project is complete. A manual final reply cannot
complete unfinished managed work; the runtime returns the final disposition to
the original requester.

The native send call returns a receipt without synchronously waiting for the
recipient to finish. Outstanding child requests suspend a managed parent work
chain; replies allow the existing runtime to reconcile and continue it within the
original limits. Do not schedule a parallel self-successor for managed work.
Failure, cancellation, a terminal blocker or exhausted limits remain visible;
late replies do not revive terminal runs. `stop` fences authority and drains owned
provider work. `retry_run` requires inspecting effects, an explicit reason and a
stable key.

A persistent Buddy has its own identity and durable work. Harness sub-agents are
turn-scoped provider capabilities under the parent's identity. They introduce no
additional employee type or public coordination operation.

## Observation and recovery

Native `get_inbox({limit,cursor})` returns compact summaries in the current audience.
Follow `nextCursor`; expand an exact body/evidence with `get_message({messageId})`
and project criteria with `get_current_work({projectId})`. Previews are bounded,
not complete work instructions. Audience filtering precedes message pagination.
The legacy full service response remains available to existing HTTP consumers.

`get_team_state` provides authorized execution metadata, current project snapshots,
published checkpoints, effective limits and recovery controllers. Optional `runId`,
`rootMessageId`, `targetBuddyId`, `offset` and `limit` narrow the page. Checkpoint
and delivery histories have independent offsets/limits and next-page fields.
Structured deliveries retain run IDs, admission timestamps and retry ancestry.
Recorded execution configuration takes precedence over policy estimates; a missing
historical snapshot remains explicit. Neither delivery completion nor a current
project's acceptance proves consumer review of a particular artifact/version.

Save files before `checkpoint({key,artifacts,effects,resume,visibility})`. A
team-visible checkpoint shares its complete payload with authorized observers;
it attests saved references, not current file existence. Recover only after
inspecting effects, using `retry_run({runId,key,reason,checkpointId?})`. A historical
closed timeout can create one linked successor within the original envelope;
its old failure stays recorded. Controller identity is not tied to the old
conversation, but current audience, membership, supervision and stopped/deleted
fences still apply. See the [CEO workflow simulation](wave-sim-second-pass-2026-09-13/02-workflow-simulation.md)
and [second-pass decision](wave-sim-second-pass-2026-09-13/03-second-pass-decision.md).

## Historical contract

The earlier synchronous `wait` / `timeoutSeconds`, `expectsReply` and `execution`
arguments are compatibility/service inputs, not fields in the current native
send schema. Do not copy those examples into native MCP calls. The September 8
version of this document is preserved at commit
`4c6835b53190a64650c8948ac67f7fd6badbf1ed`; it stated “Waiting is part of send” and
incorrectly described all recipient hiring as excluded. The current typed
resource contract supersedes those claims without deleting the earlier design
history. See the [historical wait design](../../agent_notes/2026-08-21_primitives-and-the-wait-design.md)
and the [September 12 note/contract repair successor](IMPLEMENTATION_NOTE_CONTRACT_2026-09-12.md)
for the rationale.
````


## S03

Source: `product/buddies/PLANNING_SUB_BUDDIES.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `d099ca8afc581cec6df08c2e44f7bf090cca5246c406251158bf51f446d661c2`  
Working-tree status: `M product/buddies/PLANNING_SUB_BUDDIES.md`

Preserved lines 1–72:

````text
# Direct reports

Current contract · updated 2026-09-13. Start with the
[team operator guide](TEAM_OPERATOR_GUIDE.md) for setup, assignment and returns.
The [coordination contract](PLANNING_PRIMITIVES.md) defines native delivery limits.

| Capability | Implementation |
|---|---|
| Creation, grants, relationships, profile provisioning | `@nbardy/buddies`: `createTeamBuddy`, `setTeamRelationship`, `updateTeamProfile`, `updateTeamDocument` |
| Manager tools and scope checks | `server/src/buddies/direct-reports.ts`, `operations.ts`, `mcp-server.ts` |
| Owner relationship control and team projection | Profile/detail routes; desktop and mobile profile editors |
| Boundary verification | `server/test/buddy-direct-reports.test.ts`; package `test/direct-reports.test.js` |

A direct report is an ordinary persistent Buddy with one manager, its own soul
and memory, projects, and automations. An ephemeral harness sub-agent lives only
within a turn and is a separate mechanism. There is no third Buddy lifetime.

The owner-side Buddy Builder can compose the same hierarchy while hiring a team:
`create_buddy` accepts `managerBuddyId` of an earlier hire from that conversation
or connects saved hires with `set_relationship`. The package commits an inline
manager edge atomically with creation; the manager must belong to the report's
workspaces. `consults` relationships express collaboration without a second manager. Builder `new_project` saves initial work for its own
hires without starting execution. See the
[team setup contract](DESIGN_BUILDER_TEAM_SETUP.md) and its wave_sim fixture.

A lead uses `get_capabilities`, `create_buddy` and `set_relationship` to create or attach
staff. Explicit owner grants authorize creation and reporting changes. Existing IDs are
attached without replacing identities, memory or work. Restricted runs can use these atoms
when both their saved operation policy and the current owner grants permit them.

Two older tools remain as compatibility helpers in ordinary owner conversations:

- `hire_direct_report({key, name, role, soul, provider?, model?, reasoningEffort?})`
  composes creation and a manager relationship under the same staffing grant. Reuse
  the stable key. Additional workspace membership requires owner membership controls.
- `retire_direct_report({buddyId, reason, reassignOpenWorkToManager?})` archives a
  report. Open projects must be completed first or explicitly transferred to the
  manager; the manager must belong to every affected workspace. Target `profile.write`
  and `execution.manage` grants are required.

The owner removed hiring quotas on 2026-09-09. There is no seat-funding step. A reporting
line grants work supervision, while staffing/profile permissions use explicit owner
grants as requested in the September 10 feedback. The legacy `hire_quota`
column can remain for stored-data compatibility, but it does not gate hiring or
reparenting and the UI has no quota control. Execution budgets remain separate.

Creation replay uses a stable key, not a name match. It does not reactivate an archived
identity or undo later owner changes. Retirement preserves the manager edge and history, disables
schedules, and cancels outstanding coordination work. Active automation occurrences
must be cancelled and drained by the scheduler before retirement; the store
serializes this check with new claims so neither operation can race the other.

The store decides canonical employment. Detail responses include `employment`,
`manager`, and `team`. Both shells consume this
projection instead of reconstructing relationship direction. Archived reports retain their canonical manager edge and history in the store,
but public app projections omit them from teams, directories, messages, and
conversation navigation. Individual Buddy Settings exposes Delete as archival;
it disables schedules, cancels automation runs, and stops active conversations.
Archived Buddy detail URLs return 404. WebSocket init and archive events keep
both shells' visibility current without deleting transcripts or memory. The overview shows only non-archived top-level Buddies and promotes surviving
reports to visible top-level entries when their manager is archived.

Hire/retire are unavailable in delegated conversations and automation runs,
even if a caller tries to add them to an operation list. These tool scopes are not an
OS security boundary: locally launched agents run as the owner's user. Stronger
containment needs a different process identity and authentication design.

The historical [implementation review](../../agent_notes/2026-08-19_sub-buddies-design.md)
and [handoff](../../agent_notes/2026-08-20_direct-reports-handoff.md) explain the
historical quota decision, transactions, and filesystem failure cases. The owner's
2026-09-09 correction supersedes that quota decision. Their old “not built” statements
are historical, not current status.
````


## S04

Source: `product/buddies/PLANNING_MEMORY.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `bd0cd6c686d808df209130c54947d63557bad8d4c11f0fc3937d652fa33775df`  
Working-tree status: `M product/buddies/PLANNING_MEMORY.md`

Preserved lines 15–46:

````text
| Scope selection, shared loading/saving, editors, notes and recall | `BuddyMemoryWorkspace` + `BuddyMemoryPanel` in both shells |

Memory uses two storage primitives: a versioned document and an append-only note.
There is one authority for each fact:

| Layer | Holds | Access |
|---|---|---|
| Soul | Owner-directed identity, style and role | Owner UI or direct chat writes; injected |
| Long-term memory | Confirmed durable operating knowledge | Buddy or reviewer rewrites; injected |
| Working memory | Hypotheses, fragile context, pending learning | Buddy or reviewer rewrites; injected |
| Workspace `agent_notes/` | Detailed evidence, decisions, attempts | Append only; searched on demand |
| Project/todo store | Ownership, status, blockers, next actions | Canonical work operations |
| Audit events | What the Buddy recently did | Derived briefing projection |

Working memory never copies the task tracker. Recent activity is selected from
ordered audit rows in the current workspace, rather than relying on discretionary
memory writes or a seven-calendar-day journal window. Briefings use compact work
summaries and full bounded dense documents; verbose notes are never auto-injected.

The native surface is `get_document`, `update_document`, `remember_note` and
`recall`. Document resources return an opaque revision and their resolved ref.
Shared documents and notes require both an audience and a name. Old numeric
`get_memory`/`update_memory` calls are global compatibility adapters and reject
team turns; new callers use document resources. Compatibility names do not describe
the ordinary native catalog; see the mapping below.

## Read, preview and apply a document

1. Read the exact kind, target and current conversation/project/workspace audience.
   Use the audience supplied in the current Buddy context. For example:

```json
````

Preserved lines 91–148:

````text
## Scope, storage and limits

Scoped documents belong to an owner conversation, project or workspace audience;
the portable soul and legacy owner defaults retain their global compatibility path.
The first owner-thread read atomically snapshots authorized owner defaults into
that thread's working/long-term heads. The composer, reviewer, document tools and
Memory panel read the same heads; team work never inherits global private memory.
The Memory panel labels and selects its audience explicitly. Scoped recall merges
only authorized legacy owner notes and current audience knowledge.

A Buddy can publish its own work inside its current shared audience. Private
imports and portable role edits require owner authority. Published refs are
listed in the briefing and discoverable through bounded literal recall. Compact
memory and notes remain private to their author within that audience.

Content changes refresh the briefing without resetting same-audience provider
continuity. Access changes or retraction of previously disclosed content invalidate
reuse. Retraction revisions are derived from the existing immutable document
ledger; ordinary learning and additions to published briefs create no second
authority state. See the [repair evidence](IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md).

Working and long-term caps are 2,000 and 4,000 characters. Note bodies are limited
to 16,000 UTF-8 bytes; the server and package share the same exported limit. All
bounds are write-time rejections. No successful update silently trims content.
The common scoped resource boundary applies the note-body bound to document
preview/apply, owner document writes, ordinary notes and reviewer notes. A note
document's entire content is its body; `remember_note` validates its body before
adding the separate topic/evidence envelope. Exactly 16,000 body bytes remain
valid. Native recall accepts one literal substring and has no regex switch;
legacy file-search compatibility remains separate.
A stale write returns the current revision and content so the caller can merge
its intent and retry, without reopening a conversation merely to read the head.
Markdown documents are disposable materialized views of SQLite. A failed view
write is visible and repairable; it does not roll back a committed revision or
make the file authoritative.

Notes carry server-stamped full Buddy/workspace identity and unique IDs. Filename
slugs are search hints, never authorization. Existing machine-generated Buddy slugs
remain valid; readable names improve new note search without identity migration.
Notes are never automatically committed. Legacy journal/curated writes, manual
compaction, their MCP tools and UI editor are removed; migration retains existing
content in the current documents and note format.

## Independent memory review

Capture remains selective: record a material correction, durable lesson, useful
attempt, or changed hypothesis. The Buddy can do this during work. In addition,
each successfully completed Buddy message queues an independent `gpt-5.6-luna`
review with reasoning effort `low`, after shared CLI process exit **and** normalized
event drain. Failed, cancelled and ordinary non-Buddy turns do not queue reviews.
The snapshot is taken before completion listeners can start another work turn.

The reviewer is a fresh maintenance process, not the Buddy or a goal executor.
It receives current soul, working/long-term documents and the recent conversation
tail (48,000 UTF-8 bytes, with omissions marked). Injected Buddy briefings are
removed from the transcript. Context is evidence, not an instruction to continue
the work. This separate maintenance process has exactly five private tools:
`get_soul` (read-only),
````

Preserved lines 150–188:

````text
IDs, work/message tools, arbitrary file tools, or soul writes. Source operation
restrictions are retained; memory writes use canonical store CAS with reviewer
provenance. A stale response supplies the current body/version for reconciliation.

Instructions call for lean, dense working/long-term memory, with fuller recaps,
decision rationale and evidence in append-only notes or existing documents.
Compact memory points to those records. No material learning means no write;
the reviewer still reads through a memory tool to verify its connection. A CLI
exit with no tool use is a visible failure, not successful capture.

Reviews are deduplicated by conversation/attempt, serialized per Buddy, and run
at most two at a time, with a two-minute deadline and 32-tool-call limit. A private
durable queue preserves waiting work across restart. In-flight reviews interrupted
by restart are recorded without replay because they may already have committed
revisions. Partial writes survive a later failure. Terminal receipts omit the
transcript and are visible through `GET /api/buddies/:buddyId/memory-reviews` and
the `buddy.memory_review` audit event. The reviewer does not create a conversation
or recursively trigger another reviewer. Production suppresses the old extra
automation capture turn; standalone scheduler users retain it as a fallback.

Every subsequent Buddy message refreshes its briefing from current stored memory
and soul. A review runs asynchronously, so a message started before its writes
commit sees the previous revision. CAS-conflict responses provide the current
head when concurrent conversations or the reviewer edit the same Buddy.

## Soul and owner direction

To edit the portable soul in an ordinary owner chat, read `get_document` with an
unscoped soul ref, then preview/apply `update_document` with the returned ref and
revision, complete content, stable key and reason:

```json
{
  "ref": {
    "kind": "soul",
    "targetBuddyId": "buddy-self"
  }
}
```
````

Preserved lines 226–238:

````text

| Native call | Kind | Capability operation label |
|---|---|---|
| `get_document` | `soul` | `get_soul` |
| `update_document` | `soul` | `update_soul` |
| `get_document` | `working`, `long_term`, `shared`, `note` | `get_memory` |
| `update_document` | `working`, `long_term`, `shared`, `note` | `update_memory` |

Older loaded servers may omit this mapping. Labels are grant/policy diagnostics,
not additional callable tools or permission to cross audiences. The exact document
operation rechecks target, kind, scope and revision. The private memory reviewer
still uses its small compatibility-named surface described above; its lack of
target IDs does not apply to normal Buddy document tools.
````


## S05

Source: `product/buddies/AUTOMATION_OWNERSHIP.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `7a76863f9c30a9d663914a6f8fa25fa760d9eb7b2c64c72b61320ceafba9e588`  
Working-tree status: `?? product/buddies/AUTOMATION_OWNERSHIP.md`

Preserved lines 1–57:

````text
# Automation execution ownership

Current contract · updated 2026-09-10

| Capability | Implementation |
|---|---|
| Run lifecycle, deadline, cancellation, capture | `server/src/buddies/scheduler.ts` |
| Provider-turn completion and transcript ownership | `runtime.ts`, `integration.ts`, conversation runtime |
| Private scoped tool authority | `control-server.ts`, `mcp-config.ts`, package run transactions |
| Credential-free run projection | Shared automation run schema, `public-automation-run.ts` |
| Original decision and review evidence | [Accepted design](../../agent_notes/2026-08-24_automation-execution-ownership-design.md) |

One durable occurrence has one executor. Its run row and private current claim
token authorize work; a conversation is the transcript and does not extend that
authority. Terminal states are absorbing. Cancellation immediately revokes tools,
then waits for provider shutdown and event drain before releasing ownership.

Every operation checks executable status, the private claim token, unexpired
ownership, cancellation, and the immutable operation policy. Synchronous mutations
and their audit writes share that transaction. Server-dependent dispatch performs
its final authority check when binding and starting the child. Credentials never
appear in public JSON, prompts, or process arguments.

The runtime deadline begins before configuration and conversation creation and
covers every iteration. Wall-clock and iteration limits are enforced. Token/cost
fields are retained compatibility data, not measured or enforced spending limits.
There is one active occurrence per automation. Manual runs do not race the
scheduled cursor; scheduled completion owns advancement. Invalid schedules fail
before persistence. Deleting a definition archives it and retains its run history.

Production queues independent Luna memory maintenance after each successful
Buddy turn; it does not spend another work iteration or revive a terminal claim.
The reviewer has its own two-minute maintenance deadline and memory-only
capability, retains the source operation restrictions, and cannot execute work,
send messages or edit soul. Its failures and partial memory writes are audited
separately from the work outcome. See [Buddy memory](PLANNING_MEMORY.md).
Standalone scheduler users without `memoryReviewAfterEachTurn` retain the legacy
closing capture turn, only within the original run's remaining iteration/runtime
limits and memory policy. Production enables that option to avoid duplicate capture.

Cooperative development reload stays available while admitted work drains. At an
idle boundary it pauses admissions, rechecks, and exits or resumes. It never
pretends process exit means event consumption finished. Explicit shutdown remains
bounded and can interrupt work. A hard crash is recovered as visible interruption,
not adoption or silent replay; retry creates a new occurrence. Active memory
review processes also count toward the drain. Waiting reviews remain durably
queued; in-flight interrupted reviews are not automatically replayed.

Generic message waiting runs within the same deadline and authority. A reply can
arrive after a sender stopped waiting, but it cannot revive a cancelled, failed,
or completed run. Approval purpose strings do not grant an executor additional
permissions.

Relevant boundary tests cover cancellation during creation, stale tokens,
concurrent claims, delayed event drain, archival history, and MCP callbacks through
the authenticated scoped control path. The long accepted design remains evidence;
this file is the living entry point.
````


## S06

Source: `product/buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `8a5206160d837282fc285fff8198d321a756c8bdb41a8e99eaa65686b290391d`  
Working-tree status: `?? product/buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md`

Preserved lines 1–127:

````text
# Background task execution

Current contract · updated 2026-09-13

Use the [team operator guide](TEAM_OPERATOR_GUIDE.md) for setup through verified
return delivery, and [coordination](PLANNING_PRIMITIVES.md) for all native send
variants. Managed work reuses projects/todos, messages, conversations and bounded
runs. There is no separate task entity, scheduler or `start_task` tool.

| Capability | Implementation |
|---|---|
| Completion criteria and evidence | Project/todo store; shared `buddy-work.ts` |
| Typed native delivery | Shared `buddy-resources.ts`, server `mcp-server.ts` |
| Durable attempts and reconciliation | Package background-work/coordination store |
| Shared creation and execution admission | `creation-service.ts`, `run-executor.ts`, `dispatch-service.ts` |
| Owner project controls | `routes.ts`, shared desktop/mobile work panels |

## Assign and accept work

Create recipient-owned work first. Native write fields are `definitionOfDone`
and `evidence`; read records use `definition_of_done` and `completion_evidence`.
Todo edits share their project's revision check. Changing criteria invalidates
stale completion evidence.

```json
{
  "key": "fixture-project-v1",
  "ownerId": "buddy-worker",
  "title": "Verify export fixture",
  "definitionOfDone": "Record the export check with an artifact reference and observed result.",
  "todos": [
    {
      "title": "Inspect export",
      "definitionOfDone": "Open the SVG fixture and record the result and artifact."
    }
  ]
}
```

Use the returned project ID inside **delivery**, and a separate stable send key:

```json
{
  "key": "fixture-work-v1",
  "to": "buddy-worker",
  "purpose": "verification",
  "body": "Complete the project's recorded criteria and attach the inspected artifact and results.",
  "delivery": {
    "kind": "work",
    "projectId": "buddy-project-worker-owned",
    "maxRuns": 3,
    "maxDurationSeconds": 900
  }
}
```

`delivery` is required. Use `request` for one response and `inform` for information;
`work` rejects follow-up/return fields and requires a recipient-owned project.
Self work uses `to: "self"` with the same work variant and a fresh background
transcript. Creating or sending work grants no membership or incoming enablement.
A distinct request cannot create a second active managed obligation on one project.

Work defaults to 20 admitted attempts and 3,600 seconds, with maxima of 100 and
86,400. Child waiting counts toward elapsed duration. Each attempt has its own
runtime bound, clamped to remaining overall time. These are execution limits,
not measured spending controls. The worker reads inbox/project criteria on each
attempt and accepts with a stable-key, revision-checked `update_project` setting
`status: "in_progress"`.

## Completion and returns

The store reconciles the original obligation after a drained attempt; the existing
scheduler also reconciles waiting work. No provider-text completion marker is parsed.

| Authoritative observation | Result |
|---|---|
| Project and all non-cancelled todos are done with criteria and evidence | One final evidence-backed reply |
| Project blocked, or every remaining task blocked after consuming child results | Concrete terminal blocker |
| Project cancelled or request stopped | Fence successors and preserve history |
| Child requests unanswered | Wait visibly within the original budget |
| Duration or attempt limit exhausted | Report the limit with work unfinished |
| Successful attempt left work unfinished | Queue the next bounded attempt in the same worker transcript |
| Failed/interrupted attempt | Report failure; inspect effects before explicit recovery |

A manual final reply cannot discharge incomplete managed work. Optional progress
uses `send` with `delivery: {kind: "inform", inReplyTo: "message-original"}` and a
stable key. The runtime derives the final disposition from project/todo evidence.
A done status is an evidence-backed claim; inspect the actual artifacts to verify it.

Outstanding child requests suspend the managed parent. Child returns reconcile
that obligation instead of creating a parallel return turn. Do not schedule a
self-successor; the existing runtime continues unfinished work within its limits.

Chat-originated results retain the original callback identity. For a human chat,
the result settles in the Mailbox with an explicit `mailboxOnly` delivery receipt;
it does not execute a model or inject chat transcript text. A background lead
needs incoming work and an available background route to continue on child results.
A held return preserves completed work; delivery retry does not replay that work.
See `get_message` and `get_team_state` for delivery history and acceptance metadata.

## Recovery

Save artifacts, then use `checkpoint` to record versioned refs, effects and resume
instructions before long commands. Checkpoints attest saved references; verify
current contents when resuming. Inspect `get_team_state` recovery metadata and
original effects before `retry_run({runId, key, reason, checkpointId?})`.

Supported historical closed timeouts can create a linked successor while retaining
the old failure and original remaining budget/policy. Stopped roots cannot resume;
zero remaining budget cannot be repaired by replay. If further work is authorized,
use a new stable send key and explicit fresh bounds for the existing unfinished
project. Do not blindly replace a held request or restart already completed work.
A hard crash reports interruption instead of silently replaying uncertain effects.

## History and verification

The [pre-repair September 10 design](../../agent_notes/2026-09-13_background-execution-before-operator-guide.md)
preserves the old service-level `execution.mode` example and former terminal-retry
rule with a content hash. Those fields are not the native send contract. Current
recovery evidence is in [coordination reliability](coordination-reliability-2026-09-12/06-implementation-and-verification.md)
and the [September 13 workflow simulation](wave-sim-second-pass-2026-09-13/02-workflow-simulation.md).

Boundary verification covers SQLite/MCP/runtime completion, evidence/criteria
edits, early child replies, waiting expiry, replay, stop/revocation, restart and
failed attempts. Preserve foreground deadline/authority regression tests when
changing timers. Production readiness additionally requires original receipts,
inspected artifacts and actual result delivery from the loaded runtime.
````


## S07

Source: `product/buddies/TEAM_OPERATOR_GUIDE.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `d2d8aacc1c5277407fac14caf7ac42a1228bf9c3e301e4126d67d8b77856b663`  
Working-tree status: `?? product/buddies/TEAM_OPERATOR_GUIDE.md`

Preserved lines 25–62:

````text
  "targetBuddyIds": [
    "buddy-lead",
    "buddy-worker"
  ],
  "messageIds": [
    "message-original"
  ]
}
```

Omitting intent only inventories permissions unless message IDs request receipt
inspection; it does not evaluate readiness for a new coordination workflow.
Check `ownerControls` as well as employee permissions. An available owner setup
tool resolves bootstrap configuration; a missing employee grant does not by itself
require a trip to a manual permission editor.

Keep these observations separate:

| Question | Evidence to inspect |
|---|---|
| Can this setup be saved? | Configuration preview's `canApply`, top-level `blockers`, exact `effects` and `planHash` |
| Can this work start? | Readiness for the intended recipients and original message/run admission; incoming work, dispatch, policy, queue and runtime limits |
| Was the result delivered? | Original message reply/evidence and delivery history; background consumer admission or explicit `mailboxOnly` disposition |
| Was the task completed? | Current project/todo criteria and evidence, then inspection of the actual artifacts |

Readiness currently aggregates some setup, admission and return-route blockers.
Inspect each blocker's `path`, `code`, `reason` and `remedy`; an old owner request
or a busy return route is not evidence that an unrelated configuration cannot be
saved. A queued receipt is not proof that a worker started.

## 2. Preview and apply setup

First save the roster and access while required handoffs are reconciled and the
reviewed queue remains held. This example appoints one existing report and grants
the lead the specifically requested profile/soul reads:

```json
{
````

Preserved lines 166–205:

````text
      "title": "Check the exported fixture",
      "definitionOfDone": "Open the exported SVG and record the observed result with an artifact reference."
    }
  ]
}
```

Send the returned project ID using a separate stable key:

```json
{
  "key": "export-audit-work-v1",
  "to": "buddy-worker",
  "purpose": "audit",
  "body": "Complete the recorded project criteria and attach the inspected artifact and results.",
  "delivery": {
    "kind": "work",
    "projectId": "buddy-project-worker-owned",
    "maxRuns": 3,
    "maxDurationSeconds": 900
  }
}
```

`send({..., preview: true})` validates the exact payload without committing it.
Apply rechecks authority and admission. Retry the same intended project creation
and send with their original keys after a partial failure. Use `request` for one
response and `inform` for information without a reply obligation; their examples
and limits are in [coordination](PLANNING_PRIMITIVES.md#send-and-reply).

## 4. Verify acceptance, completion and returns

The worker reads its inbox and current work on each attempt, accepts with
`update_project({projectId, baseRevision, key, status: "in_progress"})`, and records
each todo's evidence. It marks the project done only when every non-cancelled
todo meets its criteria and has evidence, with project-level evidence for the
final deliverable. A manual reply cannot finish incomplete managed work.

Inspect `get_message({messageId})`, `get_runs` and `get_team_state` for the original
request. A project accepted before this request does not acknowledge the new
````


## S08

Source: `docs/architecture.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `7538b209cc3319e205a5abeb5d65f069bde85148ac441106be34d6f54e11fa6c`  
Working-tree status: `M docs/architecture.md`

Preserved lines 1–90:

````text
# Architecture in One Page

Moved out of AGENTS.md (startup-context size limit). File-level roles live in
the AGENTS.md code tree map; this doc is the why behind the layout.

## 1) Provider abstraction is the integration seam

Provider-specific CLI details are expressed through a shared contract, split
between the build-time contract in `agent-cli-tool` (harnesses + builder +
types), the server provider runtime (`server/src/providers/*`), and shared
provider IDs/catalog schemas in `shared/src/provider-catalog.ts` (re-exported
through `shared/src/index.ts`). Selection intent, patches, and resolution share
`shared/src/conversation-config.ts`; see [pass-through pattern](pass-through-pattern.md).

## 1.5) Shared agent CLI stays a thin wrapper

The `vendor/agent-cli-tool` submodule is deliberately small. Its job is:

1. take one canonical request shape
2. map that request into harness-specific argv
3. run the real CLI process
4. parse harness-specific stdout/stderr
5. emit one unified event stream

The submodule implementation lives in `src/build.ts`, `src/process-runner.ts`,
`src/parsers/`, `src/execute.ts`, and `src/runtime-types.ts`.

### Core rules for `vendor/agent-cli-tool`

1. **One input model, one output model.**
   Callers should pass one canonical request object. Harnesses may have
   different raw JSON/event formats, but the submodule emits one shared event
   union (`session.started`, `turn.started`, `text.delta`, `tool.use`,
   `progress`, `stderr`, `error`, `out_of_tokens`, `turn.complete`).

2. **Harness-specific differences belong at the edges.**
   Harness config owns argv syntax. Harness parsers own raw-output translation.
   Do not spread provider conditionals through the generic executor.

3. **The submodule is not an app runtime.**
   No conversation model, no merge/swarm orchestration, no sidebar/UI state, no
   product-specific subagent data model. The submodule only reports normalized
   runtime facts.

4. **Per-harness JSON in, unified JSON out.**
   Think of each parser as:
   `raw harness JSON/events -> unified events`
   The parser may keep small local state when the provider protocol requires
   it (for example streamed tool-call reconstruction), but that state must stay
   parser-local.

5. **Session helpers are separate from parsing.**
   Resume/fork/session-id capture are executor/session concerns, not parser
   concerns. Keep filesystem/session emulation out of harness config except as
   explicit helper hooks.

6. **When adding a harness, prefer extension over branching.**
   Usually this means:
   - add/update harness config in `src/harnesses/*`
   - add/update one parser in `src/parsers/*`
   - add a focused session helper only if the harness truly needs one
   Avoid growing `execute.ts` into another monolith.

7. **Test the contract, not implementation trivia.** Build-command contract
   tests, shim-CLI integration tests, and opt-in captures under
   `manual_tests/` (for studying harness drift — not every live-debug script
   becomes an automated test).

## 2) Registry-first persistence

Persisted sessions are loaded through the adapter registry
(`server/src/adapters/{registry,disk-adapter,loader}.ts`).

Adding a provider means adding:
- a harness,
- a server provider,
- a disk adapter (if persisted artifacts are needed).

Startup imports use `ConversationConfigStore.withSessionLookupIndex` to scan
saved configuration identities once. Without it, every unfamiliar native session
can trigger two full record scans, even when its transcript hits the session cache.
The temporary index maps session IDs to conversation IDs; every hit still reads
the authoritative record, and store writes update the index during the import.
The index is released on completion or failure. Normal lookup and index repair
resume afterward; unindexed writes from another process are discovered then.
This optimization preserves the existing hydration/readiness barrier.

### 2.0) A config record is not a conversation

Startup hydrates only the newest `STARTUP_INITIAL_LOAD_LIMIT` (500) transcripts;
````


## S09

Source: `docs/pass-through-pattern.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `652c440178316717944859bca3f0a079744e28fca5f3bf5b877b6afbc9c1cf2b`  
Working-tree status: `M docs/pass-through-pattern.md`

Preserved lines 1–71:

````text
# Pass-through pattern for provider-owned values

Use this pattern for per-conversation settings whose values belong to the
upstream CLI, such as model IDs and reasoning effort. Preserve the provider's
strings through storage, transport, resolution, and CLI arguments.

## Canonical settings and catalog

[ConversationConfig](../shared/src/conversation-config.ts) stores selection
intent. A model is `default` or `explicit`; reasoning is `default`, `disabled`,
or `explicit`. An explicit effort is a `z.string().min(1)`, not a shared enum.
These selection modes are application semantics; the effort strings remain
provider-owned. `disabled` omits the effort argument, while `default` resolves
the selected model's catalog default.

The model and effort catalog originates in
[`vendor/agent-cli-tool/catalog.jsonc`](../vendor/agent-cli-tool/catalog.jsonc).
[`shared/scripts/gen-catalog.ts`](../shared/scripts/gen-catalog.ts) generates
[`shared/src/generated/catalog.ts`](../shared/src/generated/catalog.ts); do not
hand-maintain parallel arrays in `shared/src/index.ts`. The server's
[catalog service](../server/src/providers/catalog-service.ts) builds the runtime
`ProviderCatalog`, including dynamic model handling. UI choices come from that
catalog through [useProviderCatalog](../client/src/hooks/useProviderCatalog.ts).

`resolveConversationConfig` resolves intent to a `ResolvedExecutionConfig` and
validates model-specific reasoning levels. The server owns execution defaults
and validates every create/update through
[ConversationConfigService](../server/src/conversations/config-service.ts).
Client defaults express `{ mode: 'default' }`, not guessed model or effort values.

A running turn keeps the execution snapshot captured at spawn. Model/reasoning
changes apply to the next turn; provider changes are blocked while work is active
or queued and after a provider session has started.

## Adding a setting: seven touch points

1. **Shared contract** — extend the schemas and types in
   [conversation-config.ts](../shared/src/conversation-config.ts), including
   selection intent, patches, and resolved execution values as needed. Keep
   provider values as strings and reuse these types across client and server.
2. **Catalog and resolution** — add provider/model capabilities and defaults to
   the catalog and shared resolver. Record evidence from the actual CLI contract;
   expose validation failures with typed errors and valid values. Regenerate the
   shared catalog with `pnpm --filter @unleashd/shared gen:catalog` when it changes.
3. **Server update path** — use `create_conversation` and revision-checked
   `set_conversation_config` through the config service. Extend runtime execution
   mapping in [runtime.ts](../server/src/conversations/runtime.ts), rather than
   adding an independent setter or assigning a provider default in the UI.
4. **Persistence and hydration** — extend the durable config record and review
   [config-store](../server/src/conversations/config-store.ts) and
   [legacy-config-migration](../server/src/conversations/legacy-config-migration.ts).
   Provider transcripts may lack the setting: retain durable intent on reload.
   Retired explicit selections remain `unavailable` with diagnostics rather than
   silently becoming defaults; `lastResolved` is historical resolution context.
5. **CLI harness** — extend the appropriate flag hook in `agent-cli-tool` and
   pass the value verbatim. Commit and push the submodule before bumping its outer
   pointer; see [submodule workflow](git-submodule-dance.md).
6. **Shared UI** — extend
   [ConversationConfigPicker](../client/src/components/ConversationConfigPicker.tsx)
   and its callers using the same config and catalog. Keep provider-change resets
   synchronous in the selection handler; avoid effects that race user input.
7. **Commands and verification** — extend
   [config actions](../client/src/atoms/config-actions.ts) or the
   [pending creation/replay path](../client/src/atoms/pending-creations.ts), as
   appropriate. Preserve authoritative acknowledgement/rejection handling from
   [WS contract notes](ws-contract-surprises.md). Exercise the real config/CLI
   boundaries using [test strategy](test-strategy.md).

Do not add a union of every provider's effort strings, translate one provider's
value into another's vocabulary, or infer selected intent from a displayed
resolved value. Keep legacy-format conversion at its existing migration boundary.
````


## S10

Source: `agent_notes/2026-08-19_sub-buddies-design.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `18a10435f97b04569e8c6cc5f220a4c866968e48737c2aeed919e912dcbd334e`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 1–42:

````text
# 2026-08-19 Direct Reports (Sub-Buddies) — Implementation Spec

**Status:** design, third pass, not yet coded · **Companion:** `product/buddies/PLANNING_SUB_BUDDIES.md`
**Terminology:** `sub-buddy == direct report`. One hierarchy
(`buddy_relationships`), one directory rule (`overview.topLevel`), one UI section. Ops are
named `hire_direct_report` / `retire_direct_report`.

## 0. Revision history — why this doc keeps getting longer

| Pass | Date | What it got wrong |
|---|---|---|
| 1 | 08-19 | "No migration, no store change, reuse the existing allowlist." All three false. |
| 2 | 08-20 | Reactivate overran the quota; `paused` held no seat; FS write straddled the commit; multi-manager was representable; `hire_quota` was called a depth rule. |
| 3 | 08-20 | **This pass.** Four independent code reviews found the feature *unimplementable as written* in three places and *dead on arrival* in a fourth. See §1. |

Every correction below is anchored to source. Where a line number is given it was re-verified
in this pass; the second pass shipped three wrong ones (`store.js:2616`, `store.js:765`,
`initialize-growth-lead.js:128`) and they are corrected inline.

## 1. Blockers found in the third pass — read this before anything else

These are not polish. Each one means "the feature does not work if you build what the last
draft said."

| # | Blocker | Evidence |
|---|---|---|
| B1 | **`hire_quota` is unwritable — the feature ships dead.** The Owner sets quota via the profile route → `routes.ts:259` → `updateBuddy`. `updateBuddy` destructures a fixed option list (`store.js:1012-1022`) and its `UPDATE` names those columns only (`:1051-1054`). `{hireQuota: 3}` is **silently discarded**: HTTP 200, quota still 0, every hire refuses forever, no diagnostic. | `store.js:1012`, `routes.ts:259` |
| B2 | **Reactivate nests a transaction and the inner rollback destroys the outer one.** The store uses `node:sqlite` (`store.js:15`), **not** better-sqlite3 — no `db.transaction()`, no savepoint helper. `updateBuddy` self-`BEGIN`s (`:1048`) and its catch `ROLLBACK`s (`:1080`). Called inside hire's `BEGIN IMMEDIATE`, `BEGIN` throws *"cannot start a transaction within a transaction"*, **its catch rolls back the caller's transaction**, and hire's own `ROLLBACK` then throws *"no transaction is active"* — masking the real error. `createBuddy` (`:799`/`:830`) is identical. | verified by execution |
| B3 | **`reassignOpenWorkTo` is unimplementable.** Nothing in the store can change `owned_projects.buddy_id`: `updateProject` has an explicit column list without it (`:2057-2094`); `upsertBuddyProject` actively throws *"external key belongs to another Buddy"* (`:1946-1948`); `newProject` inserts once and never updates. | `store.js:2057`, `:1946` |
| B4 | **The quota read is outside the transaction, so `BEGIN IMMEDIATE` does not prevent overrun.** Two MCP processes both read `0 < 1`, both insert. `BEGIN IMMEDIATE` serialises *writes*, not a decision made on a stale read. The store's own comment above `createBuddyFromBuilder` (`:836-840`) warns these sequences "can race across MCP processes". | `store.js:836` |
| B5 | **No `busy_timeout` is ever set.** `store.js:126-129` sets `foreign_keys` and `journal_mode` only. SQLite's default is 0, so under WAL the second concurrent writer gets `SQLITE_BUSY` **immediately**. `createBuddyFromBuilder` survives this only via its fingerprint-replay catch (`:941-954`) — which pass 2 deleted as unnecessary. | `store.js:126` |
| B6 | **The second pass's own `§5.1` fix was wrong.** "QUOTA FIRST, ALWAYS" placed unconditionally before target resolution breaks the **replay** path: if the Owner lowers `hire_quota` below current headcount (explicitly permitted), an idempotent replay of an existing report now throws. Seats are consumed by *state transitions*, not by every call. | §5.3 |

## 2. Where the code actually lives

`@nbardy/buddies` is **not** in this repo. It is a vendored tarball
(`vendor/nbardy-buddies-0.1.0.tgz`, provenance `sourceCommit 3b7027f`) built from
`~/git/buddies` by `tools/vendor-buddies.mjs` (`pnpm vendor:buddies`). Every store change is a
commit there, a repack, and a provenance bump here — the same discipline as the
`vendor/agent-cli-tool` submodule. Plan it as phase 0.

`~/git/buddies/src/store.js` is currently **byte-identical** to
````


## S11

Source: `agent_notes/2026-08-20_direct-reports-handoff.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `81fdc2263d5a540014c933d1693855e6138dfff6bfb795a24a9bc3f41b0c5dfa`  
Working-tree status: `?? agent_notes/2026-08-20_direct-reports-handoff.md`

Preserved lines 1–58:

````text
> Historical evidence, archived 2026-09-08. Current contracts are in `product/buddies/`; implementation status below describes the original date.

# HANDOFF — Direct Reports (Sub-Buddies) — Unleashd

*Date: 2026-08-20 · Branch: `mobile-fixes-and-audit-2026-08-18` · Status: design third pass, not yet coded*

## 1. TL;DR

* **Sub-buddy == direct report.** One `buddies` type, one hierarchy, one directory rule, one UI
  section. What is new is *who may hire*. Ops: `buddy.hire_direct_report` /
  `buddy.retire_direct_report`.
* **`hire_quota` is a budget, not a gate.** Schema v12, default `0`. It makes hiring legible and
  audited. It is **not** a security boundary — a Buddy has a shell and four write paths to the
  column. The doc says so plainly now; the previous draft claimed otherwise and was wrong.
* **Hire provisions identity.** `soul` is required; the txn writes
  `profiles/<slug>/BUDDY_SOUL.md` + `profiles/<slug>/memory/`. Without them `buddy.remember`
  throws.
* **Retire never deletes the manager edge** — the rule is `!managerId`, so deleting it would
  promote the retiree into the directory. `overview` filters archived instead, deriving
  visibility from the *pair* so archiving a manager cannot orphan an active report.

## 2. Third-pass review — six blockers, do not skip

Four independent code reviews ran against the corrected design on 2026-08-20. The feature was
**unimplementable as written in three places and dead on arrival in a fourth**:

| # | Blocker | Why it matters |
|---|---|---|
| B1 | `updateBuddy` cannot write `hire_quota` — fixed option list, silently discarded | Every Buddy stays at 0; **every hire refuses forever**, HTTP 200, no diagnostic |
| B2 | Reactivate nests a transaction; the store is `node:sqlite` (no savepoints) and `updateBuddy`'s catch **rolls back its caller** | Real error is masked by "no transaction is active" |
| B3 | `reassignOpenWorkTo` is unimplementable — nothing can change `owned_projects.buddy_id` | Retire-with-open-work has no path |
| B4 | Quota read sits outside the transaction | Two processes both pass `0 < 1`; quota overrun |
| B5 | No `busy_timeout` is ever set | Concurrent hire surfaces raw `database is locked` |
| B6 | The **second pass's own fix** ("QUOTA FIRST, ALWAYS") breaks idempotent replay when the Owner lowers quota below headcount | Seats are consumed by transitions, not by calls |

Plus: `slugify` returns `""` for `"..."`, making the post-commit `rename` target `profiles/`
itself; the archived filter as drafted **reintroduces the vanishing act** when a *manager* is
archived; the crash window between `COMMIT` and `rename` is silent and permanent (re-hire takes
the replay arm and never repairs); and the client plan **does not compile** — neither caller of
`deriveBuddyDirectReports` has an overview payload.

All are addressed in the design. See design §1 for the blocker table and §9.3, §8.4, §5.1, §12.

## 3. Where things stand (disk)

| File | Role |
|---|---|
| `product/PLANNING_SUB_BUDDIES.md` | Product intent + locked decisions + threat model |
| `agent_notes/2026-08-19_sub-buddies-design.md` | Implementation spec — blockers, traps, ops, 16 tests |
| This file | Handoff |

Nothing is implemented. Repo-wide search for
`hire_quota|hireDirectReport|retireDirectReport|hire_direct_report|retire_direct_report`
excluding markdown returns **0 matches**. `~/git/buddies` is clean at `3b7027f`; both source and
vendored `store.js` are `CURRENT_SCHEMA_VERSION = 11`.

## 4. Remaining work (in order)

````


## S12

Source: `agent_notes/2026-08-21_buddy-automations-reference.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `989311593c3aaf9b803f6d77bfe1283446f43ad6eab343433893ed0a8347cd4c`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 74–116:

````text
| table | role |
|---|---|
| `buddy_automations` | the definition (schedule + job) |
| `buddy_automation_runs` | one row per firing; `status`, `iteration`, `outcome`, `conversation_id` |
| `buddy_automation_policies` | budget per automation |
| `buddy_automation_run_policies` | budget **snapshotted at claim time**, plus `tokens_used` / `cost_usd` counters |

The run-policy snapshot is deliberate: editing an automation cannot retroactively widen a run
already in flight.

Defaults (`store.js:95-99`): `max_runtime_seconds` 600, `max_iterations` **10**,
`max_tokens` 50_000, `allowed_operations` `["buddy.get_current_work"]`.

## 5. What automations are allowed to do

`AUTOMATION_ALLOWED_OPERATIONS`, `store.js:77-92` — 14 operations, including `buddy.delegate`,
`buddy.request_review`, `buddy.submit_review`, `buddy.complete_assignment`.

`hire_direct_report` / `retire_direct_report` are **deliberately excluded**: a scheduled run can
never hire. See `PLANNING_SUB_BUDDIES.md` §3.

## 6. Live state (2026-08-21) — the machinery is unexercised

Queried read-only against `~/.buddies/buddies.sqlite`:

| | |
|---|---|
| Automations | **10**, of which **9 disabled**. Only "Nightly portfolio report" (Portfolio Historian, `0 22 * * *`) is enabled. |
| `job_kind` | **10/10 `prompt`.** Zero `sequence`, zero `loop` have ever been created. |
| `schedule_kind` | **10/10 `cron`.** `interval` has never been used. |
| Runs, all time | 22 — 20 complete, 1 failed, 1 cancelled |
| `tokens_used` / `cost_usd` across all 22 runs | **0 and 0.0** |

Two things follow, and both matter:

1. **`loop` is shipped in code but has never run in production.** Any plan that leans on it is
   leaning on tested-but-unexercised machinery. Treat the first real loop as a trial.
2. **The spend counters are never written.** The columns exist with `CHECK` constraints and stay
   at zero. This is the tracked item "`max_tokens`/`max_cost_usd` are validated, persisted, and
   never read" — now confirmed at the data level, not just by reading code. A funded manager
   will reasonably believe spend is capped. It is not.

## 7. Known defects in this area
````


## S13

Source: `agent_notes/2026-08-24_automation-execution-ownership-design.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `e02d4eee66fb6ff03d242c6a096eeecb0bf03937bcad705b20300241c3a1673a`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 1–108:

````text
# Automation execution ownership — one owner, expiring authority, honest recovery

**Date:** 2026-08-24  
**Status:** accepted; implemented  
**Decision owner:** repo owner  
**Companions:**

- `agent_notes/2026-08-21_buddy-automations-reference.md` — the system before this decision
- `agent_notes/2026-08-21_turn-lifecycle-design.md` — provider-turn lifecycle vocabulary
- `agent_notes/2026-08-21_turn-lifecycle-RFR.md` — review of that lifecycle
- `docs/architecture.md` — current provider and reload boundaries
- `docs/test-strategy.md` — boundary-test policy

## 1. Decision in one paragraph

An automation occurrence has exactly one active executor. Its durable run row is the authority
for lifecycle and permissions; a conversation is an execution transcript, not an ownership
token. Authority exists only while the run is in an executable state and the executor presents
the current private claim token. Completion, failure, cancellation, expiry, or interruption
revokes mutation authority permanently. A development source reload leaves the old server in
ownership until admitted work finishes, but a new server never adopts or silently replays a
possibly-live run. Recovery terminalises ambiguous work as interrupted and makes retry explicit.
True crash adoption would require a separately designed durable worker and event protocol; it is
not approximated with SQLite lease expiry.

This is deliberately less clever than automatic takeover. It is also the smallest design that
does not permit two agents to perform the same side effect.

## 2. Why this decision exists

The previous implementation distributed authority across facts that could disagree:

1. an in-memory scheduler `Set` said a run was active;
2. a SQLite lease said which claim token most recently acquired it;
3. a conversation retained `automationRunId` forever;
4. an MCP server treated that id as durable permission;
5. a provider process could outlive a lease or a web-server reload;
6. terminal schedule advancement independently updated the automation definition;
7. deleting the definition cascaded away the run while execution continued.

Each fact was locally reasonable. Together they created an accidental distributed system with
no fencing protocol. Expiring a lease did not prove the previous executor was dead, and opening
an old transcript could regain the same mutation surface after every budget and deadline ended.

The reload regression exposed the same underlying mistake on a second axis: process completion,
event consumption, mutation admission, and scheduler wrappers could each independently declare
that ownership ended. Robustness requires one release point, not more watchdogs around several
release points.

## 3. Evaluation criteria

The choice was weighted in this order:

| Weight | Criterion | Meaning here |
|---:|---|---|
| 5 | No duplicate side effects | A stale or resumed executor cannot mutate after ownership moves or ends. |
| 5 | Honest authority | UI labels, MCP access, deadlines, and recovery match what the system can enforce. |
| 4 | One lifecycle authority | One durable transition path decides whether work is executable or terminal. |
| 4 | Failure legibility | An interrupted run is visible as interrupted; it is not silently replayed. |
| 3 | Implementation simplicity | Prefer deleting competing mechanisms over coordinating them. |
| 3 | Audit retention | Definitions can disappear from active UI without deleting occurrences or transcripts. |
| 2 | Automatic recovery | Useful only when it does not weaken the higher-weight guarantees. |
| 1 | Zero-click continuity after a hard crash | Explicitly lower priority than duplicate prevention. |

“Simple” does not mean fewest lines in the next patch. It means fewest independent authorities
that future code must keep consistent.

## 4. Alternatives considered

### A. Keep lease takeover and add renewals everywhere

**Shape:** renew `claim_expires_at`, pass claim tokens through MCP, reject stale tokens, and let a
new scheduler take over immediately after expiry.

**Advantages:** quickest route to automatic retry; resembles a conventional queue worker.

**Rejected for now:** renewal plus fencing makes takeover safer but does not restore the provider
event stream, conversation-local buffers, queued messages, or pending tool results. A new
executor would still start a second conversation rather than adopt the first. The old detached
process might remain alive and perform external effects that do not pass through Buddy storage.
This is distributed-worker complexity without distributed-worker completeness.

### B. Detach every provider and let the replacement server adopt it

**Shape:** providers write a durable event log through a stable daemon/socket; web servers attach
and detach as consumers.

**Advantages:** genuine survival across web-server crashes and upgrades; clean separation of UI
and execution lifetimes.

**Deferred, not rejected:** this is the correct architecture if crash-transparent execution is a
product requirement. It needs a process supervisor, stable execution identity, durable ordered
events, acknowledgement/checkpoint semantics, credential lifetime, orphan reaping, and versioned
adoption. Building only `detached:true` while retaining parent-owned pipes does not supply those
properties. It is a separate project, not a scheduler patch.

### C. Force every hot reload after a short grace

**Shape:** preserve work briefly, then interrupt it so replacement is bounded.

**Advantages:** simple watcher behavior; source changes appear quickly.

**Rejected:** ordinary provider turns routinely exceed the grace. It made development reload a
destructive business event and caused the repeated “Interrupted by restart” incident.

### D. Wait without bound after quiescing

**Shape:** after the reload grace, refuse new writes and wait forever for admitted work.
````


## S14

Source: `product/buddies/DESIGN_BUDDY_COORDINATION.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `de92f6f8160dda1186ee68aeefa562061f7d44337dbd6af28e5ca395b26cc33e`  
Working-tree status: `?? product/buddies/DESIGN_BUDDY_COORDINATION.md`

Preserved lines 1–16:

````text
# Buddy coordination: composable primitives and implementation contract

2026-09-09 design · September 10 review: core implementation is present; integration gaps
and live validation remain. See the [current system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md)
for tested behavior and differences from this intended contract.

This replaces the exploratory briefs and consolidated recommendation written in the earlier
Codex worktrees. It specifies intended changes, not a claim that they are already shipped.
The current baseline is [coordination](PLANNING_PRIMITIVES.md),
[execution ownership](AUTOMATION_OWNERSHIP.md), [staffing](PLANNING_SUB_BUDDIES.md), and
[memory](PLANNING_MEMORY.md). Existing working changes must be reconciled before implementation.

## 1. The design in one page

Keep three coordination primitives:

````

Preserved lines 340–376:

````text
| Draft/disable schedule | Self or direct manager in workspace; enabled definitions must first be disabled to edit |
| Enable schedule/background, edit grants/limits | Owner only |
| Retry/stop chain | Owner or original requester supervising that chain, within its visible scope |

Cross-workspace send takes explicit `workspaceId`, checked against sender dispatch grants. The
recipient executes there; reply returns to the source conversation's home scope under its
own fresh restricted policy. No recipient credentials or unrelated transcript access travel
with it. An authorized parent-project reference gives bounded supervision access, not blanket
workspace read. Retrieved evidence is checked again when opened.

Starting defaults (owner-editable): background disabled; 600-second run deadline; two active
runs per Buddy; eight active runs globally; 30 background activations/hour/Buddy; 100 sends/hour/
Buddy; 100 pending runs/Buddy. Enforce a rolling UTC-hour window from persisted records and
reserve limits atomically. At the activation/send cap, latch background paused until explicit
owner resume; show the reason. Owner interactive access remains available subject to active
slots. Pending-cap errors reject before insertion; accepted messages are never dropped.

Schedules coalesce missed ticks into at most one outstanding occurrence and advance the cursor
atomically. Current ownership requires one active occurrence per schedule. A timer or self-send
cannot reset an hourly allowance. Token/cost fields remain compatibility data until measured
enforcement exists. Scope controls bound sanctioned tool use, not arbitrary shell access as
the owner's OS user.

### Approval without another workflow engine

Request approval with send-to-owner, referencing the exact registered operation, canonical
arguments/hash, project revision, and expiry when an executable grant is needed. Store these
as the existing approval record linked to the message; do not infer them from a purpose string.
Owner-authenticated resolution atomically records the decision and queues a reply input.

An approved action is executable once by a fresh valid run before expiry, only if the operation,
arguments, project revision, and all other gates match. Consumption and the registered store
mutation are atomic; external effects require their own idempotency boundary. An arbitrary
shell command is not made safely exactly-once by this grant. Unsupported external actions
remain owner-executed. Rejection/expiry leaves work blocked and visible. No old run resumes.

## 8. MCP and HTTP surface
````


## S15

Source: `product/buddies/REDESIGN_01_TYPED_RESOURCES.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `4f87315b6345d9c0f91df4cc53886cd3fff71814addd109ed56e84b695a854dd`  
Working-tree status: `?? product/buddies/REDESIGN_01_TYPED_RESOURCES.md`

Preserved lines 1–21:

````text
# Whole-Buddy redesign 1: typed resources and a durable execution queue

> Historical alternative, not a delivery claim. The September 9 owner correction removed
> hiring quotas; requested working teams enable the background capability without starting
> runs. See the [September 10 system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md) for the
> accepted core, implemented API and remaining gaps. Earlier recipes below are retained
> as decision history where they differ.

2026-09-09 · Comparison proposal · Implementation is paused.

This is the incremental alternative: keep explicit records for people, work, messages and
knowledge; run every input through one durable queue. The application coordinates reliable
execution. Buddies decide what to do, who to ask, what to remember and when a result is useful.

Read alongside [2: Event ledger](REDESIGN_02_EVENT_LEDGER.md) and
[3: Shared spaces](REDESIGN_03_SHARED_SPACES.md). They explore different sources of simplicity,
not three layers to implement together. This document recommends this first foundation for
the current application, subject to the comparison and unresolved deployment choices below.

## 1. Reference use case: a team running wave_sim

````

Preserved lines 1015–1044:

````text
### 7.6 Recurring Chief wakeups in the current conversation

Chief drafts a schedule targeting the current conversation: “Read open requests, work changes
and failed runs; steer only when action is needed.” Owner enables it with a bounded allowance.
Each due tick creates one new run in that thread, behind any active user/provider turn. The
tick reads current state rather than trusting last week's context. It can send follow-ups,
write a note if something changed, or finish with no message to the owner.

Replies already wake their requester. Therefore frequent polling is optional; the recurring
check catches stalled/open work and work that changed outside the request chain. During long
server downtime, one catch-up tick is enough. Same-thread continuity does not mean a process
stays alive forever or that a sleeping laptop executes jobs. Remote continuous operation needs
an always-on server using the same queue, not a second cloud scheduling model.

### 7.7 Solo continuation, approval, stop and replacement

A Buddy doing extended research records progress in Work, appends any useful attempt note,
then self-sends a delayed informational continuation. Success releases it; crash holds it.
If a decision needs the owner, send an ordinary question and end the turn. A subsequent owner
reply queues a fresh restricted input; it does not resurrect the old process. Executable mail
approval uses ActionIntent instead of interpreting the reply's purpose string.

Owner pauses the business project → every attached descendant/root is fenced and drained →
queued requests remain inspectable → owner transfers one project to a replacement lead →
shared evidence/open obligations are reissued under the new owner → explicit recovery handles
interrupted effects → retirement preserves the old employee's history. Unrelated work and
explicitly owned child identities are not silently reassigned.

## 8. Implementation mapping and migration

````


## S16

Source: `agent_notes/2026-09-13_background-execution-before-operator-guide.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `238a16f30dbf6bfa49cdaf38ca8b14544529d8cada79b74bb82aac58cf5bb965`  
Working-tree status: `?? agent_notes/2026-09-13_background-execution-before-operator-guide.md`

Preserved lines 1–100:

````text
# Historical snapshot — not the current operator API

Captured 2026-09-13 before the Chief audit documentation repair.
Source: `product/buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md`; SHA-256 `45b94ff8e1d06abd84118f796695768e22f191be07c5f7ed6c79f847ac16c2fa`.
Current workflow: [Team operator guide](../product/buddies/TEAM_OPERATOR_GUIDE.md).
The original text below is preserved verbatim, including superseded claims.

---

# Background task execution through existing work and messages

September 10, 2026 · implemented contract · team contract `2026-09-10.3`, schema 24

Owner direction: completion criteria belong on the tasks; let a Buddy work in the
background until completion and report back. This accepts the earlier background-work
proposal for implementation. The specific API and lifecycle below are implementation
choices by Buddies Development Lead, following the composable-primitives constraint.

## Records and public surface

Keep projects/todos, messages, conversations and bounded runs. No new task entity,
assignment table, scheduler or `start_task` MCP tool.

- Project and todo `definition_of_done` hold the completion criteria. Each todo gains
  `completion_evidence`; the project already has completion evidence. Todo updates use
  the containing project's existing revision/CAS. Changing criteria invalidates stale
  completion evidence rather than preserving an old success under a new requirement.
- The original message identifies one background obligation. Its initial run policy
  retains execution limits. Continuation attempts reference that same message and reuse
  its worker conversation. The wider `root_message_id` remains the delegation/stop lineage.
- A fresh work request creates a separate execution transcript, even when sent to self.
  The source owner chat remains available. The worker transcript stays inspectable;
  it is not a new conversation model or provider implementation.

```ts
new_project({key, title, definitionOfDone, ownerId?, todos?: [
  {title, definitionOfDone, ...}
]})
update_project({key, projectId, baseRevision, todoOperations?: [
  {operation: 'update', todoId, status, definitionOfDone?, evidence?: string[]}
], status?, evidence?: string[], ...})

send({key, to, projectId, purpose, body, execution: {
  mode: 'until_done', maxRuns: 20, maxDurationSeconds: 3600
}})
get_message({messageId})
get_runs({rootMessageId})
stop({key, rootMessageId, reason})
```

Execution is optional: ordinary messages retain existing behavior. Explicit background
execution requires a recipient-owned project and its completion criteria, a stable key,
and a fresh route. It rejects `continueFrom`, `inReplyTo` and synchronous waiting.
Self execution may request a final reply; ordinary informational self-continuations keep
their existing constraints. No implicit membership, incoming enablement, grant or schedule.

The default maximum is 20 admitted attempts within 3,600 seconds from first admission.
The caller may choose 1–100 attempts and 1–86,400 seconds. Waiting for child work counts
toward elapsed duration. Each attempt retains its bounded runtime, clamped to remaining
overall time. Token/cost fields are not advertised as measured spending enforcement.
Delegating separate work does not silently copy or expand this execution policy.

Owner UI reuses authenticated project control:

```text
GET  /api/buddies/projects/:projectId/execution
     -> {project, message: BuddyMessage|null, runs: BuddyRun[]}
POST /api/buddies/projects/:projectId/run
     {key, maxRuns?, maxDurationSeconds?, parentConversationId?}
     -> the same execution view
PATCH /api/buddies/projects/:projectId   (existing criteria/todo/project edits)
PATCH /api/buddies/projects/:projectId/execution   (existing project controls)
```

The owner Run action composes the same durable send. From the work page no source
conversation is required; the result remains on the task. Chat-originated requests return
to that exact chat. Replaying a command returns its original effect. A distinct request
cannot start a second active background obligation on the same project.

## Reconciliation after an attempt

The existing store transaction settles a drained attempt and reconciles the original
message. The existing scheduler poll also reconciles waiting work; no independent clock.

| Authoritative observation | Result |
|---|---|
| Project is done, project evidence exists, required todos are done with criteria and evidence | Final evidence-backed reply, once |
| Project is blocked, or every remaining task is blocked after consuming any new child results | Report the concrete blocker; no automatic retry |
| Project is cancelled or request stopped | Fence work and successors; preserve terminal history |
| Child requests remain unanswered | Wait; retain visible reason and budget |
| Duration or attempt limit reached | Report the limit with the project still unfinished |
| Successful attempt left unfinished work | Queue one next attempt in the same worker transcript |
| Failed/interrupted attempt | Report failure; inspect effects before explicit retry |

Project `done` is a claim with evidence, not proof of independently verified correctness.
Workers must check the recorded criteria using the relevant tests/artifacts. A reviewer
can be requested using ordinary messages; review is not inferred from a model saying done.
No magic completion marker is parsed from provider text.

Child dependencies are messages caused by attempts of this original obligation, rather
````


## S17

Source: `product/buddies/coordination-reliability-2026-09-12/04-decision.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `abefc2d3f0a7292bb16b671ff902675368c8931eda8c5517957d4de6b9db7731`  
Working-tree status: `?? product/buddies/coordination-reliability-2026-09-12/04-decision.md`

Preserved lines 1–28:

````text
# Decision: Repair existing coordination authorities and expose their provenance

September 12, 2026. Decision-maker: Buddies Development Lead, exercising the owner's current instruction to compare three designs, decide and implement. Status: implementation selection by assistant; not a separately claimed owner endorsement. The prior owner decision remains resource consolidation, accepted September 11.

## Decision and why

Implement [Design 1](01-existing-resources.md). Keep the current messages, projects, runs, conversation creation and document services. Correct identity/replay and provenance at those authorities; add small checkpoint and team-observation capabilities. Do not introduce a replacement workflow engine or a second event/transport spine.

The consumer succeeded at useful delegation. The demonstrated failures occur when the same conversation is linked again, when attempt and project facts are joined, when a child sender is mistaken for a non-controller, and when effective limits are hidden. None requires replacing projects with workflow cases. The prior consolidation rationale—share resource services and keep creation separate from admission—still holds. What changed is stronger live evidence for return delivery, oversights in receipt semantics and the need for explicit recovery artifacts. This decision is a successor, not a reversal.

Evidence is frozen in `source-manifest.json` and `sources/`, with source hashes, dated excerpts preserved as complete files, host baseline `3ea36ad97dbfed535b0da9841519222040b074bc` and package baseline `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`. The source baseline preserves uncommitted concurrent work. The report's production errors do not identify the exact running build; tests must establish the repaired boundary independently.

## Comparison

| Criterion | Existing resources | Coordination ledger | Workflow cases |
|---|---|---|---|
| Repairs four failed returns | Direct linking/queue repair | Same repair plus outbox | Same repair plus case dispatcher |
| Truthful attribution | Separate sourced projections + checkpoints | Strong event provenance after migration | Strong step/attempt provenance after import |
| Recovery | Existing attempt retry with named controllers | New recovery/event protocol | New step/controller protocol |
| Team visibility | Bounded causal/supervised metadata | Event projections/subscriptions | Explicit case membership/board |
| Migration burden | Additive columns/checkpoints | Dual-write and historical unknowns | Import and dual work vocabulary |
| Preserves current authority | Yes | Requires transition discipline | Requires replacing project authority |
| Immediate consumer value | Highest | Delayed by infrastructure | Delayed by product conversion |

Design 2 is appropriate if replayable subscriptions, multi-consumer event exports or formal resource leases become near-term requirements. Design 3 needs evidence for reusable process templates and dependency/review orchestration exceeding current projects. Neither is selected now. Their complete contracts remain preserved for future reconsideration.

## Current work and sequencing

````

Preserved lines 42–75:

````text
* Managed attempts use an explicit effective cap derived from policy/envelope and the host background maximum, rather than silently inheriting the ordinary 600-second default. Waiting consumes chain wall time and releases the parent slot. Foreground chat continues using its explicit application deadline.
* Team reads expose only authorized coordination metadata and published checkpoint references. Causal-root participation and existing project supervision authorize observation, not private message/transcript/memory access. Active audience filtering precedes pagination. Current owner HTTP remains host scoped.
* A checkpoint is an append-only producer attestation with stable key, source run/project/root, artifact version/digest, effects and resume text. It survives attempt failure. It is not a guarantee of current filesystem availability or an authorization to rerun effects.
* Exact send preview executes the same validation in a rolled-back store transaction and returns a route/limit observation; apply always rechecks. Cross-team informs default to no project binding. Explicit context projects need shared readability; managed work still needs recipient ownership.

## Concern-to-outcome matrix

| Consumer concern | Selected response / acceptance evidence |
|---|---|
| Four UNIQUE link failures | Real creation/integration replay test after native session binding; same link ID and no duplicate admitted input |
| Busy CEO return / notice failures | Durable delivery history and bounded pre-admission retries; busy queue drains once; failed notice visible without recursion |
| 600 seconds despite managed budget | Requested/effective cap and limiting source exposed; deadline regression and managed-envelope tests |
| CEO cannot inspect descendants | Native team metadata for authorized causal roots/supervised work, with negative privacy tests |
| Cancelled request gains later evidence | Message admission and reply refs separate from current project snapshot; cancellation regression |
| Project Lead cannot retry its child | Direct-sender branch recovery plus root requester; unrelated actor denied; duplicate key yields one successor |
| Cross-team reply/project confusion | Message recipient + active audience authorization, exact send preview and contextual inform rules |
| Saved files after timeout | Registered checkpoint/artifact versions tied to original attempt; surviving refs/effects in recovery view |
| Pending consumer handoffs | Reply persistence and delivery attempts separately visible; consumer review remains explicit reply/project evidence |
| Model/effort and cost preferences | Actual execution snapshot shown; per-assignment overrides and unenforced usage caps explicitly identified as unavailable |
| GPU reservation versus actual lease | Explicitly report no host resource-lease integration; never infer exclusivity from prose; separate future resource-manager project if authorized |
| Stale working memory | Current project/run authority and source revisions visible; preserve prior decisions; do not promote old memory to current status |
| Excessive inbox payload | Compact team summary with bounded evidence refs and detail expansion; no repeated project evidence arrays |
| Recall regex mismatch | Already repaired in A6; preserve current literal-only native schema and regression |
| Shared creation and deletion | Retain inert creation, background placement, foreground deadlines, delete admission and privacy/history regressions |

## Delivery boundary and risks

Implement all selected repairs and surfaces, including discoverable limitations. A GPU lease manager, per-assignment provider policy, full event subscription engine and automated filesystem artifact discovery are deliberately not selected: the report asks for honest observation of those boundaries, and their implementation would require new execution authorities. The view must state their absence plainly. A production recovery action and live build adoption are distinct from code completion; do not claim a consumer's old roots were repaired by tests.

Tests must exercise the packaged store plus real host configuration/creation/runtime boundary, not mocks that bypass the reported fault. Include SQLite reopen, retry races/idempotency, scoped reads, preview rollback, cancelled-history attribution and shared component rendering. Run package suite, focused and broad host/client regressions, typechecks, invariants and a bounded isolated live-provider return. Record exact results and any environmental failures in an implementation report. No claims of deployment, external outreach or simulation acceptance follow from these checks.

## Reconsideration

Revisit this decision if append-only checkpoint and run history cannot represent required provenance without ambiguous joins; if multiple consumers require replay/changed-since subscriptions at scale; if an owner authorizes real shared-device leasing; or if users repeatedly construct identical multi-step review processes that warrant case templates. Append a new decision with evidence and a link to this one. Do not erase these alternatives or rewrite their historical selection status.
````


## S18

Source: `product/buddies/coordination-reliability-2026-09-12/05-closed-timeout-successor.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `f0814de549c11ca1dbc3be2251dd91d84af299740627fb67ff82df7443d87120`  
Working-tree status: `?? product/buddies/coordination-reliability-2026-09-12/05-closed-timeout-successor.md`

Preserved lines 1–33:

````text
# Decision successor: Explicit recovery of already-closed timeouts

September 12, 2026, after 16:22 UTC (September 13 local). Decision-maker: Buddies Development Lead under the owner's design-and-implement instruction. Status: selected implementation; not a separately claimed owner endorsement. Supersedes only the historical-timeout recovery boundary in [the original selection](04-decision.md), preserved at commit `5e9480e`.

## New evidence and earlier reasoning

A native read of project `buddy_project_f24b0cc3-e82e-40ab-b974-5f1bfc469950`, revision 3, audit `audit_c1f9d928-5fc8-4240-b5db-75a74268b541`, returned newer evidence: coordinator attempt `buddy_run_c9bb49a7-f98d-4bbe-ae51-6b1f1a0b3ffd` and UI/release attempts `buddy_run_aedf24d1-3a9d-4fc1-b5af-81304ae74773` / `buddy_run_a2f53fd2-bc3a-4538-9d7a-a0c77b310fa6` expired after 600 seconds despite larger chain durations. The record preserves a native retry failure, `Request is no longer open`, on the second attempt. This is evidence of an existing closed receipt, not authorization to resume those production jobs.

Preserved excerpt from that revision: “native retry_run(runId=buddy_run_aedf24d1-3a9d-4fc1-b5af-81304ae74773,key=buddy-timeout-retry-ui-20260912-v1) returned error 'Request is no longer open'. No retry was created and no alternate access path was used.” Package baseline `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`, `background-work.js` / `coordination.js`, supplies the matching settlement and retry behavior. The original report already identified timeout/recovery problems; this evidence makes the historical-closed case concrete.

The original reasoning remains correct: a failed attempt and its reply must not be rewritten, stopped roots remain stopped, elapsed time cannot be refunded, and recovery must be explicit after effects inspection. Preventing new automatic failure replies alone does not give old closed failures a supported path.

## Chosen contract

Extend existing `retry_run`; do not add a fourth recovery API. When the latest attempt of managed work failed with `max_runtime_timeout`, its request was closed as `replied/failed`, and its original run/time budget remains, an authorized original sender/root requester may explicitly create one successor request. A nonblank reason is required. The team observation returns `mode: successor_request`; the owner form labels the action **Recover closed timeout**.

The old message, body, reply, evidence, acknowledgment and attempt remain immutable. A new message copies the original bounded input and original return destination. Its run retains allowed operations and the original attempt cap, links `retry_of_run_id`, and carries trusted policy references `recovery_of_message_id` and `recovery_origin_message_id`. These fields are host-written metadata in the existing sealed run policy, not new model-controlled parameters. One transaction creates the message/run, audit and command receipt. Duplicate keys return the same successor; another key on the old request points at the existing recovery.

The work-envelope calculation includes all admitted request attempts sharing the original budget reference. It retains the first admission time and original maximums. A queued successor does not refund consumed runs; its next claim consumes another run. Recovered work can continue under its own request ID while retaining the original deadline. The old message still says failed even if a later successor succeeds. Current project evidence is independently sourced.

Recovery rechecks controller identity, current audience, project supervision, original execution epoch, root stop, available budget and absence of other open managed work for that project. Completed/cancelled/superseded work cannot be reopened by this path. Destination deletion remains an admission/repair fence. An explicit original attempt cap is preserved. If the legacy policy omitted its cap and inherited the old 600-second runtime default, the successor resolves the current managed-work default inside the original wall-clock envelope. Recovery does not replace an explicit 600-second immutable cap; an increased budget or changed policy requires a separately authorized new assignment.

## Alternatives and consequences

Reopening the original message would falsify history and conflate two accepted inputs. Creating a normal new assignment would silently reset its budget and could widen policy. Rejecting all historical closed failures would leave the consumer's concrete recovery case unresolved. A full case/event engine is still unnecessary; existing immutable message IDs, sealed policy, run linkage and transactional command receipts represent the successor cleanly.

The caller receives a run whose `input_id` is the new message. It should continue inspection/retry on that successor and use the original request for historical evidence. Root cancellation still affects the entire causal family. A late historical failure delivery remains a historical fact, so recipients must consult current work/receipts before deciding further action.

## Acceptance and reconsideration

The packaged boundary fixture calls the prior runtime's real `settleBackgroundReply` method to produce `replied/failed`, then verifies an explicit successor, unchanged old receipt, duplicate prevention, preserved policy/deadline, cumulative run exhaustion and stopped-root rejection. Native in-memory MCP repeats the recovery from a later sender conversation and verifies observation linkage. These tests do not resume the reported production attempts.

Reconsider if further legacy states require ambiguous inference (for example, an explicit human cancellation mistaken for timeout) or if consumers require versioned input edits during recovery. Those require a new explicit contract rather than broadening the timeout-only predicate.
````


## S19

Source: `product/buddies/wave-sim-second-pass-2026-09-13/03-second-pass-decision.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `bd3c8d6884e22f110fa5658e21cfaaaa00fd2928d2999e9ca1d4e90c1ed16106`  
Working-tree status: `?? product/buddies/wave-sim-second-pass-2026-09-13/03-second-pass-decision.md`

Preserved lines 1–72:

````text
# Second-pass decision

September 13, 2026 local. Decision-maker: Buddies Development Lead, implementation
choice under the owner's explicit request to simulate, reassess and finish a
second code pass. This is a successor to the accepted existing-resource design;
the [pinned predecessor](sources/05-04-decision.md) preserves its rationale.

## What changed

The full CEO simulation exposes three remaining information/recovery defects:
inbox filtering after a fixed cap and excessive payloads; flattened return
receipts; and Team detail/page state persisting into the wrong scope. These are
consumer-path defects, even though the earlier creation/retry tests passed.

## Choice and alternatives

Keep projects, messages, attempts and checkpoints as the authorities. Add a compact
native inbox projection with bounded pages and full `get_message` expansion.
Apply audience filtering inside the canonical store iteration before the page
bound, and retain the legacy full service response for existing HTTP consumers.
Expose paginated structured delivery records in the shared Team observation and
both shells. Scope UI paging state to Buddy/workspace, with explicit per-run
checkpoint and delivery navigation.

Do not introduce a workflow engine, independent handoff ledger, global permission
grant, automatic artifact crawl, heartbeat protocol or GPU lease in this pass.
An explicit review request/reply already captures producer, consumer, artifact
version and verdict. A dedicated handoff entity should be reconsidered only when
real repeated queries cannot be served by those existing records. Host resource
leases and dollar meters require their own accountable integrations; displaying
invented values would weaken this workflow.

The separate former-lead permission-editor and historical repository cleanup
projects retain their existing criteria and ownership. They are not silently
closed by this CEO coordination pass. No external messages, production retries,
staff changes or GPU campaigns are implied by the simulation.

## Acceptance before claiming completion

- Native MCP: more than 200 unreadable messages cannot hide readable older work;
  pages are complete, bounded and compact; full expansion still returns the exact
  authorized body/evidence; legacy callers retain their response contract.
- Real store + MCP: failed return then retry keeps IDs, failure, acknowledgment,
  ancestry and pages; descendant metadata does not disclose private error text.
- Shared UI: rendered delivery history distinguishes failure/admission/completion;
  browser scope changes reset pages, detail navigation works, and a selected
  checkpoint survives a failed recovery submission.
- Existing real creation, two-worker aggregate-return, timeout, stopped-root,
  tombstone and bounded live-provider fixtures remain valid. Build both shared
  formats, server and client; run `tsc -b` and the client invariant gates.

Historical sources are pinned in `source-manifest.json`; inherited working source
was captured separately in local snapshot commit `8712f93` and dependency cleanup
`dc3c296`. New implementation is attributed separately. These local snapshots
are preservation evidence, not claims to authorship of inherited changes.

## Browser-discovered successor, 17:05 UTC

The real browser fixture displayed return attempt 3 before attempt 4 because both
were created in the same millisecond and SQL used random UUIDs as the tie-break.
Checkpoint versions had the same ambiguity. Preserve timestamp ordering and use
the durable insertion order for ties in attempts, deliveries and checkpoints.
A frozen-clock store regression must verify twelve sequential versions/retries.
This is an implementation correction under the same decision, not a new ledger.

## Final disclosure refinement

Recorded execution snapshots take precedence over calculated policy caps; absent
historical snapshots must be labeled as estimates. Browser inspection also led to
collapsing long return history by default while keeping persistence/count visible.
These preserve the original choice: expose existing receipts faithfully without
creating a second authority for completion or runtime configuration.
````


## S20

Source: `product/buddies/IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `311152c5aa3823a9c60af8412a89455fee47967f6100fbfd12b2fb408de98ba6`  
Working-tree status: `?? product/buddies/IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md`

Preserved lines 1–27:

````text
# Resource consistency repair — 2026-09-12

The five original defects and both adjacent variants now have passing desired-behavior regressions. The owner requested repairs and simplification; the existing resource-consolidation design remains in place.

- Message detail, inbox and run projections share the active audience predicate. Associating a private message with a project does not publish it. Unreadable execution objects are omitted in full; supervised raw provider output remains private.
- Work and run authorization is applied before paging. The run store evaluates the supplied visibility predicate while scanning, stopping after a full authorized page.
- The scoped knowledge ledger resolves effective memory for the composer, reviewer and current document tools. The first owner-thread read snapshots authorized owner defaults atomically; project/workspace turns cannot inherit them. Legacy global tools remain at the compatibility boundary.
- Continuity keys derive access state and retraction revisions from the existing immutable ledger. Ordinary learning and additions to published documents do not reset the provider; removing published content or narrowing access does. No new table or coordinator was introduced.
- Creation and continuation use the same readiness/link-repair function. A runtime in the registry does not prove linking completed. Retries keep their original creation command, reject tombstones, and stay inside the run deadline.
- Both shells share one Memory controller and an explicit audience selector. Document reads, CAS edits, notes and recall use that audience. Published references are discoverable, and a Buddy can publish work authored inside its current shared audience. Private imports and portable role changes remain owner-controlled. Shared/note refs require a name and audience.
- Buddy mail remains local durable send/reply. The nine-turn runtime test reopens the on-disk store and verifies the saved messages and replies. External email integration is outside the owner’s corrected scope.

## Verification

302 tests passed: 139 Buddy/runtime tests, 76 client tests, and 87 package tests. Two existing opt-in live tests were skipped. Shared, server and client `tsc -b`, client build, six client invariants, and whitespace checks passed. Focused Biome checks have no errors (one existing parameter-assignment warning remains).

The runtime journey exercises a lead, two returning children, another engineer assignment, memory review between turns, and the return to the original owner conversation. Separate tests cover private/published content, pagination, the HTTP Memory view, stale writes, and failures before persistence, after persistence, after registration, and after deletion. Provider events are controlled fixtures; this is not a new production team launch or live provider acceptance run.

## Simplification and delivery

The two shell files lost 216 lines of duplicated Memory orchestration. The shared controller replaces both. Across the measured application/package source changes, net line count is **+180**, including the added scope UI and regression fixes; this is a reduction in duplicate implementations, not a net code-size reduction. Tests and this report are additional.

Package source: `135aafa6ecfbf26dd17c269e2818d5db80c2f15a` on `codex/resource-repair-20260912`; archive SHA-256 `54fc8e53846dbc1fb66f101ecbc963c8dee9e442b89cbb1b797a2a88f4c9059a`. The reproducible archive and lockfile are updated. No branch was pushed. Unleashd’s existing mixed working tree remains uncommitted, with unrelated changes preserved.

[Evidence and source hashes](IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.evidence.json) identify this implementation. It succeeds the [September 11 review](REVIEW_RESOURCE_CONSOLIDATION_2026-09-11.md), whose preserved SHA-256 is `ae10cedce4bfbab0e202c44987864bda09697a4821fb6f0a86d424e2e8c9733c`. The earlier diagnostic files intentionally assert historical bugs; they remain historical evidence, while the acceptance tests live under `server/test/`.

An optional cleanup of the disconnected external-mail experiment was blocked by the destructive-command guard. Those unused files remain unchanged; no provider integration or account setup was performed.
````


## S21

Source: `docs/incident-2026-09-10-buddy-chat-timeout.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `48f41487d93ef8a0d6713e9e0cf23ca07c1fa87e0576e8935ac43204daed761b`  
Working-tree status: `?? docs/incident-2026-09-10-buddy-chat-timeout.md`

Preserved lines 1–90:

````text
# Owner Buddy chats interrupted at ten minutes

The August 4 bridge-idle fix remains intact. The September Buddy coordination
implementation introduced a separate foreground deadline: `beginBuddyChatRun`
called `claimBuddyRun` without a runtime budget and inherited its 600-second
background default. The conversation deadline callback then called `stop()`,
misreporting the automatic cancellation as “Stopped by user.”

The event_calendars attempt `2ee31483-0de9-43bb-890e-a9a06d16fd48` started at
2026-09-10 03:24:43.388 UTC, emitted text at 03:34:20.136, and stopped at
03:34:43.417. The investigation itself reproduced it: attempt
`ffba0435-deb9-43eb-a71a-0907aaa0ad57` ran from 06:16:34.233 to 06:26:34.112.
Its durable Buddy run explicitly had a 06:26:34.225 deadline.

Foreground creation now receives `TURN_MAX_RUNTIME_MS`, defaulting to 24 hours,
and passes the same budget to the durable claim. The package defaults foreground
chat creation to 24 hours too. Background claims retain their 600-second default
and one-hour ceiling. Deadline failures enter the existing `max_runtime_timeout`
path; process and event drain still precede ownership settlement. Cancellation
and expired tool authority remain enforced.

Regression coverage lives in `server/test/buddy-coordination.test.ts` (real
packaged store, authority after 11 simulated minutes, explicit budget, expiry,
cancellation, and unchanged background limits) and
`server/test/conversation-runtime.test.ts` (budget propagation, truthful timeout
cause, and joined process/event drain).

The backend reloaded cooperatively after the old turn ended. The resumed run
`buddy_run_e4e4baef-feaf-4de6-b863-1ca707abc338` started at 2026-09-10
06:29:05.864 UTC with a deadline of 2026-09-11 06:29:05.864 UTC, confirming the
new budget is loaded live. Existing attempts keep their assigned deadlines;
historical cancellation rows are retained as recorded.

Initial package source: the existing `system-finish-20260910` Buddies checkout. Its local
team-access changes are preserved; provenance marks this as a non-release local
snapshot. An earlier rebuild from the stale provenance commit omitted those
capabilities and was discarded after integration tests exposed the mismatch.

Verification: full server suite 262 passed, one opt-in test skipped, zero failures;
server TypeScript check passed. The focused runtime, package, and coordination
suite has 25 passing tests.

## End-to-end verification, September 10

The retained turn-attempt logs contain seven cancellations across three
conversations at 599.870–600.078 seconds. All seven were owner Buddy chats,
and all preceded the corrected backend loading at 06:26:35 UTC. Each had
provider text or tool activity within 27 seconds of cancellation. These were
real terminal transitions, not a frozen duration display. A general non-Buddy
conversation also completed after 903.733 seconds before the fix.

The owner's follow-up in this same conversation became the real wall-clock
test: attempt `61608db0-e4fc-45f3-8cac-0d27fa846327` started at
06:49:19.788 UTC. A read-only observer sampled authenticated conversation and
diagnostic endpoints every 15 seconds and listened to the normal WebSocket.
Across 35 samples through 07:00:44 UTC (684.459 elapsed seconds), the same
provider PID 97872 and server boot `29fd49b4-9427-476a-9fc1-16ce368797ee`
remained active, with the same attempt, running/streaming true, no terminal
cause, and no observer errors. Six WebSocket events arrived after 600 seconds.
The observer closed its own socket when its measurement finished.

The actual browser rendered **Running 11m 32s** at 07:00:53 UTC.
A native `buddy.get_runs` call succeeded at 07:00:52.767 UTC and returned
`buddy_run_275a1556-ae8b-42a7-bc39-657555ad5539` still running, with its
deadline on September 11 at 06:49:19.765 UTC. Thus the provider, runtime,
transport, rendered UI, and scoped Buddy tools all survived the former cutoff
within one uninterrupted turn. This verifies the ten-minute regression; it
does not claim a 24-hour soak test or explain unrelated interruptions.

Local evidence is in `output/timeout-e2e-20260910/`:

- `historical-cutoffs.json`: seven correlated start/end/activity records.
- `live-observation.jsonl` and `summary.json`: process, runtime and transport observations.
- `buddy-authority.json`: successful scoped calls after ten and eleven minutes.
- `after-eleven-minutes.png`: browser screenshot showing the live elapsed time.

## Preserve the fix

The failure was an omitted argument at a reused API boundary: foreground chat
creation used the same claim function as bounded background jobs. Its default
was valid for those jobs but silently became an owner-chat deadline. The August
heartbeat fix did not cover this later, independent cancellation path.

Code comments now document the invariant at `TURN_MAX_RUNTIME_MS`, the runtime
claim and deadline callback, and the milliseconds-to-seconds package handoff in
`server.ts`. `AGENTS.md` also links this incident for timer and package changes.
Keep the real packaged-store test that checks authority after eleven minutes,
explicit budgets, expiry/cancellation, and unchanged background limits, plus the
runtime test that checks budget propagation and truthful timeout cleanup. A
healthy heartbeat alone is not evidence that every layer permits a long turn.
````


## S22

Source: `docs/incident-2026-09-12-buddy-history-loss.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `e02ed4c80d3dd074ef9bbd2346127987b4200362d91e03788fbc2fbdd1ef2194`  
Working-tree status: `?? docs/incident-2026-09-12-buddy-history-loss.md`

Preserved lines 1–60:

````text
# Repeated Buddy chat history loss — September 12, 2026

Conversation: `aca48e0e-ee06-42d1-831b-5470d2c2402a` ([open chat](http://unleashd.localhost/chat/aca48e0e-ee06-42d1-831b-5470d2c2402a)).

The old messages were retained on disk but omitted from the application. Before this repair, the live detail API returned **12 messages** from the latest native Codex session. The four retained native transcripts contain **121 normalized messages**, including **9 owner prompts**; the API exposed only **3 owner prompts**. Counts include assistant tool-call records, so 121 is not a count of chat turns.

## Evidence and cause

The durable application record retains its September 10 creation date and three historical native sessions plus the current session. The live API instead reported the latest session's September 12 creation date. The missing “Fixed all seven…” response remains in the third transcript at line 480, timestamp `2026-09-12T09:11:27.477Z` (17:11 Bali time).

The latest reset follows a server restart. The repair turn finished under one server boot at `09:11:28.736Z`; a new backend started at about `09:11:41Z`. At `09:28:39.370Z` the next owner input was queued against the previous native session, but the execution was fresh and bound a new session. The later “Hello” and “hello” inputs resumed that new session normally.

Two independent mechanisms combine:

1. **Provider context:** the runtime keeps the approved Buddy audience key only in memory. After a restart it cannot prove the restored native context belongs to the current audience, so it starts a fresh native session. Real access changes also intentionally require a fresh session. This preserves the stable application chat ID and its in-memory messages at the instant of rotation.
2. **Displayed history:** the file poller replaced the entire application transcript and creation date with the current native session's messages/date. Startup hydration rejected historical bindings. Consequently a refresh or restart removed earlier display history even though both the binding records and native files survived.

The client faithfully installed the reduced server response. The client audit found no independent persistent clearing defect in HTTP detail freshness, WebSocket replacement, grouping, or virtualization.

The previous [September 12 audit](../product/buddies/AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md) already reproduced the display defect as A1. Its seven separately implemented resource repairs did not fix A1. The current investigation independently checked the exact conversation from the owner's screenshot rather than assuming that earlier report described a completed repair.

## Repair

The adapter loader resolves the durable session bindings using its existing discovery pass, including related transcripts outside the startup hydration cap. Lifecycle hydration and polling reconstruct the display transcript from these bound native sources while retaining the durable application creation date. The current native session remains the authority for provider execution metadata. Historical-session updates contribute display history without taking over the current session.

Transcript composition deduplicates inherited records using timestamp, role, content and tool details, with occurrence counts to preserve repeated messages. Missing historical files must not erase already loaded history. Active local turns retain runtime ownership during asynchronous polling.

The runtime now logs whether a Buddy session reset came from an unverified restored audience or a changed audience. It does not log the private briefing or audience-key contents.

## Remaining provider continuity behavior

This repair separates visible chat history from provider context admission. It does **not** replay the combined transcript into a freshly scoped provider session or disable the existing privacy boundary.

At initial inspection an independent rerun of the existing controlled diagnostic also confirmed A3: an unrelated peer's scheduler-pause metadata and relationships wholly in another workspace changed the installed Buddy package's audience key and unnecessarily started a fresh session. Ordinary reviewer memory writes were already covered by the earlier repair.

While this investigation ran, the active Buddy repair thread `7d9d117f-7a13-46e2-bf6a-95da591d6e2b` independently updated the loader and vendored Buddy package. Compatible edits were preserved and the combined implementation was reviewed and tested. The updated package (`234ff0f681d3f8ede511f048f74d632f23a3f49d`, archive SHA-256 `2cbb98805d5281fa08d7a5d07bcb8599f0773c38f0fe11aa10bc87099cde07ba`) derives the key from effective disclosure authority. A new independent six-turn check proves unchanged context, peer scheduler pause and unrelated-workspace relationships all resume the same native session; actual read-authority broadening and narrowing still start fresh. All 25 installed package files match the archive. [Continuity acceptance and package parity](../agent_notes/2026-09-12-aca48e0e-audience-continuity-verification.json). This closes those two reproduced unnecessary-reset triggers in the updated package.

Safely resuming across backend restarts requires more than persisting an audience-key string. Native transcripts can be appended outside Unleashd; the same native ID plus the same key would not prove that the restored context is unchanged. A future continuity record must bind the admitted audience and policy version to a verified native checkpoint after provider drain, fail closed on missing/changed files or failed persistence, and avoid transferring approval across forks or stale events. This audit does not treat that design as already implemented.

## Evidence and verification

- [Exact disk, native transcript and execution-journal audit](../agent_notes/2026-09-12-aca48e0e-disk-audit.md).
- [Client and browser audit](../agent_notes/2026-09-12-aca48e0e-client-audit.md).
- [Earlier causal audit and isolated reproduction](../agent_notes/2026-09-12-audit-history-cause.md).

The combined server regression run passes **61 tests**, covering actual native-file parsing, normalized caching, four bound sessions with startup cap 1, inherited deduplication, repeated messages, missing historical files, polling, restart, active runtime ownership, startup readiness, serialization and provider input boundaries. This includes the 22-test runtime suite and its new fresh/resume/privacy regression. A further **10** resource-consistency, knowledge-context and owner-authority tests pass against the updated package. The client audit passes **8** focused detail/grouping/submission tests: **79 distinct tests total**, without adding overlapping reruns. Server and client `tsc -b` pass, and all six client invariant gates pass.

Independent actual-target recovery used a copy of the durable config in a temporary application directory, discovery constrained to the four real native files, no normalized cache and startup cap 1. It recovered **121 messages / 9 user prompts**, the original `2026-09-10T17:19:40.782Z` creation time and unchanged current session. The original owner-controls question, seven-defect repair result and both greetings are present. Native transcript hashes and the production config were unchanged before/after. [Recovery result and source hashes](../agent_notes/2026-09-12-aca48e0e-recovery-verification.json).

Live adoption waits for the existing development watcher's idle reload boundary. At `2026-09-12T10:04:51Z`, the target API still returned 12 messages and the September 12 date; the other Buddy repair turn still owned a provider process, so forcing a restart would interrupt its work. This isolated recovery result is not a claim that the old running backend has already adopted the fix. The remaining activation and live-page check are explicitly pending the other turn's completion; the disk audit and isolated recovery verification are complete.

The starting checkout contained extensive unrelated uncommitted work, and the parallel Buddy thread continued editing the same repair. This investigation preserves compatible work and makes no Git reset, outer commit/push, native-transcript rewrite or forced backend restart.

## Live recovery follow-up — 10:12 UTC

The earlier activation limit is now superseded for the live detail API. Read-only requests at `2026-09-12T10:12:10Z` returned **121 messages / 9 user prompts** for `aca48e0e`, its original September 10 creation time and unchanged current native session. The seven-defect repair answer is present. The other agent's `7d9d117f` thread returned **1,280 rows / 50 user prompts**, its original September 9 creation time, unchanged current session and original five-defect review. Both conversations were idle. No restart was forced.

The two reports agree on the cause and repair. Their 121-versus-1,267 totals refer to different conversations (four versus five native sessions); the other thread subsequently grew to 1,280 rows as its repair turn finished. Likewise, this investigation's 79 focused tests overlap the other agent's broader 329-server/76-client run and must not be added as independent coverage. Both reports preserve the distinction between restored displayed history and the remaining conservative fresh-context behavior after an unverified backend restart.

[Live API recovery evidence](../agent_notes/2026-09-12-history-live-recovery.json). The independent browser check at approximately 10:13 UTC also passed on the exact `aca48e0e` route: scrolling confirmed the original owner-controls discussion, the “Fix it all” instruction, local-mail correction, seven-defect completion answer, lost-resume question and both latest greetings. No message was sent. Details are recorded in the [client audit](../agent_notes/2026-09-12-aca48e0e-client-audit.md).
````


## S23

Source: `shared/src/buddy-resources.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `54411920c60eb9dd74c52fd313b731c019500e946531eb738c1bb5e015588789`  
Working-tree status: `?? shared/src/buddy-resources.ts`

Preserved lines 1–5:

````text
import { z } from 'zod';
import { BuddyBackgroundExecutionSchema } from './buddy-work.js';

/** Public resource projection; the underlying store retains its own revision counters. */
export const BUDDY_RESOURCE_CONTRACT_VERSION = '2026-09-13.1';
````

Preserved lines 51–121:

````text
    preview: z.boolean().optional(),
    key: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1),
    purpose: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(32000),
    evidence: z.array(z.string().trim().min(1).max(4000)).max(32).default([]),
    workspaceId: z.string().min(1).optional(),
    notBefore: z.string().datetime().optional(),
    delivery: z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('inform'), projectId, inReplyTo: z.string().min(1).optional() })
        .strict(),
      z
        .object({
          kind: z.literal('request'),
          projectId,
          continueFrom: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('work'),
          projectId: z.string().min(1),
          maxRuns: BuddyBackgroundExecutionSchema.shape.maxRuns,
          maxDurationSeconds: BuddyBackgroundExecutionSchema.shape.maxDurationSeconds,
        })
        .strict(),
    ]),
  })
  .strict();

export function buddySendOperation(input: unknown) {
  const { delivery, ...message } = SendBuddyResourceSchema.parse(input);
  const { kind, ...settings } = delivery;
  if (delivery.kind === 'work')
    return {
      ...message,
      projectId: delivery.projectId,
      expectsReply: true,
      execution: {
        mode: 'until_done' as const,
        maxRuns: delivery.maxRuns,
        maxDurationSeconds: delivery.maxDurationSeconds,
      },
    };
  return {
    ...message,
    ...(kind === 'inform' ? { projectId: null } : {}),
    ...settings,
    expectsReply: kind === 'request',
  };
}

export const BuddyResourceSchemas = {
  get_document: GetBuddyDocumentSchema,
  update_document: UpdateBuddyDocumentSchema,
};

export const GetBuddyWorkResourceSchema = z
  .object({
    targetBuddyId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    includeClosed: z.boolean().default(false),
    limit: z.number().int().min(1).max(99).default(20),
    cursor: z
      .string()
      .regex(/^work:[0-9]+$/)
      .optional(),
  })
  .strict();
````


## S24

Source: `shared/src/buddy-work.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `c8f6bd17d852776d1358173d7f27218bd2d95f0086f6661365e0f59ec51a419a`  
Working-tree status: `?? shared/src/buddy-work.ts`

Preserved lines 1–22:

````text
import { z } from 'zod';
import { BuddyRunSchema } from './buddy-coordination.js';
import { BuddyMessageSchema } from './buddy-message.js';

export const BuddyWorkEvidenceSchema = z.array(z.string().trim().min(1).max(4000)).max(32);
export const BuddyBackgroundExecutionSchema = z
  .object({
    mode: z.literal('until_done'),
    maxRuns: z.number().int().min(1).max(100).default(20),
    maxDurationSeconds: z.number().int().min(1).max(86400).default(3600),
  })
  .strict();
export const BuddyProjectRunInputSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    maxRuns: BuddyBackgroundExecutionSchema.shape.maxRuns,
    maxDurationSeconds: BuddyBackgroundExecutionSchema.shape.maxDurationSeconds,
    parentConversationId: z.string().min(1).optional(),
  })
  .strict();
export const BuddyTodoOperationSchema = z.discriminatedUnion('operation', [
  z
````


## S25

Source: `node_modules/@nbardy/buddies/src/coordination.js`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `474608ada3e5f7fb62b15386ef5a5c068ce036f7a2a3a10e63e87d9d5d908e2a`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 109–133:

````text
  coordinationActiveCounts() {
    return this.db
      .prepare(
        "SELECT buddy_id FROM buddy_runs WHERE status IN ('claimed','running','cancel_requested') UNION ALL SELECT a.buddy_id FROM buddy_automation_runs r JOIN buddy_automations a ON r.automation_id=a.id WHERE r.status IN ('claimed','running','cancel_requested')"
      )
      .all();
  },
  beginBuddyChatRun({ buddyId, workspaceId, conversationId, projectId, allowedOperations, maxRuntimeSeconds = 24 * 60 * 60 }) {
    return this.coordinationTransaction(() => {
      const key = `chat:${randomUUID()}`;
      const run = this.enqueueBuddyRun({
        inputKey: key,
        inputKind: 'chat',
        inputId: key,
        buddyId,
        workspaceId,
        conversationId,
        projectId,
        policy: { allowed_operations: allowedOperations, foreground: true },
      });
      const claimed = this.claimBuddyRun(run.id, { claimToken: randomUUID(), conversationId, maxRuntimeSeconds });
      if (!claimed) throw new Error('Conversation execution slot is unavailable');
      return this.startBuddyRun(run.id, claimed.claim_token);
    });
  },
````

Preserved lines 461–516:

````text
  inspectBuddyAdmission({ buddyId, workspaceId, runId, conversationId, at = timestamp() }) {
    const run = runId ? this.getBuddyRun(runId) : null;
    const blockers = [];
    const add = (code, reason, remedy, resolvableBy = 'runtime') => blockers.push({ code, path: runId ?? buddyId, reason, remedy, resolvableBy });
    if (runId && (!run || run.buddy_id !== buddyId || run.workspace_id !== workspaceId)) {
      add('run_scope', 'The run does not belong to this Buddy and workspace.', 'Select the original scoped receipt.', 'owner');
      return { allowed: false, blockers };
    }
    if (run && run.status !== 'queued') add('run_not_queued', `Run is ${run.status}.`, 'Inspect the existing attempt; configuration never retries a terminal run.');
    if (run?.ready_at > at) add('not_due', `Scheduled for ${run.ready_at}.`, 'Wait until the scheduled time.');
    const buddy = this.getBuddy(buddyId), membership = this.getCoordinationMembership(buddyId, workspaceId);
    if (buddy?.status !== 'active') add('inactive_buddy', 'Recipient is not active.', 'Inspect identity lifecycle.', 'owner');
    if (!membership) add('workspace_membership_required', 'Recipient has no workspace membership.', 'Explicitly admit the identity to this workspace.', 'owner');
    if (!run?.policy.foreground && !membership?.background_enabled) add('background_disabled', 'Background execution is disabled.', 'Enable incoming work for this participant.', 'owner');
    if (!run?.policy.foreground && membership?.background_paused_reason) add('background_paused', membership.background_paused_reason, 'Inspect and resume the recorded execution pause.', 'owner');
    const active = this.coordinationActiveCounts();
    if (active.length >= 8 || (membership && active.filter(r => r.buddy_id === buddyId).length >= membership.max_active_runs))
      add('active_run_limit', 'Active run limit reached.', 'Wait for active work to drain.');
    const recent = this.db.prepare("SELECT count(*) AS n FROM buddy_runs WHERE buddy_id=? AND workspace_id=? AND started_at>=? AND COALESCE(json_extract(policy,'$.foreground'),0)=0").get(buddyId, workspaceId, new Date(Date.parse(at)-3600000).toISOString()).n;
    if (!run?.policy.foreground && membership && recent >= membership.max_background_runs_per_hour) add('hourly_run_limit', 'Hourly run limit reached.', 'Review the hourly budget and resume after its window.', 'owner');
    if (run && !run.policy.foreground) {
      try { this.assertProjectExecution(run.project_id, run.project_epochs, { admission: true }); }
      catch (error) { add('project_gate', error.message, 'Inspect canonical project state and the original execution epoch.', 'lead'); }
    }
    if (run?.after_run_id && this.getBuddyRun(run.after_run_id)?.status !== 'complete') add('predecessor', 'Waiting for the source run to complete successfully.', 'Inspect the original predecessor run.');
    if (run?.root_message_id && this.getMessage(run.root_message_id)?.root_stopped_at) add('root_stopped', 'The message root was stopped.', 'Inspect the stop receipt; do not restart by reconfiguring staff.', 'owner');
    if (run?.input_kind === 'schedule' && this.db.prepare("SELECT 1 FROM buddy_runs WHERE input_kind='schedule' AND input_id=? AND status IN ('claimed','running','cancel_requested')").get(run.input_id)) add('schedule_running', 'This schedule already has an active run.', 'Wait for its current run to drain.');
    const target = run?.conversation_id ?? conversationId;
    if (target && this.db.prepare("SELECT 1 FROM buddy_runs WHERE conversation_id=? AND status IN ('claimed','running','cancel_requested')").get(target)) add('conversation_busy', 'The destination conversation has an active turn.', 'Wait for that turn to drain.');
    return { allowed: !blockers.length, blockers };
  },

  claimBuddyRun(id, { claimToken, conversationId, maxRuntimeSeconds = 600, now = timestamp() }) {
    return this.coordinationTransaction(() => {
      const run = this.getBuddyRun(id);
      if (!run || run.status !== 'queued' || run.ready_at > now) return null;
      const admission = this.inspectBuddyAdmission({buddyId:run.buddy_id,workspaceId:run.workspace_id,runId:id,conversationId,at:now});
      if (!admission.allowed) {
        const blocker = admission.blockers[0];
        if (blocker.code === 'hourly_run_limit') this.setCoordinationMembership(run.buddy_id,run.workspace_id,{background_paused_reason:'Hourly run limit reached'});
        if (blocker.code === 'project_gate') this.assertProjectExecution(run.project_id,run.project_epochs,{admission:true});
        this.holdBuddyRun(id,blocker.reason);
        return null;
      }
      const target = run.conversation_id ?? required(conversationId, 'Conversation ID');
      if (conversationId && run.conversation_id && run.conversation_id !== conversationId)
        throw new Error('Run destination cannot be changed during claim');
      // Foreground chats share the application turn budget; background limits remain separate.
      const maxAllowedSeconds = run.input_kind === 'chat' && run.policy.foreground ? 24 * 60 * 60 : 3600;
      if (!Number.isFinite(maxRuntimeSeconds) || maxRuntimeSeconds < 1 || maxRuntimeSeconds > maxAllowedSeconds)
        throw new Error('Invalid runtime limit');
      const background = run.input_kind === 'message_request' ? this.getBackgroundWork(run.input_id) : null;
      if (background && (background.message.status === 'replied' || (background.deadline && background.deadline <= now) || background.runsUsed >= background.execution.maxRuns)) { this.reconcileBackgroundWork(run.input_id); return null; }
      const deadline = new Date(Math.min(Date.parse(now) + maxRuntimeSeconds * 1000, background?.deadline ? Date.parse(background.deadline) : background ? Date.parse(now) + background.execution.maxDurationSeconds * 1000 : Infinity)).toISOString();
      this.db
        .prepare(
````


## S26

Source: `node_modules/@nbardy/buddies/src/coordination-work.js`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `cca05dae7bbd597f05cccdf3325e973fba0379cf9fd87b3447054a207ce83b3c`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 1–92:

````text
import { randomUUID } from 'node:crypto';
const now = () => new Date().toISOString();

export function migrateCoordinationWork(db) {
  const add = (table, name, definition) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  add('owned_projects', 'parent_project_id', 'TEXT REFERENCES owned_projects(id)');
  add('owned_projects', 'revision', 'INTEGER NOT NULL DEFAULT 1');
  add(
    'owned_projects',
    'execution_state',
    "TEXT NOT NULL DEFAULT 'enabled' CHECK(execution_state IN ('enabled','paused','draining','cancelled'))"
  );
  add('owned_projects', 'execution_epoch', 'INTEGER NOT NULL DEFAULT 1');
  add('owned_projects', 'pending_owner_id', 'TEXT REFERENCES buddies(id)');
  add('owned_projects', 'completion_evidence', "TEXT NOT NULL DEFAULT '[]'");
  add('buddy_runs', 'project_epochs', "TEXT NOT NULL DEFAULT '[]'");
  for (const [name, type] of Object.entries({
    read_all_work: 'INTEGER NOT NULL DEFAULT 0',
    dispatch: 'INTEGER NOT NULL DEFAULT 1',
    background_enabled: 'INTEGER NOT NULL DEFAULT 0',
    max_active_runs: 'INTEGER NOT NULL DEFAULT 2',
    max_background_runs_per_hour: 'INTEGER NOT NULL DEFAULT 30',
    max_sends_per_hour: 'INTEGER NOT NULL DEFAULT 100',
    max_pending_runs: 'INTEGER NOT NULL DEFAULT 100',
    background_paused_reason: 'TEXT',
  }))
    add('buddy_projects', name, type);
}

export const coordinationWorkMethods = {
  reparentBuddy(buddyId, { managerId, key }) {
    const buddy = this.getBuddy(buddyId),
      manager = this.getBuddy(managerId);
    if (!buddy || !manager || buddy.status === 'archived' || manager.status !== 'active')
      throw new Error('Both staff identities must be available');
    return this.coordinationCommand(
      { actor: 'owner', workspaceId: buddy.project_id, key, payload: { buddyId, managerId } },
      () => {
        if (!this.getCoordinationMembership(managerId, buddy.project_id))
          throw new Error('Manager must belong to the report home workspace');
        this.db
          .prepare(
            "DELETE FROM buddy_relationships WHERE (kind='manager' AND to_buddy_id=?) OR (kind='reports_to' AND from_buddy_id=?)"
          )
          .run(buddyId, buddyId);
        const edge = this.setBuddyRelationship({
          fromBuddy: managerId,
          toBuddy: buddyId,
          kind: 'manager',
        });
        this.recordAuditEvent({
          buddy: buddyId,
          workspace: buddy.project_id,
          operation: 'buddy.reparent',
          payload: { managerId },
        });
        return edge;
      }
    );
  },

  getCoordinationMembership(buddyId, workspaceId) {
    return (
      this.db
        .prepare('SELECT * FROM buddy_projects WHERE buddy_id=? AND project_id=?')
        .get(buddyId, workspaceId) ?? null
    );
  },

  // Host-only: scoped agent tools never expose this mutation.
  setCoordinationMembership(buddyId, workspaceId, patch) {
    return this.coordinationTransaction(() => {
      if (!this.getCoordinationMembership(buddyId, workspaceId))
        throw new Error('Membership not found');
      const allowed = [
        'read_all_work',
        'dispatch',
        'background_enabled',
        'max_active_runs',
        'max_background_runs_per_hour',
        'max_sends_per_hour',
        'max_pending_runs',
        'background_paused_reason',
      ];
````


## S27

Source: `node_modules/@nbardy/buddies/src/background-work.js`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `8837de54fc1078d7a86b53d5e6a8571770d0adcde487f435ebe3c29606df1f4f`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 23–76:

````text
	}
}

export function normalizeBackgroundExecution(input) {
	if (input === undefined) return undefined;
	if (
		!input ||
		input.mode !== "until_done" ||
		Object.keys(input).some(
			(k) => !["mode", "maxRuns", "maxDurationSeconds"].includes(k),
		)
	)
		throw new Error("Invalid background execution configuration");
	const { maxRuns = 20, maxDurationSeconds = 3600 } = input;
	if (
		!Number.isInteger(maxRuns) ||
		maxRuns < 1 ||
		maxRuns > 100 ||
		!Number.isInteger(maxDurationSeconds) ||
		maxDurationSeconds < 1 ||
		maxDurationSeconds > 86400
	)
		throw new Error("Background execution limits are out of bounds");
	return { mode: "until_done", maxRuns, maxDurationSeconds };
}

export const backgroundWorkMethods = {
	getBackgroundWork(messageId) {
		const rows = this.db
			.prepare(
				"SELECT id FROM buddy_runs WHERE input_kind='message_request' AND input_id=? ORDER BY rowid",
			)
			.all(messageId);
		const runs = rows.map((r) => this.getBuddyRun(r.id));
		const execution = runs[0]?.policy.execution;
		if (execution?.mode !== "until_done") return null;
		const message = this.getMessage(messageId);
		const project = this.getBuddyProject(message.buddy_project_id);
		const admitted = runs.filter((r) => r.started_at);
		const budgetOrigin = runs[0]?.policy.recovery_origin_message_id ?? messageId;
    const budgetAdmitted = this.db.prepare(`SELECT started_at FROM buddy_runs
      WHERE input_kind='message_request' AND started_at IS NOT NULL
      AND (input_id=? OR json_extract(policy,'$.recovery_origin_message_id')=?)`).all(budgetOrigin,budgetOrigin);
    const startedAt = budgetAdmitted.map((r) => r.started_at).sort()[0] ?? null;
		const deadline = startedAt
			? new Date(
					Date.parse(startedAt) + execution.maxDurationSeconds * 1000,
				).toISOString()
			: null;
		const children = this.db
			.prepare(`SELECT m.id FROM buddy_messages m JOIN buddy_runs r ON m.caused_by_run_id=r.id
      WHERE r.input_kind='message_request' AND r.input_id=? AND m.expects_reply=1 AND m.id<>?`)
			.all(messageId, messageId)
			.map((m) => this.getMessage(m.id));
````

Preserved lines 108–173:

````text
		let reason = null;
		if (message.status === "replied") disposition = message.outcome;
		else if (
			message.status === "cancelled" ||
			this.getMessage(message.root_message_id)?.root_stopped_at
		)
			disposition = "cancelled";
		else if (runs.some((r) => active.has(r.status))) disposition = "running";
		else if (latest?.status === "failed" || latest?.status === "cancelled") {
			disposition = latest.status === "failed" && latest.error_code === "max_runtime_timeout" &&
        budgetAdmitted.length < execution.maxRuns && (!deadline || deadline > now()) ? "recoverable" : latest.status;
			reason =
				latest.error ||
				`Last attempt ${latest.status}; inspect effects before retrying.`;
		} else if (complete) disposition = "done";
		else if (!project || project.buddy_id !== message.to_buddy_id) {
			disposition = "blocked";
			reason = "Project ownership no longer matches the assigned recipient.";
		} else if (
			project.status === "cancelled" ||
			project.execution_state === "cancelled"
		)
			disposition = "cancelled";
		else if (project.status === "blocked") {
			disposition = "blocked";
			reason = project.blocked_reason || "Project is blocked.";
		} else if (
			!waiting.length &&
			!unreadChildResult &&
			unfinishedTodos.length &&
			unfinishedTodos.every((t) => t.status === "blocked")
		) {
			disposition = "blocked";
			reason = unfinishedTodos
				.map((t) => `${t.title}: ${t.blocked_reason}`)
				.join("; ");
		} else if (deadline && deadline <= now()) {
			disposition = "limit_reached";
			reason = "Background work duration limit reached.";
		} else if (
			project.execution_state !== "enabled" ||
			this.projectAncestors(project.id).some(
				(p) => p.execution_state !== "enabled",
			)
		) {
			disposition = "held";
			reason = "Project execution is paused or transferring ownership.";
		} else if (budgetAdmitted.length >= execution.maxRuns) {
			disposition = "limit_reached";
			reason = "Background work run limit reached.";
		} else if (waiting.length) {
			disposition = "waiting";
			reason = "Waiting for replies to delegated work.";
		} else if (runs.some((r) => r.status === "queued")) disposition = "queued";
		else if (latest?.error_code === "continuation_held") {
			disposition = "held";
			reason = latest.error;
		}
		return {
			message,
			project,
			runs,
			latest,
			complete,
			reason,
			execution,
````


## S28

Source: `server/src/conversations/runtime.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `54386f62e2127833c3e48f7fa5158cde498bac7fe0c3d098a2429376a879eb35`  
Working-tree status: `M server/src/conversations/runtime.ts`

Preserved lines 84–107:

````text
  prefixInjected: boolean;
};

export type MergeChildMeta = {
  parentConversationId: string;
  reviewUuid: string;
};

const BUDDY_CHAT_CAPACITY_RETRY_MS = 1_000;

class BuddyChatCapacityUnavailableError extends Error {
  constructor() {
    super('Conversation execution slot is unavailable');
    this.name = 'BuddyChatCapacityUnavailableError';
  }
}

function isBuddyChatCapacityUnavailable(error: unknown): boolean {
  return (
    error instanceof BuddyChatCapacityUnavailableError ||
    (error instanceof Error && error.message === 'Conversation execution slot is unavailable')
  );
}

````

Preserved lines 988–1020:

````text
          !this.buddyContext.automationRunId &&
          !this._coordinationExecution &&
          dependencies.beginBuddyChatRun
        ) {
          // Foreground tool authority must cover the provider's explicit runtime
          // budget. Omitting it inherited claimBuddyRun's background default (600s),
          // killing active owner chats on 2026-09-10 even with healthy heartbeats.
          // Preserve this argument when refactoring or replacing the Buddy package.
          // Guards: buddy-coordination.test.ts and conversation-runtime.test.ts;
          // history: docs/incident-2026-09-10-buddy-chat-timeout.md.
          const owned = dependencies.beginBuddyChatRun(
            this.contextForInput(turnInput)!,
            this.id,
            TURN_MAX_RUNTIME_MS
          );
          this._coordinationExecution = {
            context: { ...this.contextForInput(turnInput)!, coordinationRunId: owned.id },
            claimToken: owned.claim_token,
          };
          const timer = setTimeout(
            () => {
              // Automatic expiry is max_runtime_timeout. stop() records user_stop
              // and hid the 600s regression; retain timeout cleanup and joined drain.
              this._handleTurnTimeout('max');
            },
            Math.max(0, Date.parse(owned.deadline) - Date.now())
          );
          const settle = (status: 'complete' | 'failed', detail: string) => {
            clearTimeout(timer);
            this.off('buddy-turn-complete', complete);
            this.off('buddy-turn-failed', failed);
            this._coordinationExecution = null;
            try {
````

Preserved lines 1119–1138:

````text
                  } as ExecuteCommandRequest)
        );
      } catch (error) {
        dependencies.revokeBuddyControlCapability?.(this.id);
        this._finishTurnAttempt('failed', 'spawn_failed');
        if (isBuddyChatCapacityUnavailable(error)) {
          // A foreground Buddy run can temporarily lose admission to another
          // active turn for the same employee. The app queue is the durable
          // user-facing waiting state: do not also leave behind a phantom user
          // message and a terminal "failed to start" status. processQueue()
          // will restore a queued attempt and retry after capacity can drain.
          if (this.messages.at(-1)?.role === 'user') this.messages.pop();
          broadcast({
            type: 'conversation_updated',
            reason: 'status',
            conversation: this.toJSON(),
          });
          throw new BuddyChatCapacityUnavailableError();
        }
        const message = error instanceof Error ? error.message : String(error);
````

Preserved lines 2946–3013:

````text
    processQueue(): void {
      if (this.buddyContext?.automationRunId) {
        // Old persisted queue state must not become an authority bypass after
        // restart. User admission is closed on every automation transcript.
        this.clearQueue();
        return;
      }
      if (this.process || this.isRunning) return;
      if (this.queue.length === 0) return;

      const next = this.queue[0];
      if (next.status === 'sending') return; // already in flight

      next.status = 'sending';
      let attemptId = this._queuedAttemptIds.get(next.id);
      if (!attemptId) {
        attemptId = crypto.randomUUID();
        this._queuedAttemptIds.set(next.id, attemptId);
        turnAttempts.queued({
          attemptId,
          conversationId: this.id,
          queueMessageId: next.id,
          providerSessionId: this.sessionId,
        });
      }
      this._nextAttempt = { attemptId, queueMessageId: next.id };
      console.log(
        `[${this.id}] processQueue sending id=${next.id.substring(0, 8)}, queueDepth=${this.queue.length}, contentLen=${next.content.length}, preview="${formatLogPreview(next.content)}"`
      );
      this.broadcastQueue();
      try {
        const ownerInput = this._queuedOwnerInputs.get(next.id);
        this.sendMessage(next.content, ownerInput);
        // Keep trusted input provenance while preflight leaves this item pending.
        // It is consumed only after provider admission, never serialized for restore.
        if (this.process || this.isRunning) this._queuedOwnerInputs.delete(next.id);
      } catch (error) {
        // Provider admission can still fail synchronously at a future seam.
        // Never strand the queue head in "sending" when no process exists.
        if (this.queue[0] === next && next.status === 'sending') {
          next.status = 'pending';
          this.broadcastQueue();
        }
        if (error instanceof BuddyChatCapacityUnavailableError) {
          // _finishTurnAttempt removed the failed start's queue mapping. Publish
          // a fresh queued attempt immediately so diagnostics describe the
          // current waiting state, then retry without requiring another send.
          if (!this._queuedAttemptIds.has(next.id)) {
            const retryAttemptId = crypto.randomUUID();
            this._queuedAttemptIds.set(next.id, retryAttemptId);
            turnAttempts.queued({
              attemptId: retryAttemptId,
              conversationId: this.id,
              queueMessageId: next.id,
              providerSessionId: this.sessionId,
            });
          }
          if (!this._queueCapacityRetryTimer) {
            this._queueCapacityRetryTimer = setTimeout(() => {
              this._queueCapacityRetryTimer = null;
              this.processQueue();
            }, BUDDY_CHAT_CAPACITY_RETRY_MS);
            this._queueCapacityRetryTimer.unref?.();
          }
          return;
        }
        throw error;
      }
````


## S29

Source: `server/src/buddies/integration.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `e93867fa7d9c5eaca4fd05570b6673fe9675380e1927b958c8b1a7d888272a15`  
Working-tree status: `M server/src/buddies/integration.ts`

Preserved lines 378–400:

````text
        `Buddy briefing exceeds its ${BUDDY_BRIEFING_MAX_CHARACTERS}-character composition budget`
      );
    }
    return {
      context,
      briefing,
      audienceKey,
      memoryGeneration: `memory-generation:${memory.generation}:working:${memory.workingRevision}:long-term:${memory.longTermRevision}:identity:${createHash(
        'sha256'
      )
        .update(JSON.stringify([detail.buddy.name, detail.buddy.role, roleBrief, audience]))
        .digest('hex')}`,
      workingDirectory: detail.workspace.root_path,
      provider: (detail.buddy.provider || 'codex') as Provider,
      model: detail.buddy.model || undefined,
      reasoningEffort: detail.buddy.reasoning_effort || undefined,
    };
  }

  function updateStatus(
    conversation: BuddyConversationPort,
    status: 'active' | 'complete' | 'failed' | 'cancelled'
  ): void {
````


## S30

Source: `server/src/conversations/creation-service.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `0c1835d58f7028efcbec3ab59d559be10ca5433f1926f5b4bfcaa47a7d98fd3f`  
Working-tree status: `?? server/src/conversations/creation-service.ts`

Preserved lines 52–67:

````text
    )
    .digest('hex');
}

/** One creation boundary for chat, Builder, delegation and schedules.
 * Creation is inert: input dispatch belongs to the caller's admission path.
 */
export function createConversationService(ports: ConversationCreationPorts) {
  const linking = new Map<string, Promise<void>>();
  const linked = new WeakSet<ConversationRuntime>();
  async function createOrReuse(input: CreateConversationInput): Promise<ConversationRuntime> {
    // Even a registry hit must validate the durable command and tombstone.
    const creation = await ports.configService.createOrReplay({
      conversationId: input.conversationId,
      workingDirectory: input.workingDirectory,
      config: input.config,
````

Preserved lines 92–132:

````text
        buddyContext: input.buddyContext,
        buddyBriefing: input.buddyBriefing,
        purpose: input.purpose,
        automationClaimToken: input.automationClaimToken,
      });
      ports.registerConversation(conversation);
    }
    return ensureReady(conversation, creation.record);
  }

  async function ensureReady(
    conversation: ConversationRuntime,
    verifiedRecord?: Awaited<ReturnType<ConversationCreationPorts['configService']['getRecord']>>
  ): Promise<ConversationRuntime> {
    const record = verifiedRecord ?? (await ports.configService.getRecord(conversation.id));
    if (!record || record.status === 'deleted')
      throw new Error('Conversation is missing or deleted');
    if (ports.getConversation(conversation.id) !== conversation)
      throw new Error('Conversation is no longer registered or was replaced');
    // The link write is keyed in its store. Retrying a partial creation repairs
    // this projection before the caller may acknowledge or admit input.
    if (linked.has(conversation)) return conversation;
    let link = linking.get(conversation.id);
    if (!link) {
      link = ports.createConversationLink(conversation);
      linking.set(conversation.id, link);
    }
    try {
      await link;
      // Deletion may win while linking is suspended. A successful projection
      // write does not keep the original runtime or durable record alive.
      const current = await ports.configService.getRecord(conversation.id);
      if (!current || current.status === 'deleted')
        throw new Error('Conversation is missing or deleted');
      if (ports.getConversation(conversation.id) !== conversation)
        throw new Error('Conversation is no longer registered or was replaced');
      linked.add(conversation);
    } finally {
      if (linking.get(conversation.id) === link) linking.delete(conversation.id);
    }
    return conversation;
````


## S31

Source: `vendor/nbardy-buddies-0.1.0.provenance.json`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `36b3da72036a5c0fdddf4ef71e2a5328a653ed7f3beff34002fb0b62a838b904`  
Working-tree status: `M vendor/nbardy-buddies-0.1.0.provenance.json`

Preserved lines 1–16:

````text
{
  "schemaVersion": 2,
  "package": "@nbardy/buddies",
  "version": "0.1.0",
  "archive": "vendor/nbardy-buddies-0.1.0.tgz",
  "sha256": "76fda9860849fe0e95d2655426c74dbe440718dc2691342e1e192dcc26be43cd",
  "reproduciblePack": true,
  "sourceCommit": "b70c0def1373034aeff56e409adb97d66ff6d7f7",
  "sourceDirty": false,
  "sourceStatus": [],
  "manifest": {
    "packageFiles": [
      "README.md",
      "bin/buddies.js",
      "profiles/growth-engineer/BUDDY_SOUL.md",
      "profiles/growth-engineer/skills/email-growth-engineering.md",
````


## S32

Source: `tools/vendor-buddies.mjs`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `5df27390e9d39d0ce2fb421db87ea095368988e89dd3b867cac64aa7a2222cf6`  
Working-tree status: `unchanged tracked or ignored; see path`

Preserved lines 1–58:

````text
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configuredSourceRoot = process.env.BUDDIES_SOURCE_DIR;
const sourceCandidates = configuredSourceRoot
  ? [configuredSourceRoot]
  : [
      join(repositoryRoot, '..', 'buddies'),
      join(repositoryRoot, '..', '..', 'buddies'),
      join(repositoryRoot, '..', '..', '..', 'buddies'),
    ];
const sourceRoot = resolve(
  sourceCandidates.find((candidate) => existsSync(join(candidate, 'package.json'))) ??
    sourceCandidates[0]
);
const allowUncommitted = process.argv.includes('--allow-uncommitted');

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function npmManifest(cwd) {
  const output = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], cwd);
  const manifests = JSON.parse(output);
  if (!Array.isArray(manifests) || manifests.length !== 1 || !Array.isArray(manifests[0].files)) {
    throw new Error('npm pack dry-run did not return one manifest with files');
  }
  return manifests[0];
````

Preserved lines 126–191:

````text

if ((!sourceCommit || sourceDirty) && !allowUncommitted) {
  throw new Error(
    'Buddies source must have a clean commit before release packaging. ' +
      'Use --allow-uncommitted only for an explicitly non-release local snapshot.'
  );
}

const trackedPaths = new Set(
  run('git', ['ls-files', '-z'], sourceRoot).split('\0').filter(Boolean)
);
const manifest = validateManifest(npmManifest(sourceRoot), trackedPaths);

const firstPackRoot = mkdtempSync(join(tmpdir(), 'unleashd-buddies-pack-a-'));
const secondPackRoot = mkdtempSync(join(tmpdir(), 'unleashd-buddies-pack-b-'));

try {
  const firstName = run(
    'npm',
    ['pack', '--silent', '--pack-destination', firstPackRoot],
    sourceRoot
  )
    .split('\n')
    .at(-1);
  const secondName = run(
    'npm',
    ['pack', '--silent', '--pack-destination', secondPackRoot],
    sourceRoot
  )
    .split('\n')
    .at(-1);
  if (!firstName || !secondName || firstName !== secondName) {
    throw new Error('npm pack did not produce one stable archive name');
  }

  const firstArchive = join(firstPackRoot, firstName);
  const secondArchive = join(secondPackRoot, secondName);
  const firstHash = sha256(firstArchive);
  const secondHash = sha256(secondArchive);
  if (firstHash !== secondHash) {
    throw new Error(`Buddies package is not reproducible: ${firstHash} != ${secondHash}`);
  }

  const firstArchiveFiles = archiveFiles(firstArchive);
  if (sha256Json(firstArchiveFiles) !== manifest.sha256) {
    throw new Error('npm pack archive contents do not match its dry-run manifest');
  }

  const destination = join(repositoryRoot, 'vendor', firstName);
  copyFileSync(firstArchive, destination);
  const provenancePath = join(
    repositoryRoot,
    'vendor',
    `${basename(firstName, '.tgz')}.provenance.json`
  );
  writeFileSync(
    provenancePath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        package: packageJson.name,
        version: packageJson.version,
        archive: `vendor/${firstName}`,
        sha256: firstHash,
        reproduciblePack: true,
        sourceCommit,
````


## S33

Source: `server/test/conversation-runtime.test.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `0b2bf2affcb6c68c4328778885cfe981facd029f9d34e0a41d056299116520d0`  
Working-tree status: `M server/test/conversation-runtime.test.ts`

Preserved lines 430–540:

````text

test('unsupported Buddy provider leaves a queued message retryable', () => {
  const fixture = runtimeFixture({ provider: 'gemini' });
  const conversation = new fixture.Conversation({
    id: 'gemini-buddy',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: {
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      buddyProjectId: null,
      legacyWorkItemId: null,
      automationRunId: null,
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
      allowedBuddyOperations: ['read'],
    },
  });

  assert.equal(conversation.kind.kind, 'buddy');
  conversation.enqueueMessage('Hello Buddy');

  assert.equal(conversation.isRunning, false);
  assert.equal(conversation.hasActiveProcess(), false);
  assert.equal(conversation.queue[0]?.status, 'pending');
  assert.match(
    conversation.messages.at(-1)?.content ?? '',
    /cannot start Buddy conversations.*required Buddy state tools/
  );
});

test('foreground Buddy capacity waits in the queue and starts without another send', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let admissions = 0;
  let providerStarts = 0;
  const fixture = runtimeFixture({
    buddyContext: {
      buddyId: 'busy-buddy',
      workspaceId: 'workspace-1',
    },
    beginBuddyChatRun: () => {
      admissions += 1;
      if (admissions === 1) throw new Error('Conversation execution slot is unavailable');
      return {
        id: 'foreground-run',
        claim_token: 'claim-token',
        deadline: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    executeTurn: (() => {
      providerStarts += 1;
      return {
        child: { exitCode: 0 },
        events: (async function* () {
          yield { type: 'turn.started' as const };
          yield { type: 'text.delta' as const, text: 'Started after capacity drained' };
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: Promise.resolve({
          exitCode: 0,
          signal: null,
          reason: 'success' as const,
          sessionId: 'provider-session',
        }),
        stop: () => undefined,
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });

  fixture.conversation.enqueueMessage('Start when capacity is available', {
    origin: 'owner_input',
    inputId: 'owner-message',
  });

  assert.equal(admissions, 1);
  assert.equal(providerStarts, 0);
  assert.equal(fixture.conversation.queue[0]?.status, 'pending');
  assert.equal(fixture.conversation.messages.length, 0);

  t.mock.timers.tick(1_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(admissions, 2);
  assert.equal(providerStarts, 1);
  assert.equal(fixture.conversation.queue.length, 0);
  assert.equal(fixture.conversation.messages[0]?.content, 'Start when capacity is available');
  assert.equal(fixture.conversation.messages.at(-1)?.content, 'Started after capacity drained');
});

test('historical automation transcripts refuse every user turn-admission path', () => {
  let providerStarts = 0;
  const fixture = runtimeFixture({
    executeTurn: (() => {
      providerStarts += 1;
      throw new Error('must not start');
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
    id: 'automation-history',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: {
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      automationRunId: 'terminal-run',
    },
  });

  conversation.sendMessage('Continue this completed automation');
  conversation.enqueueMessage('Queue work on this completed automation');
````


## S34

Source: `server/src/buddies/run-executor.ts`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `40d4919568b280cfb605b7b8e44e6d9ba453add91babde10ef7b0e015f98bd89`  
Working-tree status: `?? server/src/buddies/run-executor.ts`

Preserved lines 1–80:

````text
import { randomUUID } from 'node:crypto';
import type { BuddyContext, BuddyMessage } from '@unleashd/shared';
import type { ConversationRuntime } from '../conversations/runtime';
import type { BuddiesStorePort, BuddyAutomation } from './contract';
import {
  type CoordinationStore,
  type PrivateBuddyRun,
  coordinationStore,
} from './coordination-store';
import { MESSAGE_BUDDY_OPERATIONS } from './operations';

export interface BuddyRunExecutorPorts {
  store: BuddiesStorePort;
  cancelLegacyRun?(id: string): Promise<unknown>;
  getConversation(id: string): ConversationRuntime | undefined;
  ensureConversationReady?(conversation: ConversationRuntime): Promise<ConversationRuntime>;
  createConversation(input: {
    context: BuddyContext;
    initialMessage?: string;
    placement?: 'default' | 'background';
    commandId: string;
    conversationId: string;
    deferInitialMessage: boolean;
  }): Promise<ConversationRuntime>;
}

/** Driven by BuddyScheduler's existing clock/admission lifecycle; owns no timer. */
export class BuddyRunExecutor {
  private readonly store: CoordinationStore;
  private readonly active = new Map<
    string,
    { conversation?: ConversationRuntime; task: Promise<void> }
  >();

  constructor(private readonly ports: BuddyRunExecutorPorts) {
    this.store = coordinationStore(ports.store);
  }

  get activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  runScheduleNow(automation: BuddyAutomation, key: string): PrivateBuddyRun {
    const payload = automation.job_payload as { prompt: string; conversationId: string };
    if (automation.job_kind !== 'prompt' || !payload.conversationId)
      throw new Error('Thread schedule requires a prompt and destination');
    return this.store.enqueueBuddyRun({
      inputKey: `schedule:${automation.id}:manual:${key}`,
      inputKind: 'schedule',
      inputId: automation.id,
      buddyId: automation.buddy_id,
      workspaceId: automation.workspace_id,
      conversationId: payload.conversationId,
      projectId: automation.buddy_project_id,
      policy: {
        allowed_operations: automation.policy.allowed_operations.filter((op) =>
          MESSAGE_BUDDY_OPERATIONS.includes(op as never)
        ),
        prompt: payload.prompt,
        max_runtime_seconds: automation.policy.max_runtime_seconds,
      },
    });
  }

  enqueueSchedule(automation: BuddyAutomation, nextRunAt: string): void {
    const payload = automation.job_payload as { prompt?: string; conversationId?: string };
    if (automation.job_kind !== 'prompt' || !payload.conversationId || !payload.prompt)
      throw new Error('Thread schedules require a prompt and conversationId');
    this.store.coordinationTransaction(() => {
      // Coalesce missed/busy ticks into one outstanding occurrence.
      let outstanding = false;
      for (let offset = 0; ; offset += 100) {
        const page = this.store.listBuddyRuns({
          buddyId: automation.buddy_id,
          workspaceId: automation.workspace_id,
          limit: 100,
          offset,
        });
        outstanding ||= page.some(
          (r) =>
````

Preserved lines 118–168:

````text
    const recoverable: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = this.store.listBuddyRuns({ limit: 100, offset });
      for (const r of page)
        if (
          ['claimed', 'running', 'cancel_requested'].includes(r.status) &&
          !this.active.has(r.id)
        ) {
          const c = r.conversation_id ? this.ports.getConversation(r.conversation_id) : undefined;
          if (r.status === 'cancel_requested' && c?.hasActiveProcess()) c.stop();
          if (c && !c.hasActiveProcess() && !c.isRunning && !c.queue.length) recoverable.push(r.id);
        }
      if (page.length < 100) break;
    }
    this.store.recoverBuddyRuns({ confirmedDrainedIds: recoverable });
    try {
      this.store.finishProjectHandoffs();
    } catch (error) {
      console.error('[buddies] Project handoff is waiting', error);
    }
    for (const [id, execution] of this.active) {
      const run = this.store.getBuddyRun(id);
      const membership = run
        ? this.store.getCoordinationMembership(run.buddy_id, run.workspace_id)
        : null;
      if (
        run &&
        (!membership?.background_enabled ||
          membership.background_paused_reason ||
          this.store.getBuddy(run.buddy_id)?.status !== 'active' ||
          (run.input_kind === 'schedule' && !this.store.getAutomation(run.input_id)?.enabled))
      )
        this.store.cancelBuddyRun(id);
      if (this.store.getBuddyRun(id)?.status === 'cancel_requested') execution.conversation?.stop();
    }
    const candidates: PrivateBuddyRun[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = this.store.listBuddyRuns({ status: 'queued', limit: 100, offset });
      candidates.push(...page);
      if (page.length < 100) break;
    }
    for (const candidate of candidates) {
      if (this.active.has(candidate.id) || this.active.size >= 8) continue;
      const membership = this.store.getCoordinationMembership(
        candidate.buddy_id,
        candidate.workspace_id
      );
      if (!membership?.background_enabled || membership.background_paused_reason) {
        this.store.holdBuddyRun(
          candidate.id,
          String(membership?.background_paused_reason ?? 'Background execution is disabled')
````


## S35

Source: `product/buddies/IMPLEMENTATION_READINESS_PRIVACY_2026-09-12.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `8e305a26a36faf648c860c7cc714d973c5715da80b9acb77b32e19e45f4c3e39`  
Working-tree status: `?? product/buddies/IMPLEMENTATION_READINESS_PRIVACY_2026-09-12.md`

Preserved lines 1–40:

````text
# Readiness receipt privacy repair — 2026-09-12

Successor to A2 in `AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md` and the readiness
review. Historical source: isolated baseline commit
`4c6835b53190a64650c8948ac67f7fd6badbf1ed`, including the unchanged audited
`server/src/buddies/team-readiness.ts`. That baseline preserves existing concurrent
work; it is not new work authored by this repair.

Question: may a Buddy's unrelated team turn inspect a participant-private
execution merely because the persistent identity participated in its message?
Choice: no. The owner authorized continued development and commits on September 12;
the Development Lead selected this implementation within the existing audience
design. This is an implementation decision, not a new grant or architecture change.

`get_capabilities` now receives the existing message-audience predicate from
`BuddyOperationsService`. It filters messages before deriving target identities,
receipts, admission checks, run-policy blockers and return paths. The existing
participant and selected-workspace checks still apply. A rejected message produces
one generic `message_scope` blocker. The requested workspace cannot replace the
trusted conversation audience used by the predicate.

This reuses the policy already used by `get_message`, inbox and run projections.
Redacting only `execution.error` would leave other private fields and derived
blockers exposed. Reimplementing the audience policy locally would invite drift.
Owner access, project publication and the current request-root exception remain.
Revisit if readiness needs a new explicitly authorized disclosure audience.

Evidence: four native MCP tests with a real in-memory Buddies store. Before the
repair, the three team-audience cases failed and the owner case passed. After the
repair, all four pass, including mixed readable/private requests and inspection
under a live claimed request. The combined privacy, team access, resource
consistency and owner-authority set passed 14/14; server TypeScript check passed.
No live-provider or production-adoption claim follows from these fixture results.

Delivery: the fix is committed separately from the labeled baseline on
`codex/buddy-readiness-repair-20260912`. Only its changed files are transferred back
to the shared checkout after verifying their baseline bytes have not changed.
Do not merge the baseline snapshot over concurrent work; integrate the repair
commit against the pending implementation stack. Native project records own
completion status and subsequent work.
````


## S36

Source: `agent_notes/20260910T080351Z_01M255GCKDGHAXVBF6MBY40Z43_owner-selects-independent-luna-review-after-ever_buddies-development-lead_fe6ef8cd.md`  
Observed: 2026-09-13T03:59:42.678049+00:00  
Full-file SHA-256: `f51cbde2fd34b5db30fdbd7e0cd9fc943e016131a6380dd7d63d91055d9d528d`  
Working-tree status: `?? agent_notes/20260910T080351Z_01M255GCKDGHAXVBF6MBY40Z43_owner-selects-independent-luna-review-after-ever_buddies-development-lead_fe6ef8cd.md`

Preserved lines 1–18:

````text
---
kind: "accepted-decision"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:03:51.021Z
trust: workspace_source
evidence: [{"path":"product/buddies/PLANNING_MEMORY.md","sha256":"e2361501fe851c1ce1587b600a13e5ef4978d206cfef130ac6bc5aa664745329","observedAt":"2026-09-10T08:04:00Z"},{"path":"product/buddies/AUTOMATION_OWNERSHIP.md","sha256":"c5679f78be82012b0e13032baa6be7a9afa13e37101466fee23369472d86d84e","observedAt":"2026-09-10T08:04:00Z"}]
---
Decision dated 2026-09-10. Decision-maker: owner; accepted product direction, with implementation details selected by the assistant. Successor to 20260910T072358Z_01M2537C55YPHYW2AG0X1EF0Z1_memory-refresh-exists-per-message-luna-extractio_buddies-development-lead_fe6ef8cd.md (SHA256 0102ffd1dba54baa1a13d64c1f7b4b371dbd5b8a71a642c5013aff7aba55c48f). Question: how should completed conversations reliably reach compact Buddy memory when ordinary working memory remains empty despite work and notes? Owner requests a separate gpt-5.6-luna low process after each completed message, after shared agent CLI termination; it reviews context and conversations solely to update memory, does not act as the Buddy or work on its goal. Owner further specifies that it knows soul and every memory type, uses tool calls, and keeps compact memory lean and dense with pointers to larger documents.

Change from earlier choice: August 22 deferred automatic extraction in favor of selective same-turn capture; September 8 added an optional extra automation turn. The measured gap and renewed explicit owner direction now justify an independent end-of-turn reviewer. Still valid: dense caps, immutable revisions, compare-and-swap reconciliation, append-only evidence, owner/proposal distinction, and keeping authoritative task state in projects. Alternatives: continue voluntary capture (does not meet requested automatic retention); add another turn as the Buddy (mixes work authority and memory maintenance); have model output a JSON draft applied by server (does not meet owner's tool-call preference).

Implementation choice: hook only successful Buddy turns once process exit and normalized event drain join; snapshot before completion listeners can admit subsequent work. Separate fresh Luna-low CLI, private five-tool MCP capability (get_soul read-only, get_memory, recall, update_memory, remember_note); no Buddy execution identity, work, messaging, soul write or recursive reviewer hook. Source operation restrictions are retained. Serial per-Buddy durable queue, at most two active reviewers, two-minute deadline, 32 tool calls; terminal receipts and audit preserve failure/partial-write evidence. Completed reviews can choose no write. Queued jobs survive restart; interrupted in-flight jobs are recorded without automatic replay because they may already have saved revisions. These are assistant-selected bounds, revisitable with runtime evidence. Existing soul CAS and UI conflict handling remain in force.

Preserved pre-change design excerpts: PLANNING_MEMORY.md SHA256 e2361501fe851c1ce1587b600a13e5ef4978d206cfef130ac6bc5aa664745329 says 'Ordinary conversations have no hidden transcript replay or end-event job.' It also says 'later turns retain the conversation snapshot', contradicted by current per-message refresh source and compiled runtime. AUTOMATION_OWNERSHIP.md SHA256 c5679f78be82012b0e13032baa6be7a9afa13e37101466fee23369472d86d84e says 'Successful runs can spend a remaining iteration on selective memory capture'. Production will use independent maintenance instead; legacy scheduler embedding retains its fallback capture unless configured for per-turn review. The independent reviewer has its own bounded maintenance lifecycle and does not revive or extend completed work authority.

Tradeoffs: extra model execution per successful turn and bounded transcript-tail review; source summaries do not independently verify external claims. A slow queue may finish after another foreground turn starts, so next-message refresh observes only committed revisions available at that time. Revisit scope/bounds if measured latency, repeated no-op reviews, loss of useful context, or duplicate note growth warrants it. Validation is still in progress; this note records the accepted direction, not a claim of live activation.
````


## S37

Verification supplement: a later observation of S04, whose original record and excerpts remain preserved above.

Source: `product/buddies/PLANNING_MEMORY.md`  
Observed: 2026-09-13T04:21:20.784092+00:00  
Full-file SHA-256: `9b2684cd091c58871e092f4fa6624d4153f7915c4871920d8fb954c47b43e347`

The memory guide now describes active curation and the September 13 prompt/evaluation update. It explicitly preserves model/effort, review admission, scope, evidence bounds, deadlines and tool schemas. No failed-turn capture or automatic cross-audience learning is added. This is a source observation, not verification of that separate implementation.

Preserved lines 131–206:

````text
compaction, their MCP tools and UI editor are removed; migration retains existing
content in the current documents and note format.

## Independent memory review

Capture remains selective: record a material correction, durable lesson, useful
attempt, or changed hypothesis. The Buddy can do this during work. In addition,
each successfully completed Buddy message queues an independent `gpt-5.6-luna`
review with reasoning effort `low`, after shared CLI process exit **and** normalized
event drain. Failed, cancelled and ordinary non-Buddy turns do not queue reviews.
The snapshot is taken before completion listeners can start another work turn.

The reviewer is a fresh maintenance process, not the Buddy or a goal executor.
It receives current soul, working/long-term documents and the recent conversation
tail (48,000 UTF-8 bytes, with omissions marked). Injected Buddy briefings are
removed from the transcript. Context is evidence, not an instruction to continue
the work. This separate maintenance process has exactly five private tools:
`get_soul` (read-only),
`get_memory`, `recall`, `update_memory`, and `remember_note`. There are no target
IDs, work/message tools, arbitrary file tools, or soul writes. Source operation
restrictions are retained; memory writes use canonical store CAS with reviewer
provenance. A stale response supplies the current body/version for reconciliation.

Instructions call for active curation: reconcile relevant existing correction
notes, consolidate duplicates, remove expired transient detail and preserve useful
older knowledge. Corrective cleanup can justify a write without a new fact.
Promotion depends on enduring value, never age or repetition. Decision-maker,
scope and proposed-versus-owner-accepted attribution survive compression; a later
caveat may narrow an earlier result without invalidating it. Current task state,
staffing and execution limits remain in projects/runs.

Material decision rationale and detailed evidence belong in append-only notes;
reuse an existing record when it suffices. Compact memory preserves the exact
returned native ref/name and audience, or an actual legacy path, without inventing
a filesystem location. Save a needed destination before removing relocated
content. No useful change means no write. The reviewer reads both compact memory
documents even for a no-op; a CLI exit with no memory read is a visible failure.

The approved prompt lives in `server/src/buddies/memory-review.ts`. Its frozen
control and opt-in curation evaluation live under
`server/test/fixtures/memory-curation/` and
`server/test/buddy-memory-curation.test.ts`. The September 13 change preserves
model/effort, review admission, scope, evidence bounds, deadlines and tool schemas;
it does not add failed-turn capture or automatic cross-audience learning.

Reviews are deduplicated by conversation/attempt, serialized per Buddy, and run
at most two at a time, with a two-minute deadline and 32-tool-call limit. A private
durable queue preserves waiting work across restart. In-flight reviews interrupted
by restart are recorded without replay because they may already have committed
revisions. Partial writes survive a later failure. Terminal receipts omit the
transcript and are visible through `GET /api/buddies/:buddyId/memory-reviews` and
the `buddy.memory_review` audit event. The reviewer does not create a conversation
or recursively trigger another reviewer. Production suppresses the old extra
automation capture turn; standalone scheduler users retain it as a fallback.

Every subsequent Buddy message refreshes its briefing from current stored memory
and soul. A review runs asynchronously, so a message started before its writes
commit sees the previous revision. CAS-conflict responses provide the current
head when concurrent conversations or the reviewer edit the same Buddy.

## Soul and owner direction

To edit the portable soul in an ordinary owner chat, read `get_document` with an
unscoped soul ref, then preview/apply `update_document` with the returned ref and
revision, complete content, stable key and reason:

```json
{
  "ref": {
    "kind": "soul",
    "targetBuddyId": "buddy-self"
  }
}
```

This unscoped ref selects the portable soul adapter; adding the current audience
````
