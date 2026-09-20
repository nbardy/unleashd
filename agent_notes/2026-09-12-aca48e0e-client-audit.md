# Client history audit — 2026-09-12

Scope: owner-reported conversation `aca48e0e-ee06-42d1-831b-5470d2c2402a`, inspected in the current mixed working tree and a dedicated read-only Chrome tab. No product source, conversation, or provider state was changed by this audit. Existing edits were preserved.

## Finding

No independent persistent client-history clearing defect was established. The confirmed server rotate/poll/hydration defect is sufficient: the client accepts the server's complete transcript snapshot, including a snapshot reduced to the current native session. The client cannot recover historical native sessions omitted by both the detail API and WebSocket payload. The prior [history causal audit](2026-09-12-audit-history-cause.md) already identifies this boundary; this pass reread the current client implementation and checked the actual reported page.

The browser at approximately 2026-09-12 09:50 UTC displayed the lost-resume question beginning “that messsage was suppose ot be resuming from a thread,” its recovered-links reply, then the owner's “Hello” and “hello” turns. The earlier repair response was absent, matching the report. No Unleashd console warning/error appeared in the inspected browser log; the only warnings were from an unrelated browser extension. Nothing was typed or sent into the conversation.

## Complete replacement and removal paths

- `client/src/atoms/actions.ts:107`: `replaceConversationSnapshot` replaces the whole record. It is used by stable HTTP detail loading (`:118`), `conversation_created` (`:368`), `conversation_updated` (`:382`), and a rejection carrying `authoritativeConversation` (`:394`). These payloads are contractually complete, so shorter server transcripts replace longer client transcripts.
- `actions.ts:561`: bulk `conversations_updated` preserves existing messages only when `summaries` is true **and** the conversation was hydrated (`:574`). A nonsummary snapshot replaces messages and marks details loaded (`:582`). This directly propagates the server poll rollback and deliberately does not union client history into authoritative state.
- `actions.ts:298`: `init` starts a new detail epoch, discards outstanding request registrations, and resets the hydrated-ID set for summary payloads. While startup is loading it retains prior IDs; each incoming conversation still replaces that record. A normal completed init rebuilds the map from server IDs. This temporarily hides the chat behind “Loading conversation history…” (`client/src/components/Chat.tsx:405`), then reloads complete details (`:259`). It is an expected reload boundary, not durable transcript deletion.
- `actions.ts:447`: `conversation_deleted` removes the conversation and its per-ID atoms. `actions.ts:595`: `conversation_load_complete` prunes IDs absent from the authoritative completed load. Either can cause Chat's availability guard to navigate away (`Chat.tsx:251`), but neither matches this incident's stable existing ID with newer turns still visible.
- `actions.ts:439`: `session_bound` changes the native ID only; it does not erase messages.
- `actions.ts:483`: `message` appends user/system/assistant records; its duplicate-assistant-placeholder guard skips a consecutive assistant event. It does not remove previous messages. Full completed prose comes from the subsequent authoritative update.
- `actions.ts:517`: status clears only transient streaming content after flush. Init also clears that transient buffer. Neither operation clears committed `conversation.messages`.

## Freshness and rendering checks

`client/src/atoms/detail-loader.ts` checks conversation object identity across every HTTP request and retries if live structural state changed; `actions.ts:122` additionally rejects snapshots from an earlier reconnect epoch. `client/src/hooks/useWebSocket.ts:37` ignores messages from superseded sockets. `client/src/App.tsx:42` owns one bridge and invokes it once (`:193`). These protections address stale transport arrivals but correctly do not reinterpret a stable, current server response whose own history projection is wrong.

The new assistant grouping does not truncate the underlying conversation: `client/src/atoms/conversations.ts:124` derives groups from all messages while merging transient text into a copy of the last assistant record. `client/src/utils/chat-message-groups.ts:47` visits every record, retains each assistant record (`:67`), and joins all of them for Copy (`:43`). The desktop virtualizer uses the entire group count (`client/src/components/VirtualizedMessageList.tsx:747`) and renders each visible group's ordered response parts (`:960`). Its viewport virtualization means an absent off-screen DOM node alone is not evidence of a missing message. The observed chat's original transcript is already absent from its server projection.

The dirty diff in `actions.ts` is limited to archived Buddy filtering, the new grouping atom's deletion cleanup, and removal of obsolete helper exports. Its transcript replacement/detail/reconnect behavior is unchanged from HEAD. The new grouped assistant rendering is covered by behavioral render tests preserving early prose, completed answers, tools and widgets.

## Verification

Ran `rtk pnpm exec tsx --tsconfig client/tsconfig.app.json --test client/test/detail-loader.test.ts client/test/chat-message-groups.test.tsx client/test/message-command-ack.test.ts`: **8 passed, 0 failed, 0 skipped**. These prove existing client freshness, rendering and submission-ack behavior; they do not claim the server history defect is fixed. The parent and session-loader lane own the restoration implementation and server integration coverage.

Post-fix browser reload verification was prepared but could not be completed before this audit closed: the repaired backend had not yet replaced the active backend. The pre-fix visible state above is the baseline, not a restoration claim.

Live readiness at 09:57 UTC: the application was still served by PID 26438, booted at 09:11:41 UTC. It owned an active provider wrapper PID 40306 and Codex PID 40308. The live turn-attempt journal at 09:57:43.878 UTC reported provider tool activity for conversation `7d9d117f-7a13-46e2-bf6a-95da591d6e2b`, attempt `0359a623-515d-438c-bbef-c179162904d4`, server boot `ce71a588-8e6a-42da-a80c-3230a5b820e2`. The lifecycle's source reload waits for active work to finish. No restart was forced. There is no registered `/api/status` or `/api/health` in the inspected routes, and repository `server.log` is an obsolete January log rather than the live dev runtime's output. These facts establish an active old backend, not by themselves that its private `reloadRequested` flag was set.

Final activation limit: at 10:04:46 UTC, port 7499 still belonged to PID 26438 and the same main Buddy attempt was still running. Its last visible text event was at 10:03:40 UTC; subsequent provider-wrapper heartbeats continued, including native transcript advancement observed at 10:04:16 UTC. A browser WebSocket reconnection at 10:00:48 UTC was a frontend refresh, **not** backend replacement (the listener PID was unchanged). Direct browser navigation to the known conversation-detail API was blocked with `ERR_BLOCKED_BY_CLIENT`; its temporary tab was closed, and the parent owned authenticated API verification separately.

The parent reports successful isolated recovery using the actual source transcripts and passing server integration checks in the loader lane. Those do not substitute for this missing live-browser check. This lane did not force a restart, interrupt the other Buddy, send any chat messages, or claim the current page was restored. The requested investigation and client audit are complete; live activation remains governed by the application's existing safe reload lifecycle once the other admitted turn finishes.

## Post-reload verification — 2026-09-12 10:13 UTC

**The earlier activation limitation is now superseded.** The parent returned after the backend's natural reload and reported authenticated API recovery: the exact target has 121 message records, 9 user messages, its original September 10 date, and the seven-defect repair final; the main `7d9d117f` thread has 1,280 records, 50 user messages, its original September 9 date, and the original five-defect review. Those counts and dates are the parent's API observations, not inferred from rendered rows.

This client lane independently opened a new dedicated Chrome tab at `http://unleashd.localhost/chat/aca48e0e-ee06-42d1-831b-5470d2c2402a` and traversed the virtualized transcript. Browser DOM text and screenshots visibly confirmed:

- The original attached-image message asking what “HOST OWNER CONTROLS” is, and the follow-up discussion about repeated injection and moving guidance into opening context/MCP.
- The question about the fix, the reproduced-defect explanation, the owner's “Fix it all” instruction, and their correction that Buddy mail stays local on disk.
- The completed repair reply beginning “Fixed all seven reproduced defects and consolidated memory, visibility, pagination, and retry handling. Buddy mail stays local.” Its historical 302-test claim and implementation-report link are visible in that same reply.
- The later lost-resume question and recovered-links answer, followed by **both** “Hello” / “hello” user turns and their assistant replies.

The first-discussion, repair-final and latest-greetings viewports were visually inspected. This proves that the actual browser now renders the previously missing content together with the newest turns in the same stable application conversation. At 10:13:53 UTC, an independent listener check showed port 7499 owned by **PID 59549**, replacing the old PID 26438. Nothing was typed or sent; no restart was forced. This verification does not claim that a new provider turn will automatically recover old model context—the separate conservative audience fence remains as described below.

## Review of persisting the provider audience key

The parent requested a separate design check after logs tied this occurrence's fresh provider launch to a backend restart. Saving only an `approvedAudienceKey` on the durable current native session would remove the unknown-key reset, but it is insufficient to establish safe context reuse in this architecture. Native transcripts are also discovered from external CLI sessions; another CLI can append context to the same native ID after that key was recorded. Equality of the saved ID and current audience key does not prove the resumed native context is still the attested context. Approval-algorithm changes also require explicit invalidation.

A later design should capture the admitted key per provider run, persist an attestation at a confirmed native checkpoint after terminal provider drain, and validate that checkpoint/version on restoration. Missing, changed, partial or unproven context remains fresh. Avoid assigning an attestation to a provisional ID, historical binding or fork merely because another session had one. The current store's same-ID early return (`server/src/conversations/config-store.ts:419`) ignores extra metadata; the poller also calls session persistence; and `buddy-creation-service.ts:105` logs and swallows persistence errors. Those boundaries must never accidentally promote unknown native context to approved state.

Required acceptance cases for that later change include unchanged attested restart resuming, legacy/missing attestation remaining fresh, external append/change remaining fresh, genuine audience narrowing/retraction resetting, policy-version changes resetting, native-ID mismatch rejecting the attestation, failed persistence remaining unverified, and late events/reset/fork not transferring the previous session's attestation. This audit recommends preserving the current null-key fence while repairing display history, and explicitly distinguishing restored display history from historical model context on the next provider launch.
