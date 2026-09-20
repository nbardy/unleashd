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
