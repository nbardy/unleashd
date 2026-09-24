# Execution selection, typed turn failure, and harness-fact consolidation

Owner decision · 2026-09-24 · Product Development Lead owner thread · status: **in progress**

Amends [Channel conversations](CHANNEL_CONVERSATIONS_2026-09-23.md). Read
[the lean core](CORE_DESIGN.md) first.

## Workflow gap

A channel `@mention` runs on the Buddy profile's harness (silently `codex` when
unset). When that provider is out of credits the reply fails and the owner has
no way to pick another harness — the chat UI can, channels cannot. Underneath,
the same facts (providers, models, capabilities, completion reasons, credit
exhaustion) are re-declared in `agent-cli-tool`, `shared/`, the server and the
client, and "which model does this Buddy turn run on" is decided six different
ways.

## Decisions

| # | Decision |
|---|---|
| D1 | A Buddy profile's `reasoning_effort: null` means **model default**. Profiles cannot express "reasoning off". One shared function `buddyProfileConversationConfig(profile)` is the only profile → `ConversationConfig` mapping (server and client). No `'codex'` literal fallbacks anywhere: a profile without a provider is a typed error (`no_execution_profile`). |
| D2 | Run `error_code` is a typed union (`BuddyRunErrorCodeSchema`, shared). Interruption-class turn causes (`server_restart`, `bridge_timeout`, `provider_idle_timeout`, `idle_timeout`, `timeout`) are written as `interrupted` so the package's interruption report fires; the precise cause stays in the run's error text. One table maps `TurnTerminalCause → BuddyRunErrorCode`. |
| D3 | The Mailbox composer that lets the owner post **as a Buddy** is deleted. Lists use the shared owner `ChannelComposer`. The owner writes as themself. |
| D4 | The dashboard's un-keyed send stays (changing it changes owner dispatch semantics) — out of scope. The test-only delegation/review dispatch chain is deleted. |
| D5 | `memoryReviewAfterEachTurn` is removed; the independent turn reviewer is the only capture path. |
| D6 | A new Buddy thread seeds from the Buddy's latest thread config, else the profile — never the global new-chat draft. |
| D7 | The `@` mention chip picks provider/model/reasoning. The choice travels as a typed request field `executions: Record<buddyId, ConversationConfig>` on the owner post (not encoded in the mention link). Default shown: that Buddy's last execution in the thread, else its profile. |
| D8 | A failed mention reply shows cause and model **derived at read time** from the turn-attempt journal and the conversation config record (no new post columns, no package migration). The trigger post is referenced as evidence `post:<triggerId>`. |
| D9 | `POST /api/buddies/lists/:listId/posts/:postId/rerun {key, config}` re-dispatches the failed reply's trigger with the chosen config through the same `dispatchMention` as a new post. Reply keys are per attempt: `mention-reply:<trigger>:<buddy>:<dispatchKey>`. |
| D10 | Channel conversation ids include the resolved execution (`provider/model/effort`), like lead return threads. Existing threads get a fresh conversation on the next mention; the thread context is re-rendered from posts so nothing is lost. DM ids are unchanged. |
| D11 | `buddy-turn-failed` carries `TurnFailure = {cause: TurnTerminalCause, message}`. One `runTurn(): Promise<TurnOutcome>` on the runtime replaces the external once/off wrappers; the synchronous durable callbacks (`onDrained`, `finishBuddyChatRun`) keep their ordering. |
| D12 | `agent-cli-tool` owns harness facts. A Node-free subpath `@nbardy/agent-cli/catalog` exports plain data: `HARNESSES`, typed `CATALOG`, `HARNESS_CAPABILITIES`, `COMPLETION_REASONS`, `SUBAGENT_STATUSES`, `PROGRESS_SOURCES`, types `TurnUsage`, `RequiredMcpHarness`. The root exports `classifyError`; every failure path in `execute.ts` goes through it. `shared/` builds zod schemas from those tuples. Effort levels stay `z.string()` pass-through (hard rule). |
| D13 | Out of scope: fallback model ladders; moving the memory reviewer's argv into the submodule (benchmark-guarded); the un-keyed send. |

## Waves

Each wave is committed on `feat/execution-selection-2026-09-24` and verified
against the commit.

1. **Dead code and bugs.** Server: delete unused ports/exports/branches, delegation/review chain (D4), `memoryReviewAfterEachTurn` (D5), scheduler compat for impossible states, move legacy automation cancellation into the scheduler, typed run error codes (D2). Client: dead exports/props, duplicated helpers (initials, status labels, available-id set, channel helpers, automation run hook, conversation link), Mailbox composer (D3). Submodule: D12 exports + `execute.ts` classification.
2. **Consume harness facts.** Bump the submodule; `shared/` derives schemas from the subpath; delete the five catalog loaders, codegen, `FALLBACK_*` lists, duplicate regex, capability sets; move channel/memory/status/turn-attempt types to shared schemas.
3. **Server core.** One resolver with the capability check, execution required at conversation creation, `runTurn`/`waitForIdle`, one conversation-opening helper for DM and channel, `conversation-ids.ts`, one profile execution patch + validator for all create/update paths, typed `TurnFailure` (D11).
4. **Feature.** `dispatchMention`, `executions`, rerun route, read-time failure/model enrichment, execution-scoped channel ids (server). Shared config picker usable by mobile, mention chip, failed-reply Rerun, unified profile editor, `describeConfig`, `buddyConversationSeed`, mobile model sheet on the shared picker (client).
5. **Harness events.** Consume `subagent.state` and delete the app's Codex re-parser; execution snapshot carries `ResolvedExecutionConfig`.
