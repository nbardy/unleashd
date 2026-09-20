# Buddy launcher creation failure — September 11, 2026

The Wave_sim CEO's original Project Lead request and four functional-lead requests failed before acknowledgment. The native execution receipt reported a Zod minimum-length error at `creation.initialMessage`. A supported retry then held on a missing destination conversation. The owner stopped team/report work to repair this boundary.

## Cause and change

`BuddyRunExecutor` passed `initialMessage: ''` to `createServerBuddyConversation`. The real config store correctly requires a supplied initial message to be nonempty. The existing runtime-chain test directly constructed a conversation, bypassing creation/config persistence, so it missed the failure.

The executor now omits the pending initial message. The creation service permits omission while retaining the nonempty schema for a supplied message. The run alone dispatches its prompt after claiming authority; there is no saved pending prompt for startup hydration to enqueue independently.

A failed fresh creation can already have a reserved conversation ID and, after partial creation, a durable config record. Explicit retries of an unacknowledged fresh request now replay its original generated ID and creation command. A bound request, continuation, reply or schedule does not get this recovery path. Real `createOrReplay` still rejects deleted records and conflicting creation intent; no tombstone or admission checks were relaxed. Failed work is not automatically retried.

## Verification

- Before the fix, the real team-chain test was connected to `BuddyCreationService` and `ConversationConfigStore`. It reproduced the minimum-length creation failure and failed to complete the chain.
- After the fix, the same test passes Chief -> Lead -> Engineer/reviewer -> Lead -> Chief, including revision and return delivery, using the real conversation runtime and config persistence with a fixture provider.
- New boundary regressions cover failure before persistence, partial creation after persistence, and deletion before retry. Successful explicit retries execute once and save a reply; a tombstone prevents execution. No pending initial message is stored or replayed.
- Focused five-file suite: 12 tests passed, 0 failed. Command: `pnpm exec tsx --test server/test/buddy-coordination.test.ts server/test/buddy-background-runtime.test.ts server/test/buddy-creation-service.test.ts server/test/buddy-dispatch-service.test.ts server/test/buddy-launcher-creation.test.ts`.
- `pnpm --dir server exec tsc --noEmit` passed. Formatting checks passed for affected files.

These are local code/regression results, not a live provider/team round trip. The running dev backend PID 33436 predates this change. Its watcher loads changed server source at the next idle drain boundary; active chats, including the repair conversation, keep the old backend in ownership. No forced restart or live team request was performed during this evidence capture.

## Native incident references

- Original request: `message_78416360-b79a-47b3-b0c3-465b1c47e6c9`; failed run `buddy_run_f641495b-2772-43bf-a323-cc968d552222`.
- Retry: `buddy_run_d5b206a3-a96b-444c-b977-b16670be06a8`; missing destination, then explicitly stopped.
- Functional messages: `message_ed4f800a-5222-4c83-af36-5a073cba2acb`, `message_890f2576-8ef0-4cd4-a8cb-8687e8f43137`, `message_a38085b5-6be9-408f-90d6-ecf172ccf5ba`, `message_a22e6bd4-0624-41b2-86f0-95391982f844`.
- Both request roots were stopped through native Buddy operations on owner direction; failed receipts are preserved. Stopped roots must not be revived through configuration changes.
- Authoritative repair work: `buddy_project_ea92d9ed-f5e3-4f93-b1f9-d9fad54ebbc4`. Board-report work remains separate: `buddy_project_0844a2d3-eebe-4051-9c5e-95023235c902`.

Edits preserve existing work in the dirty repository. No Buddy database, installed package, team profile, reporting line, budget or schedule was modified as a workaround.
