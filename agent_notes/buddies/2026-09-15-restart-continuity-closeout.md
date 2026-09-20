# Buddy restart continuity: bounded closeout

Recorded 2026-09-15T04:39:25.847724+00:00.

## Decision and evidence

Successor to [the original implementation decision](2026-09-15-restart-continuity.md), SHA256 `87dae88ac01d505d74c6098c1ebcb958328904623e38d39a5ffb7829e014b50c`, and native note `2026-09-15T04:10:21.907Z:af88fa46-3e5c-4040-921e-ad348f16bd13` in owner thread `b1c757c7-5398-4858-a6aa-5314717dc533`.

The owner requested: “okay make clean fixes , dont grow scope, and close out”. Buddies Development Lead selected two bounded implementation corrections within the existing restore paths:

- Select the saved session ID and verified audience from the same provider-matching binding in transcript hydration, recovery without transcripts, and creation replay. Previously only the audience key was guarded; a mismatched provider's session ID could still mark the runtime resumable.
- During recovery, use the session binding returned by config hydration. Hydration can infer the current session from saved aliases; the older list snapshot omitted it and unnecessarily started fresh.

The existing config service remains authoritative. Same-audience context continues with a refreshed briefing; missing or changed audience metadata keeps the existing fresh-session behavior. The earlier rationale against ordinary memory-generation resets still applies. Local binding selection replaces duplicated independent field guards; no new controller or storage model. Revisit if provider-session provenance or hydration authority changes.

## Verification and limits

Extended the existing history-rotation integration fixture over real config files, config service, adapter, loader and runtime, with a fixture provider event stream. Verified resumed requests after transcript loading, no-transcript recovery, and inferred-session recovery; current briefing and audience persistence; exclusion of unrelated display history; and fresh runtime state for provider mismatch with and without a transcript.

Against isolated copies of the original source, inferred-session recovery failed with the application ID instead of the saved native ID. A second baseline run isolated provider mismatch and failed with `hasStartedSession() === true`. Both pass after the repair.

Final checks: 59/59 passed across config-store, config-service, buddy-creation-service, conversation-runtime, session-loader-hydration and session-history-rotation. Server `tsc --noEmit` and Biome formatting passed. No live provider round trip or production reload was performed. These corrections are local source changes.

## Historical source identity

[Incremental patch](2026-09-15-restart-continuity-closeout.patch), SHA256 `28df05fbacf9db2b696cb3ec0c6e6e304f736f802b96baa80ba4f94e533b0ab9`, preserves this closeout independently of other uncommitted work in the shared checkout. Original implementation evidence remains intact.

- `server/src/conversations/creation-service.ts`: before `ae3eaaf72ea9663b9c2b0abaec38496d6061ad951f794f9c8be55038f4805682`, after `fd2c3595ebb57667ade342489e6d94166fbfefe1f9f2fe30c52c88a0a8c61443`
- `server/src/lifecycle/session-loader.ts`: before `1fa9a816b117808e7114ba6aee516e6481db5cfc9151d0f185ca5fd9bca4eeeb`, after `85c22d8024bfc22fd32a48dcc5905293aad96f052adb7f14a029547b34df05ac`
- `server/test/session-history-rotation.test.ts`: before `e31710ba55a1adf31d1a80751c8d851d6cc8abaac0b3f0bd5eae07e475c0bf3a`, after `f6597d9a48af2d544b6c8514803108a68de2d058c33c0b8ed7ea0cd8bdd5d81a`
