# `claude -p` background agents: 10-minute ceiling, held replies, lost answer

Investigated 2026-09-25/26 by Product Development Lead, from the wave_sim thread
`post_6eb50680…` (Product Engineer, seat conversation `55eaf872…`, Claude
session `dbfcd9c4-62ea-4322-b6b7-ff4d4701a1fd`, Claude Code 2.1.282).

## What happened (all times UTC, 2026-09-25)

| Time | Event | Source |
|---|---|---|
| 14:55:15–14:56:05 | Turn launches L1–L5 with `Agent run_in_background:true` | session jsonl |
| 14:56:29 | Answer text written ("five background workers are running…"), main thread idle | session jsonl `stop_hook_summary` |
| 15:05:41 | L5 finishes; its notification wakes the main thread; census text written 15:06:02 | session jsonl |
| 15:16:02 | Exactly 600 s after the 15:06:02 idle: Claude Code stops L1–L4 mid-edit and exits | subagent jsonl gaps; `attempt_terminal … provider_complete` 15:16:03 |
| 15:16:03 | Unleashd posts the combined reply (20 min after the answer was ready) | `buddy_list_posts.created_at` |
| 16:19:10 | Owner asks "Is this still running?"; resume injects "4 background agents didn't finish before the previous session ended"; model resumes L1–L4 via SendMessage | session jsonl |
| 16:20:21 | Answer written ("They weren't running … I've resumed them"), idle | session jsonl |
| 16:30:22 | Ceiling again: L1–L4 stopped a second time; reply posted as `(no reply text)` (`post_dd003748…`), so the 16:20 answer never reached the channel | subagent jsonl, `buddy_list_posts` |

## Mechanism

- Print mode waits for background tasks after the main thread goes idle, up to
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (default `600000`, constant `Ck` in
  2.1.282), measured from the most recent idle. Then it writes
  `Background tasks still running after 600s; terminating.` to stderr, stops
  the agents and exits **0**; stream-json reports `result: success`. The
  runtime records `succeeded / provider_complete`; nothing says work was killed.
- Every model turn gets its own stream-json `result`, but **all of them are
  flushed at exit**. Measured: the answer was ready at 6.9 s, the worker finished
  at 14.8 s, and both `result` events arrived at 23.4 s. The parser keeps only
  the first (`turn.complete` is deduped in `execute.ts`).
- Background task lifecycle DOES stream live as `system` events:
  `task_started` (description, `is_background`), `task_progress`,
  `task_updated`, `task_notification`, `background_tasks_changed`.
  The claude parser drops them today.
- The channel reply is the last assistant message at process exit
  (`server/src/conversations/runtime.ts` `buddy-turn-complete`). Activity after
  the real answer (here a notification dequeued at the ceiling) can replace it
  with an empty message.
- On `--resume`, stopped agents surface only as an injected
  `<task-notification><status>stopped</status>` user message.

## Answers to the owner's three questions

1. The sub-agents did not time out or crash on their own. Claude Code's
   print-mode ceiling stopped them, 10 minutes after the parent went idle,
   twice.
2. Multiple messages are possible today: `post({listId, threadId})` works
   mid-turn. The channel brief (`channel-responder.ts` `buildPrompt`) says
   "Do not also call post for this reply", and models read that as "one
   message only". The final reply cannot report progress: it is held until
   every background agent ends.
3. No links: posts carry `sender_conversation_id`, but the thread UI does not
   render it, and Claude background agents are not surfaced as runs.

## Tests

`vendor/agent-cli-tool/test/live-claude-background-agents.test.ts`
(`pnpm test:live:claude-bg` inside the submodule; opt-in, real CLI, ~3 min).
The three tests pin: answer held until the worker ends; ceiling stops the worker
with exit success, and the resume reports it stopped; raw stream shows
`task_*` live while `result`s flush at exit.

Probe-writing gotcha: Claude Code's Bash tool refuses a leading `sleep N`
(`Blocked: sleep 30 followed by: …`). A worker told to `sleep 30 && touch x`
therefore finishes instantly having done nothing. Use `python3 -c "time.sleep"`.

## Follow-up, 2026-09-26: the 20 minutes was not an Unleashd timeout

Re-read of session `dbfcd9c4` (419 lines) and `turn-attempts.jsonl`.

The parent did not run out of tokens and Unleashd did not cut the turn at 20
minutes. Every assistant stop in that session is `tool_use` or `end_turn`.
There is no `max_tokens` stop. The idle the owner saw is the model ending its
turn on purpose:

| Time (UTC) | stop_reason | output tokens | cache read |
|---|---|---|---|
| 14:56:29 | `end_turn` | 2394 | 178322 |
| 15:06:02 | `end_turn` | 580 | 192557 |
| 16:20:21 | `end_turn` | 1241 | 223786 |

The ~20 minutes is wall clock from the first answer (14:56:29) to the post
(15:16:03): about 10 minutes of the parent still working after L5 woke it,
then exactly 10 minutes of Claude's print-mode ceiling. Both exits are
`attempt_terminal` / `terminalCause: provider_complete` (15:16:03 and
16:30:22). Unleashd's own limits, from `server/src/constants/timeouts.ts`:

- turn max runtime: 24 hours (`CWV_TURN_MAX_RUNTIME_MS`)
- provider idle: 60 minutes (`CWV_TURN_PROVIDER_IDLE_TIMEOUT_MS`). Wrapper
  heartbeats do not reset this, and the native-session probe is Codex-only,
  so a silent Claude wait still dies here.
- bridge stall: 2 minutes, reset by those heartbeats

No 20-minute constant exists.

## 12-hour ceiling

`vendor/agent-cli-tool` now sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` to
`43200000` (12 hours) on every Claude spawn when the parent environment has
not set it. An explicit value still wins (the live ceiling test sets `10000`).
Unit test: `test/build.test.ts` ("defaults the print-mode background wait to
12 hours"). Branch `test/claude-bg-ceiling-2026-09-26`, not pushed.

That does not by itself let a Buddy turn wait 12 hours. While the parent is
idle, the Claude parser drops `task_*` events, so Unleashd sees only
heartbeats and the 60-minute provider-idle watchdog still kills the process.
