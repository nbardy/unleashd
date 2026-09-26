# Stale tab after the v3 swap — fixed in lane-tabs 870f188 (branch fix/stale-tab-reload)

- Root: the socket said nothing about its protocol, so the server couldn't spot an old tab, and that tab dropped every v3 frame as invalid and quietly went stale.
- Fix: clients connect to `WS_PATH` = `/ws?protocol=3` (shared). If the URL names a different protocol, or none, the server closes the socket with `PROTOCOL_MISMATCH_CLOSE_CODE` 4426 and the reason `protocol 3` (`conversation-websocket.ts`).
- New client, newer server: `classifySocketClose` returns `outdated`. The client stops reconnecting and shows one banner, "The app was updated — reload", with a Reload button (`UpdateBanner`, above both shells). It keeps its rows.
- New client, older server (a dev reload in flight): nothing new. It stays the existing `skew` that reconnects until the server catches up.
- Old tab (f6cc2ca code): it can't be made to reload. Its `onclose` only sets "disconnected", checks auth and reconnects every 2s, and its `error` handler only logs to the console. So it now shows "disconnected" and disables its actions instead of a list that looks live. The T15-RUNBOOK checklist now has "Reload every open app tab" (both copies: lean-scope and agent_notes).
- Tests: the server test in `websocket-lifecycle.test.ts` connects to plain `/ws` the way the old client did, and gets 4426. The client test in `protocol-skew.test.ts` checks that a close from a newer server shows the banner and one from an older server doesn't. Existing tests that open sockets and the `test/api.test.js` script now pass `WS_PATH`.
- Also updated: `tools/screenshots.mjs` uses `WS_PATH` so its socket isn't refused, and AGENTS.md documents the close code. Reason comments and a `Pattern: sum-types` tag are in place. CSS stays at the G8 cap: the dead `.mobile-chat__action-error` rule was deleted to make room.
- Checks on the clean committed tree: `pnpm test` exits 0 with 0 failures, and `check-client-invariants` passes all 8 gates (G8 14838/14838).
- Note: a `dcg` guard blocked one heredoc edit because of a `>` inside the test text. It was a false positive, and the same edit was made with the Edit tool. Not pushed or merged.
