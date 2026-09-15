# Error journal and bounded autonomous triage

Unleashd persists server `console.error` and `console.warn` calls after observability startup to
`<data-dir>/observability/errors.jsonl`. Uncaught exceptions are captured through
`uncaughtExceptionMonitor` without changing Node's crash behavior.

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
