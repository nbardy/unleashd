# 01 — Ranked token-burn drivers

## 1. Provider-side context re-read (dominant)
Prior 30d probe of `~/.claude/projects` (2,588 files): input 2.5M, output
61M, cache-read 9.59B, cache-write 553M (~$5,876). Cache-read ~157x output.
Top projects: wave-physics-0to1 2.47B, wave-sim 1.68B, git-root 1.41B,
unleashd 1.18B.

Mechanism: the server sends only the latest string per turn
(`spawnForMessage` resume/fork wiring — `server/src/conversations/runtime.ts`,
search `resumeSessionId`/`forkSessionId`), but the provider CLI resume
re-feeds the full transcript each turn and re-prices it as cache-read.
Fixes live provider-side (compaction, shorter threads), not in server
message assembly.

## 2. Long agentic outputs
61M output tokens/30d. Each provider turn streams full tool-call + text
output. Provider-internal subagents (`Task`/`spawn_agent` running INSIDE the
provider CLI, inheriting full parent context) multiply this invisibly to
the server — the largest unobservable bucket.

## 3. Buddy briefing re-fetch + first/refresh-turn prefix
`server/src/buddies/integration.ts:16-23` — caps total 40k chars (prefix
1.6k, suffix 2.6k, soul 10k, rel 4k, skills 8k, work 4k, activity 2k).
`server/src/conversations/runtime.ts:584-632` `buildFirstTurnCliContent`
dispatcher. Bounded per turn (~10k tokens worst case) but re-composed every
turn and re-injected on first/refresh turns. Fork-inheritance path skips
re-injection. Residual duplication: memory snapshot + briefing both embed
soul/memory; review-result HTML comments persist in-transcript.

## 4. Branch/handoff + background-run prompt assembly
`server/src/buddies/run-executor.ts:441,511` — 60KB history cap; handoff
slices last 60k chars of JSON-stringified messages into the prompt (~15k
tokens), repeated per retry/recovery turn. Claim-token/policy appends
(`run-executor.ts:459-469`: background-work, recovery-successor, checkpoint
lines) fire every attempt — small (~100–300 tok) but paid on every cached
re-read.

## 5. Buddy-to-buddy fan-out
`server/src/buddies/dispatch-service.ts:337-362` creates fresh-context
conversations with a synthesized initial message (no transcript copy —
cheap per message), but each recipient starts a full new provider session
(briefing + resume loop), so fan-out N multiplies drivers 1–3 by N.
Dispatch initial-message boilerplate (9-line permission/reply-schema
wrapper) + swarm-debug prefix comments add per-message overhead.

## 6. Process-spawn overhead is NOT token burn
`vendor/agent-cli-tool/src/process-runner.ts:31-55` `runCommand` → single
`spawn(effectiveBin, args)`; argv builder `vendor/agent-cli-tool/src/build.ts:48-177`;
stdin-prompt avoids argv limits. Cost is latency/fd, not tokens.
No `node:worker_threads`/`new Worker` per buddy worker — cost per worker =
1 provider-CLI child_process + 1 provider session.

## MCP context size (unmeasured gap)
MCP passes as CLI argv args + env overlay (`build.ts:119-175`,
`mcpEncoding.args` → argv, `mcpEncoding.env` over `process.env`).
Server selects per audience (`runtime.ts:1065-1109`
`buddyMcpServers`/`buddyBuilderMcpServers`/`buddyOwnerMcpServers`;
`assertBuddyProviderSupportsMcp` refuses spawn when unsupported). Owner
workflow guidance stays in native MCP tool descriptions, deliberately NOT
appended to provider input (`runtime.ts:2366-2368`) — saves per-turn tokens
but means tool-description tokens are paid opaquely inside the provider CLI.
No byte count exists server-side; Hook E (03) proposes measuring at the
`buildCommand` spec (argv/env JSON length) + provider tool-list estimates.
