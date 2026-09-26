# M5: agent-cli-tool stops the CLI on out-of-credits

Submodule: /Users/nicholasbardy/git/unleashd/.claude/worktrees/lane-memory-credits/vendor/agent-cli-tool
Branch: fix/stop-on-out-of-tokens. Commit: 076f3fe. Not pushed; outer pointer not bumped.

## Diff summary
- src/execute.ts
  - Inside `emit`, an `out_of_tokens` event sets the reason and calls `stopForOutOfTokens()`, which is
    bound to `killChild()` (SIGTERM, or the process group when detached) once the child has spawned.
    It does not set `stopRequested`.
  - Completion: when no turn.complete was seen, `completionReason === 'out_of_tokens'` is checked
    before `stopRequested || exitCode === null`, so our own SIGTERM is not reported as 'killed'.
  - Stderr processor: complete lines that start with `ERROR:` (ANSI stripped) are now classified
    as they arrive, so codex's plain-text usage-limit line emits out_of_tokens and stops the child.
    Other stderr lines are not classified live (codex logs transient retries there). The existing
    check of the last stderr line at exit (for Cursor) is unchanged.
  - There is no SIGKILL escalation in executeCommand today, and none was added.
- src/diagnostics.ts: new `isTerminalOutOfTokens(message)`. The stop is skipped when the message
  matches `rate limit exceeded`.
- test/run.test.ts: the codex shim gets a `contract-usage-limit-idle` case. It prints the measured
  `ERROR: You've hit your usage limit ...` line and then waits 30 s before exiting. The test uses
  the real executor and asserts it finishes in under 5 s, that the reason and the single
  turn.complete are `out_of_tokens`, and that `process.kill(pid, 0)` throws ESRCH.
  - Checked that it catches the bug: with the stop disabled, the test fails after 30.1 s.

## Tests
- typecheck (`tsc --noEmit`): exit 0
- `pnpm --dir vendor/agent-cli-tool test`: 276/276 pass. The new test takes about 0.35 s.

## Rate-limit decision
`rate limit exceeded` is left in OUT_OF_TOKENS_PATTERN because callers depend on it. The Buddy
memory-review ladder moves to the next provider on out_of_tokens, and the outer
server/src/turns/runner.ts keeps its own copy of the pattern. Changing the class would change what
callers see. Instead, a transient rate limit is excluded from the new stop, so a mid-turn retry log
or a non-terminal codex `error` event cannot abort a turn that would have recovered. A follow-up
could give transient rate limits their own completion reason.
