# Error journal and bounded autonomous triage

Unleashd persists server `console.error` and `console.warn` calls after observability startup, plus
high-signal browser and React failures, to `<data-dir>/observability/errors.jsonl`. The data directory
is `UNLEASHD_DATA_DIR` when configured and otherwise defaults to `~/.agent-viewer`. Uncaught server
exceptions are captured through `uncaughtExceptionMonitor` without changing Node's crash behavior.

Operational catch boundaries must log the original error at `error` or `warn` level before they
recover, return a degraded result, or send a 5xx response. This includes top-level HTTP handlers,
Buddy execution and settlement, background review, and durable state/cache failures. Expected
control flow stays quiet: validation/authorization failures, cancellation, absent optional files,
racy file deletion, and intentionally tolerated malformed third-party transcript lines are not
journal events.

Each occurrence records its severity, inferred component, bounded message, stack trace, server boot
ID, timestamp and recognized conversation/attempt identifiers. Arbitrary objects are not serialized.
Common bearer credentials and token, secret, password, authorization and API-key assignments are
redacted. Files are mode `0600`, rotate at 5 MiB and retain four rotated files by default.

The client reports uncaught browser errors, unhandled promise rejections, React error-boundary
failures, and React root failures through an authenticated same-origin endpoint. Reports contain a
bounded message, stack, source and pathname only; arbitrary rejection objects are not serialized.
Duplicate delivery paths are suppressed briefly, each page sends at most five reports per minute,
and the server accepts at most twenty reports per minute per remote address. Expected UI validation,
WebSocket reconnects, caught request failures and general `console.warn`/`console.error` output are
deliberately not forwarded.

When the React boundary catches, the crash screen names the crash: the thrown message renders under
the heading and the full message plus stack (including the React component stack) sits behind a
`<details>` disclosure with a Copy button. Both come from `describeClientError`, the same
canonicalization the report uses, so the screen and `pnpm errors:list` show identical text. Keep it
that way — the boundary state used to be `{ failed: boolean }`, which discarded the error and left
`ReferenceError: useComposerSubmission is not defined` (2026-09-20, a half-applied HMR edit)
indistinguishable from every other crash without leaving the broken app. Guarded by
`client/test/client-error-fallback.test.tsx`.

Volatile UUIDs, numeric values and stack locations are normalized into a stable fingerprint. Repeats
increment one group's count. Acknowledgement hides the group from the default unresolved view; a
later occurrence automatically reopens it.

## Inspect and acknowledge

From the repository:

```sh
pnpm errors:list
pnpm errors:list --all --limit=20
pnpm errors:list --ack=<fingerprint> --note='Fixed by <commit or test evidence>'
```

The authenticated local API exposes the same state:

- `GET /api/diagnostics/errors?status=unresolved&limit=100`
- `GET /api/diagnostics/errors?status=all&since=<ISO timestamp>`
- `POST /api/diagnostics/errors/client` with a bounded client failure payload
- `POST /api/diagnostics/errors/:fingerprint/acknowledge` with `{ "note": "..." }`

## Autonomous review contract

A recurring Buddy automation may inspect the journal and repair one unresolved group per run. It
must reproduce the failure, inspect current Tasks and repository state, make only local in-scope
changes, run focused tests plus the relevant typecheck, and acknowledge the group with concrete
evidence. It must leave uncertain or non-reproducible groups unresolved and record the blocker on the
Task. Deployment, external actions, destructive Git operations and widening permissions remain
outside this workflow.

The automation reuses existing Buddy execution, Tasks and source files. Enabling its schedule and
background admission remains an explicit owner-controlled operation.
