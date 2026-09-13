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
