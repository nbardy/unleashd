# Incident: Active Codex Turn Killed by Bridge-Idle Watchdog

Date: 2026-08-04 (KST)

Later recurrence: [September 10 Buddy foreground deadline](incident-2026-09-10-buddy-chat-timeout.md).
The heartbeat fix below remained intact; a new Buddy claim inherited a separate
600-second absolute deadline. A healthy event bridge cannot extend that deadline.
The values below describe this incident's fix; current watchdog defaults live in
`server/src/constants/timeouts.ts`.

## Outcome

The ten-minute failure was an Unleashd bridge-idle timeout, not Codex's normal maximum run time.
Codex continued reasoning and running tools internally, but that activity did not become a unified
event visible to Unleashd. The old shared-CLI heartbeat also failed to cover this state.

Plain `pnpm dev` now uses:

- a shared-CLI liveness heartbeat after 25 seconds of unified-event silence, checked every 30
  seconds;
- a one-hour server bridge-idle fallback; and
- an independent 24-hour maximum turn runtime.

No environment variable is required. Environment variables remain optional overrides.

## Evidence

Failed attempt `e31f6dd8-9eed-4efe-bbeb-6f81d098094a` recorded:

- `running` at `2026-08-03T14:07:08.917Z`;
- its only `attempt_activity` at `2026-08-03T14:07:08.919Z`; and
- terminal cause `timeout` at `2026-08-03T14:17:09.846Z`.

The corresponding native Codex session recorded, among many intervening events:

- a completed patch at `2026-08-03T14:17:05.527Z`; and
- another reasoning event at `2026-08-03T14:17:08.136Z`.

The parent killed the process about 1.7 seconds after that final internal reasoning event. This
proves Codex was active while the parent-facing unified stream appeared idle. The old telemetry
could not distinguish buffered/silent stdout from raw JSON that the parser did not recognize.

## Event path

Activity must cross every boundary below before it resets the server watchdog:

```text
Codex model/tools and native session journal
  -> codex exec --json stdout
  -> shared agent CLI framing and provider parser
  -> UnifiedAgentEvent async stream
  -> Unleashd conversation runtime
  -> turn-attempt journal and UI
```

Native token counts, reasoning records, and tool calls are not direct operating-system liveness
signals to the parent. Codex can persist those records internally without immediately writing a
parseable event to `codex exec --json` stdout.

## Root cause

The old heartbeat had three gaps:

1. It did not emit until a parsed `text.delta` or `tool.use` had already appeared. A silent startup
   therefore never acquired heartbeat coverage.
2. Any raw stdout chunk refreshed the heartbeat's silence timer, even if framing or parsing
   produced no unified event. Raw-but-unparsed output could therefore hide a broken parser bridge.
3. It stopped itself after twenty minutes of stdout silence, while the server allowed turns to run
   much longer.

The server then interpreted the absence of unified events as provider inactivity and applied the
old ten-minute idle timeout.

## Fix

- Conversation-mode heartbeat starts immediately, before parsed assistant content.
- Unified-event silence and raw-stdout silence are tracked independently.
- Raw stdout no longer suppresses a heartbeat unless it becomes a real unified event.
- Heartbeats continue until the process owner stops them; the 24-hour server cap remains the
  independent lifetime bound.
- Every heartbeat includes `phase`, `unifiedEventSilentSeconds`, and `rawStdoutSilentSeconds`.
- Attempt activity records identify `provider_event`, `agent_cli_heartbeat`, or legacy unknown
  activity and preserve privacy-safe heartbeat diagnostics.
- Idle and hard-cap failures now persist as `idle_timeout` and `max_runtime_timeout`; legacy
  `timeout` records remain readable.
- The UI uses `lastActivityAt`, not a terminal record's `updatedAt`, and continues refreshing
  relative activity age after a turn ends.
- The default idle fallback is one hour. `CWV_TURN_IDLE_TIMEOUT_MS` is optional, not required.

## Reading a future heartbeat

- Both silence counters rising together: Codex has not written raw stdout; the heartbeat is keeping
  the parent alive during internal work or upstream buffering.
- Unified-event silence rising while raw-stdout silence stays low: stdout is arriving but framing or
  parsing is not producing recognized events.
- No heartbeat reaches the attempt journal: inspect the shared-CLI timer/event loop, async queue,
  and server consumer boundary.
- Terminal cause `idle_timeout`: the server saw neither a unified provider event nor bridge
  heartbeat for the configured idle window.
- Terminal cause `max_runtime_timeout`: the independent hard runtime cap fired even though the turn
  may have remained active.

## Verification

- Shared agent CLI: 168 passed, including silent startup, raw-but-unparsed stdout, and heartbeat
  operation beyond the former twenty-minute cutoff.
- Server: 156 passed, one opt-in live test skipped, zero failed.
- Client diagnostics: 8 passed.
- Dev-supervisor/watchers: 20 passed.
- API integration: 16 passed.
- Shared CLI, shared package, server, and client production builds completed successfully.
- Live attempt `3dbd678d-4d38-4278-a52e-16919b08fb7c` emitted 20 source-tagged heartbeats,
  reached 615 seconds with both silence counters still rising, and remained `running` with no
  terminal event. This crossed the former 600-second kill boundary on the repaired dev backend.
