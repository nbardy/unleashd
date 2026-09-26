# AGENT-TOOL lane (fix/claude-agent-subagents)

Worktree: /Users/nicholasbardy/git/unleashd/.claude/worktrees/lane-agent-tool
Commits (not pushed):
- submodule vendor/agent-cli-tool, branch `fix/claude-background-task-events` (from efe0503): **31469d4**
- outer, branch fix/claude-agent-subagents: **08da3f1** (includes pointer bump to 31469d4)
Push order: submodule branch first, then outer.

## 1. `Agent` vs `Task`
Recognisers that matched only `Task`, now both names from one table:
- agent-cli `src/parsers/claude.ts`: exported `CLAUDE_SUBAGENT_TOOL_NAMES` (Agent, Task); the parser uses it.
- server `subagent-tools.ts` (`isSubagentSpawnTool`, `getSubagentDescription`) and
  `turns/tool-format.ts` (emoji + summary; the duplicate `Agent`/`Task` branches merged) import it.
- crate `unleashd-ingest`: `subagents.rs` `CLAUDE_SPAWN_TOOLS` + `is_claude_spawn_tool`, which
  `text.rs` (emoji, summary) now uses as well. Rust can't share the TS set, so there are two tables and they point at each other.
- Client: no tool-name matching. `buddies/memory-review.ts` deny list already had both names.

## 2. Background task events
- Recorded fixture: `vendor/agent-cli-tool/test/fixtures/claude-2.1.283-background-agent.jsonl`
  (real `claude -p --include-partial-messages` run: Agent run_in_background + nested Bash; init line trimmed).
- agent-cli: new `UnifiedTaskEvent` = `task.started {taskId, toolUseId, background, description}` |
  `task.finished {taskId, toolUseId, status}` from `system` task_started / task_notification.
  A line with a missing field goes to stderr; nothing is filled in by guessing. task_progress, task_updated and background_tasks_changed are left out because they repeat the same information.
  Also exported `createParser`, so consumers can replay a recorded stream.
- server: `BackgroundWait` is now one instance per turn. It tracks that turn's running background task ids.
  When the last one finishes it calls the new `TurnWatchdog.endBackgroundWait()`, which puts back the normal
  provider-idle budget. `runner.ts` sends `task.*` events to it.

## Tests (each checked to fail when its fix is removed)
- agent-cli `test/claude-background-tasks.test.ts` (fails against the HEAD parser).
- server `conversation-runtime.test.ts`: "a recorded Claude 2.1 Agent launch becomes a sub-agent",
  "a recorded background agent finishing restores the idle limit". Both replay the fixture through agent-cli's real parser.
- crate `tests/formats.rs` `claude_agent_tool_is_a_sub_agent`.

## Checks, run on a clean tree so tree == HEAD
typecheck 0; test:server 199/199; test:client 167/167; agent-cli `pnpm test` 275/275 + tsc clean;
crate `pnpm test` 0 (cargo --no-default-features + node tests).

## Not done / notes
- A background `Agent` still shows as `completed` when its tool_result arrives ("async agent launched").
  `task.finished` carries `toolUseId`, so the sub-agent fold could use it to mark the real end. Not wired.
- `claude-p-background-agents-ceiling.md` agent note has been updated. CHANNEL-PARITY.md "Open" still lists both items (it is outside this worktree).
