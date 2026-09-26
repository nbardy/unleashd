# M3 report: the memory reviewer sees the turn and stops failing for avoidable reasons

Branch `lane/memory-reviewer`, commit 7806092 on top of 11ceb54. Not merged, not pushed.
Shortstat vs 11ceb54: 6 files changed, 264 insertions(+), 60 deletions(-). About 110 of the
insertions are tests.

## Changes
- **Transcript includes tool calls** (`turn-policy.ts reviewCompleted`, `memory-review.ts reviewTranscript`).
  `toolCall` is passed through. Each tool call becomes `[tool call] <name> <input>`. The input is cut
  at 400 chars and followed by `…[truncated N chars]`. A call with no input shows its name only.
  Names are shown exactly as the harness gave them. The 48 KB newest-first budget and the
  omitted-history note are unchanged.
  - Caveat: live turns fold tool calls into assistant `content` through `formatToolUse`, as
    `🔧 Name summary` with a 100-char summary. They do not set `toolCall`. Only ingested or
    structured messages carry `toolCall`. This change makes those visible. Live turns already
    show their short tool line.
- **cwd is the workspace root.** It comes from `core.listWorkspaces()` by `workspaceId`. If the
  workspace is missing, a `failed` receipt is written. Codex's `model_instructions_file` still
  lives in a private `mkdtemp` directory, which is deleted afterwards. Nothing is written into the
  workspace.
- **Cursor transcript discard fix (needed by the cwd change).** `discardCursorTranscript` used to
  `rm -rf` the whole `~/.cursor/projects/<encoded cwd>` directory. With cwd set to the workspace,
  that would have deleted the owner's own Cursor history for the repo. For example,
  `Users-nicholasbardy-git-unleashd` holds dozens of sessions. It now removes:
  - the run's `agent-transcripts/<sessionId>`;
  - the `agent-tools/*.txt` spill files that its transcript names;
  - the project directory itself, only when no other session is left in it. This keeps the old
    behaviour for the reply gate's private cwd.

  Residual risk: a spill file that the transcript does not name would be left behind, never an
  owner file deleted. Guard: `cursor-ephemeral.test.ts` (shared-directory case).
- **Claude reviewer gets `--no-session-persistence`.** Without it, a run in the workspace would be
  ingested as a chat in that folder.
- **Timeout per rung.** `MEMORY_REVIEW_TIMEOUT_MS = 300_000` now applies to each ladder attempt,
  through its own AbortController inside `runAttempt`. The queue-level timer is gone, and `stop()`
  still cancels. A timed-out rung climbs like `out_of_tokens` (the `Attempt` type is now
  `success | climb`). A tool violation or crash still does not climb. `memoryRead` resets on each
  rung, so a rung that follows a timed-out one must read memory itself.
- **Instructions tightened:**
  - the two docs;
  - "update when relevant": in-flight → working, resolved → remove from working, lasting
    preference or lesson → long_term, nothing new → NONE with no writes;
  - it may read workspace files read-only to check a claim, and must never write.

  The curation README has a dated "2026-09-26 change (M3, unbenchmarked)" note. It says the prompt
  has not been rerun (the live harness was removed in T11), so 19/20 does not apply. It also lists
  the four other variables that changed at the same time, and the stale 120 s line is corrected.

## Per-harness read-only decisions (evidence)
| Harness | Allowed besides doc_read/doc_write | Evidence |
|---|---|---|
| Codex | `shell` (re-enabled `shell_tool` and `unified_exec` by removing them from `--disable`) | `-s read-only` is codex's OS sandbox: no writes, no network. The agent-cli parser (`parsers/codex.ts:170,204`) turns every `command_execution` into tool.use `shell`, whatever the underlying tool (`exec_command` or shell). apply_patch arrives as `file_change` and stays refused. `codex features list`: both features are stable and on by default. |
| Claude | `Read`, `Glob`, `Grep`: added to `--allowedTools`, removed from the deny list | `Bash`, `Write`, `Edit`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, `Agent`, `TodoWrite`, `Skill` and `ToolSearch` are still named in `--disallowedTools`. The comment about 2.1.267 (allow-list does not remove built-ins) is still why the deny list exists. |
| Cursor | `read`, `glob`, `grep` (tool.use names are the `<kind>ToolCall` key without `ToolCall`, `parsers/cursor.ts:79`) | `agent --help`: `--mode ask` is "Q&A … (read-only)". EVIDENCE §2 saw `read`/`shell`/`glob` refusals. **`shell` stays refused**: nothing I found documents that ask mode sandboxes shell commands, and `--force` (required for MCP) auto-runs any tool that is exposed. |
| Muse | unchanged | `--disable-shell --disable-write` exist, but I found no evidence of a read-only file tool mode. |

**Guard behaviour I chose:** a refused tool still ends the attempt at its `tool.use`. The unified
event stream has no call id (`runtime-types.ts:173-174`), so a `tool.result` cannot be tied
reliably to the call that produced it. That makes "did the CLI execute or refuse it" impossible to
decide per call. Every write-capable tool is also removed at the CLI level (sandbox, ask mode, deny
list). So a refused name now means the harness surface changed, and that should fail loudly. The
avoidable cause (verifying a claim with a read tool) is no longer refused. This is documented on
`Harness.authorizes`.

Not verified live: I made no real model calls, to avoid spending credits. The first real reviews
under each harness should be checked for unexpected refusals with `pnpm errors:list` and the
receipts.

## Tests (server/test)
- `buddies-v2.test.ts`, ladder test extended. Its turn includes `toolCall` entries: a
  621-char `Read` and an input-less `exec_command`. The rung-2 `request.prompt` contains
  `[tool call] Read agent_notes/theme.md y…[truncated 221 chars]`, does not contain 401 `y`s, and
  contains `[tool call] exec_command`. Every rung's `request.cwd` is the workspace root.
- `buddies-v2.test.ts`, new test. `timeoutMs: 200`; the codex rung hangs until it is stopped, and
  the cursor rung reads memory. The receipt is `complete` with model `grok-4.7-low` and
  `fallbackFrom` `gpt-6-luna`. Under the old whole-ladder timer this was `interrupted`.
- `cursor-ephemeral.test.ts`, new case. In a shared project directory, only the run's transcript
  and the spill it names are removed. The owner session and the owner's spill remain.

## Checks (at 7806092, clean tree)
- `pnpm addons`: cache hit for both.
- `pnpm typecheck`: exit 0.
- `pnpm test:server`: 201 tests, 201 pass.
- `pnpm test:client`: 179 tests, 179 pass.
- `check-client-invariants`: all 8 gates pass.
- biome format and lint are clean on the changed files.
- `git status --porcelain` is empty.
