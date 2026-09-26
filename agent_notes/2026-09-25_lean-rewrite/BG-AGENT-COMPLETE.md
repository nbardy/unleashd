# BG-AGENT-COMPLETE (fix/background-agent-completion, worktree lane-bg-complete)
Commit: fe98768 (not pushed, not merged). Submodule untouched.
- server/src/turns/subagents.ts: SubAgentFold gains taskStarted/taskFinished. tool.use has no call id, so
  task.started binds to the spawn whose input.description it repeats verbatim (Bash/nested tasks match none);
  the call id is kept as providerThreadId. task.finished marks it completed, any other status -> error
  (rawStatus kept, statusSource native). Folds are now one per turn (factory table, like BackgroundWait).
- runner.ts: applyTaskStarted/Finished also feed the fold. Turn-end rule unchanged: parentCompleted
  completes still-running agents; timeout fails them (failRunningSubAgents).
- Test: conversation-runtime.test.ts "a recorded background agent stays running until its task finishes"
  replays the recorded fixture through agent-cli's parser; running after the launch result, completed after
  task.finished. Fails without the fix (actual 'task.finished:running').
- Crate not touched: subagents.rs never reads tool results; replay marks every recorded run completed by
  definition (finished transcript), ending where the next spawn starts. No launch-time completion to fix.
- Checks on clean tree (tree == HEAD): typecheck 0; test:server 198 pass / 0 fail / 1 todo.
