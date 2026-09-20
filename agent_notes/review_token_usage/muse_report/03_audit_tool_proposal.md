# 03 — Audit-tool proposal (hooks A–E)

Goal: per-conversation/per-buddy attribution without touching provider CLIs.
Home: new `server/src/usage/` module consuming the existing
`server/src/http/usage-routes.ts` parsers.

- **Hook A — spawn ledger.** Wrap `runCommand`
  (`vendor/agent-cli-tool/src/process-runner.ts:31`) + `executeCommand`
  (`vendor/agent-cli-tool/src/execute.ts:153`): log `{ts, conversationId,
  buddyId, kind, provider, model, argvLength, stdinBytes, envMcpBytes,
  resume/fork ids}`. Zero token cost; gives per-spawn fixed-cost bytes.
- **Hook B — briefing meter.** Wrap `composeConversation`
  (`server/src/buddies/integration.ts`) + `buildFirstTurnCliContent`
  (`server/src/conversations/runtime.ts:584`): log `{briefingChars,
  per-section chars vs caps, firstTurn|refresh|skip}`. Detects cap creep +
  refresh storms.
- **Hook C — handoff meter.** Wrap `run-executor.ts:400-469` prompt assembly:
  log `{handoffChars, truncated?, retryOfRunId}`. Flags 60KB-cap hits.
- **Hook D — provider-usage joiner.** After each turn close, join the spawn
  ledger row with `GET /api/usage` delta (per-session token rows) by
  sessionId; attribute cache-read/output to conversationId. Closes the
  server↔provider visibility gap with no new provider APIs.
- **Hook E — MCP sizer.** Log JSON length of the `mcpServers` spec at
  `vendor/agent-cli-tool/src/build.ts:123` + resolved argv/env bytes;
  periodically dump a provider tool-list token estimate.

Output: per-conversation/buddy table (fixed bytes, briefing bytes, handoff
bytes, cache-read, output, est $) + refresh/handoff histograms + fan-out
multiplier. Alerts: 60KB handoff hit, briefing >30k chars, refresh rate
>1/5 turns. Note `product/buddies/BUDGETS_AND_LIMITS.md`: token/cost fields
are compatibility data, not spending controls — active control today is
provider wall-seconds (background-run deadline
`min(3600, policy||600)s`), so token burn within a deadline is unbounded;
a token budget would be new work.
