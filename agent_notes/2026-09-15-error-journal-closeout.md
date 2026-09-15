# Error journal and catch-boundary audit closeout

Date: 2026-09-15

## Outcome

Unleashd now has a bounded, rotating JSONL error journal for actionable server failures. It preserves stack traces and useful context after redacting credential-like values, groups repeated failures by stable fingerprint, and exposes unresolved groups through a local HTTP boundary and CLI. Operators can acknowledge a group with evidence.

Implementation commit: `8cbfc6e` (`feat(server): persist operational errors`).

## Catch-boundary audit

The audit reviewed all 216 `catch` and `.catch` boundaries under `server/src`. Each boundary was classified as one of:

- operational failure that must be emitted through `console.error` or `console.warn` and therefore captured by the journal;
- intentional control flow, probe, fallback, cleanup, or best-effort handling where silence is expected;
- rethrow/rejection where the caller remains responsible for recording the terminal failure.

The final classification retained 97 intentional control-flow catches and 34 rethrow/rejection paths. Operational gaps were instrumented, and a final Express error handler records otherwise-unhandled HTTP failures before returning a generic 500 response.

## Main surfaces

- `server/src/observability/error-journal.ts`: schema, redaction, fingerprinting, grouping, rotation, retention, acknowledgement, and console capture.
- `server/src/http/error-diagnostics-routes.ts`: local list/detail/acknowledgement boundary.
- `tools/error-log.ts`: operator CLI exposed as `pnpm errors:list`.
- `server/test/error-journal.test.ts`: persistence, grouping, rotation, redaction, acknowledgement, and captured-console coverage.
- `docs/error-journal.md`: record format, retention, API/CLI usage, and operating constraints.
- `server/src/server.ts`: startup initialization, console capture installation, shutdown flush, diagnostics route, and final Express error boundary.

The Buddy conversation admission path also ensures the durable conversation link before send, queue, or interrupt. Its regression coverage lives in `server/test/buddy-conversation-contract.test.ts`; that broader mixed work remains outside commit `8cbfc6e`.

## Verification

- Server suite: 369 passed, 5 skipped, 0 failed.
- Server typecheck: passed with `pnpm -C server typecheck`.
- Selected-file Biome checks: passed.
- Staged diff validation: passed with `git diff --cached --check`.

The commit was deliberately staged hunk-by-hunk because the shared worktree contained extensive unrelated Buddy and client work. Those changes were left untouched. Logging added inside the currently untracked `memory-review.ts` and `run-executor.ts` will travel with those files when their owning feature is committed; neither file was folded into the error-journal commit.

## Remaining authorization boundary

Automation `automation_2c140768-da08-4412-a691-356b1fbc0ad2` is configured but disabled. Enabling the daily 09:00 Asia/Makassar triage requires explicit owner-controlled `schedule.manage` and background-execution grants. The implementation does not infer or bypass that authority.
