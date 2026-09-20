# History-loss causal audit — 2026-09-12

**Confirmed, still reproducible in the current tree.** The application retains the stable conversation ID and native transcript files, but its display projection discards prior-session messages and replaces the conversation birth date after a native session rotation. The later resource repair changes ordinary-learning continuity keys; it does not repair this display-history defect.

This report is an assistant audit/recommendation requested by the owner. It succeeds the incident note `20260912T084619Z_01M2ACQKNB44S1ZPFQ2GKQ521S_2026-09-12-confirmed-buddy-session-rotation-hide_buddies-development-lead_fe6ef8cd.md` and distinguishes its historical live observations from this audit's new isolated reproduction. The dated [evidence manifest](../product/buddies/audit-2026-09-12/history.evidence.json) preserves current file hashes and exact excerpts. The mixed working tree is uncommitted, so HEAD alone is not its source version. No product source, production records, provider sessions, or transcripts were changed.

## Exact causal chain

1. A restored native session sets `_hasStartedSession=true` in [runtime.ts](../server/src/conversations/runtime.ts:823). Its approval/audience key is only an in-memory field initialized to null at [line 2062](../server/src/conversations/runtime.ts:2062).
2. The next Buddy input compares the current key to null and calls `resetProcess()` at [lines 2107–2117](../server/src/conversations/runtime.ts:2107). Reset rotates the native session and clears `_hasStartedSession` at [lines 2516–2524](../server/src/conversations/runtime.ts:2516). The stable application ID, existing visible messages and original date survive this immediate operation.
3. Spawn therefore selects `fresh` at [lines 916–918](../server/src/conversations/runtime.ts:916), omitting `resumeSessionId`. The new provider receives the refreshed briefing and new input, not the full old application transcript. When confirmed, [config-store.ts](../server/src/conversations/config-store.ts:413) retains the old session as a historical binding and assigns the new current session. The durable conversation date remains unchanged.
4. On the next inactive poll, [session-loader.ts](../server/src/lifecycle/session-loader.ts:460) replaces `existing.messages` with the current native session's `source.messages` (only certain trailing system messages survive) and assigns `existing.createdAt = source.createdAt` at line 470. This is the actual visible-history loss.
5. The full update is broadcast at [line 555](../server/src/lifecycle/session-loader.ts:555). [actions.ts](../client/src/atoms/actions.ts:561) faithfully installs its messages for nonsummary updates, and HTTP detail loading also uses the server snapshot at [line 130](../client/src/atoms/actions.ts:130). This is already a server projection defect, not merely a client rendering glitch.
6. Restart cannot restore the old messages: [session-loader.ts](../server/src/lifecycle/session-loader.ts:150) rejects any source that is not the record's `currentSession`; hydration at [lines 225–226](../server/src/lifecycle/session-loader.ts:225) again uses only the current source messages/date. Historical bindings preserve discovery/identity, but are not merged into the application transcript.

The runtime comment “Display history remains intact” is true immediately after reset and false after the poll/restart boundaries.

## Original incident evidence and confidence

The earlier incident note records stable app conversation `7d9d117f-7a13-46e2-bf6a-95da591d6e2b`, created `2026-09-09T04:45:02.313Z`. Its original native session was `01a0847c-ed91-75e2-85fb-6a57cdc8bd54`. The original five-defect reply remains in the recorded transcript at line 8051, timestamp `2026-09-10T19:16:44.123Z`, beginning “The shared design still fits, but I overstated how finished the implementation was. I found five reproducible defects.” The note preserves its SHA-256 and exact pagination excerpt.

The note records fresh sessions `01a094c0-821a-7ec3-a130-3a241b2f5e29` then `01a094c7-8e05-7a41-b49c-b880fa437217`, with `execution.fresh` events under the same server boot ID. At inspection the API returned only 10 messages starting with the new pagination question and a September 12 creation date, while durable config retained September 9 and the original transcript existed.

**Direct historical observations:** old bytes preserved; stable app ID; prior/current native mappings; fresh execution events; API missing original review and reporting new date. **Mechanism now independently reproduced:** unknown restored key → fresh session → poll truncation/date replacement → restart keeps the truncation. **Remaining inference:** the second production rotation was specifically caused by the intervening memory-review write. Timing and the old key algorithm support it; no reset-reason event recorded the actual compared hashes. This audit did not reread full live transcripts or claim a fresh production inspection.

## New isolated reproduction

Run the preserved [diagnostic](../product/buddies/audit-2026-09-12/history-rotate-poll-reload.observed.ts):

```sh
pnpm exec tsx product/buddies/audit-2026-09-12/history-rotate-poll-reload.observed.ts
```

It deliberately asserts the **observed defect**, and is outside the normal acceptance suite. It uses the real Conversation runtime, real disk-backed ConfigStore/ConfigService and real file-poller/hydration boundaries. Provider events and discovered native transcripts are controlled synthetic fixtures. It launches no provider and uses only isolated `/tmp` stores. [Captured result](../product/buddies/audit-2026-09-12/history-rotate-poll-reload.result.json):

| Boundary | Visible messages | Reported creation date | App ID |
|---|---:|---|---|
| Fresh turn finishes after rotation | 4 (original 2 + new 2) | September 9 | unchanged |
| Current native session polled | 2 (new only) | September 12 | unchanged |
| Reload supplied both native transcripts | 2 (new only) | September 12 | unchanged |
| Durable config | old binding still present | September 9 | unchanged |

Targeted existing suite: `pnpm exec tsx --test server/test/session-loader-hydration.test.ts server/test/conversation-runtime.test.ts server/test/buddy-resource-consistency.test.ts` — **34 passed, zero failed/skipped**. These passes coexist with the reproduction: current loader tests cover kind recovery and no-transcript date recovery, not rotate → poll → restart history retention.

## Implemented versus pending

- **Implemented and verified here:** the resource-repair acceptance test proves ordinary reviewer working-memory/note writes preserve the audience key and effective inherited memory ([buddy-resource-consistency.test.ts:19](../server/test/buddy-resource-consistency.test.ts:19), key equality at line 85). Current installed `knowledge.js` derives retraction revisions and authority state rather than hashing every content revision.
- **Pending, P1:** preserve the application transcript/date across native session rotations, polling and restart, including prior bound sessions. Recovering today's original review from its intact native file is still pending; this audit made no recovery mutation.
- **Current behavior requiring explicit design care:** every restored Buddy provider session rotates because its approved audience key is unknown. This is a deliberate conservative privacy fence, not evidence that every boot changes permissions. Persisting a trusted approved audience identity could enable safe reuse, but removing the null-key fence alone would resume unaudited private context. A future change must prove audience identity/access/retractions match the actual native session at its last admission.

The accepted resource-consolidation direction remains suitable. Recommendation: separate owner-visible application history from model context admission. Preserve full authorized display history and stable durable creation time without replaying old owner/private context into a narrowed or team audience. Do not solve history loss by disabling access invalidation.

Acceptance missing: an owner thread with original content, ordinary memory review, authorized rotation/narrowing, complete/current native transcripts, poll, restart, and detail/WebSocket hydration must retain one stable app ID, original creation date and ordered deduplicated visible history. The new provider request must exclude disallowed older content. Also exercise missing historical source files, inherited/forked native transcripts (duplicate messages), startup hydration limits, older-session poll updates, and server restore with unproven versus durably proven audience state. These are required cases for the eventual fix, not claims of current passing coverage.


## Independent second pass — unrelated changes still reset continuity

The privacy reviewer found that the new key hashes complete membership rows and the global relationships table. This pass extended those findings through the actual runtime, not only key comparison. The preserved [four-turn diagnostic](../product/buddies/audit-2026-09-12/history-unrelated-key-reset.observed.ts) uses the installed package, real composer and real Conversation with synthetic provider events:

```sh
pnpm exec tsx product/buddies/audit-2026-09-12/history-unrelated-key-reset.observed.ts
```

[Result](../product/buddies/audit-2026-09-12/history-unrelated-key-reset.result.json): first turn is fresh; unchanged second input correctly resumes `native-0`; changing an unrelated peer's `background_paused_reason` to `Hourly run limit reached` makes the third input fresh; adding a manager relationship between two Buddies in another workspace makes the fourth input fresh. The current Buddy, owner thread, workspace and authorization scope are unchanged. Messages remain in the runtime until polling, after which the independently proved history projection defect applies.

**Pending, P1 continuity variant:** `knowledge.js:149` reads `SELECT * FROM buddy_projects` for the workspace, so scheduler metadata enters the disclosure key. `knowledge.js:160` hashes all relationships without a workspace/relevance filter. The ordinary-learning repair is real but insufficiently isolates authorization from unrelated operational state. Recommendation: derive the reuse key from the effective disclosure boundary, including relevant identity, authority and actual retractions; preserve required narrowing/retraction invalidations. Do not suppress all resets or infer authorization from timing. Add a desired-behavior runtime test proving these unrelated changes resume while genuine audience narrowing starts fresh.

This finding is a successor to R3, not a claim that ordinary memory-review writes still change the key. It also makes the pending display-history repair urgent: legitimate privacy resets and these unnecessary resets currently share the same destructive projection path.


## Parent verification supplement

The parent auditor independently rechecked the original native transcript during this audit: SHA-256 `100c1bf32e4074352dd4a2837424ebf3ab399e163dd99a387f6441bbb4e270a4`, exactly 60,237,815 bytes, with the same five-defect final at line 8051. This corroborates current preservation of the original bytes, beyond relying on the earlier incident note. See [original-transcript-check.json](../product/buddies/audit-2026-09-12/original-transcript-check.json). The parent owns that direct observation; this sub-audit did not independently read the transcript.

## Lead triage supplement — 2026-09-12

The independent cross-review distinguishes severity of the new trigger from the consequence. Unrelated key churn alone is **P2** continuity loss; in the current implementation it feeds the separately confirmed **P1** history projection bug. The earlier P1 label in the second-pass section reflected that combined outcome. The consolidated audit tracks them as A3 P2 and A1 P1, avoiding two independent counts of the same visible-history consequence. This is assistant triage, not an owner architecture decision. The earlier findings and evidence are preserved above.
