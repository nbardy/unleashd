# Wave Sim conversations disappeared — September 12, 2026

The owner's 22:46 Bali screenshot showed every Buddy sidebar group empty and
both Product Engineer conversation links as “Unavailable”. The conversations
had not been deleted. A live WebSocket snapshot contained 535 conversations;
all 39 saved Wave Sim conversation links were present in the server registry.
The detail API returned both Engineer threads, including the active run.

## Display cause and repair

`BuddyRunExecutor` reserves stable destinations as `buddy-run-${run.id}`.
Thirty-seven conversations in the captured snapshot used that format. Durable
configuration accepts nonempty opaque IDs, but `ConversationSchema.id` and the
WebSocket command/event references required UUIDs. The browser's
`safeParseServerMessage` rejected the entire `init`, leaving its conversation
map empty. Its console repeatedly reported rejected server messages. Individual
team updates and stream events failed validation too. A reconnect therefore hid
ordinary UUID chats, including the CEO, alongside the prefixed team threads.

The shared `ConversationIdSchema` now matches durable identity and is reused in
snapshots, commands, events, Buddy parent references and fork/merge lineage.
Review-document UUIDs keep their UUID constraint. No conversation IDs, saved
transcripts or production database rows were rewritten.

The captured 535-conversation snapshot passes the repaired decoder unchanged.
After a browser reload the CEO chat reappeared, both Engineer rows became real
Open links, and the formerly unavailable Engineer thread opened with its tool
history and terminal reason. Background work remains excluded from the sidebar's
direct-chat list by the existing placement filter; its Conversations-tab links
are available again.

## Separate execution failures

The visibility bug concealed actual failed work; repairing display does not
retry or settle that work. Read-only receipts at approximately 14:55 UTC show
43 completed Wave Sim runs today, 11 failures with `max_runtime_timeout`, and
19 other failures (14 project-owner mismatches, four duplicate conversation
links and one provider interruption). The Project Lead was still executing and
a reply was queued.

Both Engineer attempts in the screenshot reached their configured 600-second
limit:

- `buddy_run_6ce02885-35c4-466b-8946-b3928a7d3d78`: 14:26:24–14:36:24 UTC.
- `buddy_run_7ede4413-fd6c-4d46-87da-868c21218ef0`: 14:39:32–14:49:32 UTC.

Other receipts include `Buddy project does not belong to the buddy` on team
requests, and `UNIQUE constraint failed: conversation_links.unleashd_conversation_id`
on a reply to the CEO (`buddy_run_51a7769d-d3df-40a3-8db1-56cf8e165baf`).
These are independent execution defects, not fixed by the ID contract repair.
The current executor filters the selected project during conversation creation,
but its per-run context still directly takes `run.project_id`; the integration
requires a selected project to belong to the executing Buddy. The link readiness
path also calls the integration's unconditional `linkConversation` insert for
an existing conversation. These are concrete follow-up boundaries for regression
tests. No team messages, retries, budget changes or state repairs were issued.

## Verification and activation

The existing real Chief → Lead → Engineer/reviewer → Lead → Chief integration
test now passes executor-created snapshots and every runtime/creation broadcast
through the browser's decoder. It also checks owner command references and
continues to reject empty IDs. Before the schema change this reproduced the
same `Invalid uuid` failure as the live snapshot.

Client and server `tsc -b` pass. All 77 client tests and all six client invariant
gates pass. The full server run passed 332 tests, with three opt-in skips; its
only failure was an incorrect config-patch shape in the newly added assertion.
After correcting that fixture, all four tests in `buddy-coordination.test.ts`
pass, including the extended real runtime chain. Scoped Biome checks pass.

The client uses the shared source and adopted the fix on reload. At 14:55 UTC
the existing server PID 86174 still held the Project Lead run. A command against
a deliberately nonexistent diagnostic destination confirmed its loaded decoder
still required UUIDs. Server command adoption waits for the watcher's normal
idle reload; no active work was interrupted. This note does not claim that the
old process has already loaded the new schema or that failed runs resumed.
