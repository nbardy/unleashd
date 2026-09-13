# Preserved audit evidence — 2026-09-12

Start with the [consolidated Markdown audit](../AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md). This directory contains immutable-at-audit-time evidence snapshots and runnable diagnostics, not application fixes.

**Observed-defect diagnostics intentionally assert broken behavior. A passing diagnostic proves the recorded bug still exists; it must not be counted as a passing acceptance test.** They remain outside `server/test/` and `client/test/`. They use isolated stores and controlled provider inputs, never the live Buddy database.

| Evidence | Files |
|---|---|
| Original transcript remains intact | [File hash, size, exact line and bounded excerpt](original-transcript-check.json) |
| Rotate → poll → restart loses older history | [Diagnostic](history-rotate-poll-reload.observed.ts), [result](history-rotate-poll-reload.result.json), [source/excerpt manifest](history.evidence.json) |
| Unrelated changes reset a real runtime session | [Diagnostic](history-unrelated-key-reset.observed.ts), [result](history-unrelated-key-reset.result.json) |
| Capability privacy, continuity keys, note cap, append-only negative control | [Diagnostics](privacy-adjacent.observed.ts), [results](privacy-adjacent.result.log), [source/excerpt manifest](privacy.evidence.json) |
| Deletion during linking | [Controlled diagnostic](delete-during-link.repro.ts), [work/retry manifest](work-retry.evidence.json); read the work/retry Markdown for limits and later stronger evidence |
| MCP regex and resource contracts | [Diagnostic](mcp-contract.repro.ts), [manifest](mcp-contract.evidence.json), [Markdown review](../../../agent_notes/2026-09-12-audit-mcp-contract.md) |
| Installed/archive/source parity | [All 25 package-file comparisons](package-equivalence.json), [87 package tests](package-full-tests.result.log) |
| Full server tests | [Exact command and outcome](server-full.result.json), [raw output](server-full.output.txt) |
| Full client tests | [Exact command and outcome](client-full.result.json), [raw output](client-full.output.txt) |
| Type checks and client invariants | [Shared](shared-typecheck.output.txt), [server](server-typecheck.output.txt), [client](client-typecheck.output.txt), [six gates](client-invariants.output.txt) |
| Reviewed mixed working tree | [Baseline hashes and git identity](source-baseline.json), [end comparison](source-comparison.json) |

Run the history observations from the repository root:

```sh
pnpm exec tsx product/buddies/audit-2026-09-12/history-rotate-poll-reload.observed.ts
pnpm exec tsx product/buddies/audit-2026-09-12/history-unrelated-key-reset.observed.ts
```

Run the other bounded diagnostic/check fixtures:

```sh
pnpm exec tsx --test product/buddies/audit-2026-09-12/privacy-adjacent.observed.ts
pnpm exec tsx --test product/buddies/audit-2026-09-12/delete-during-link.repro.ts
pnpm exec tsx --test product/buddies/audit-2026-09-12/mcp-contract.repro.ts
```

The broad existing-test total is **468 passing = 305 server + 76 client + 87 package**, plus **3 skipped live server tests**. Focused runs overlap those suites. New diagnostics are excluded from that total.

The native audit project is `buddy_project_df4b429d-c8c4-458c-9a4f-52322b4b9db8`. Follow-up repairs A1–A7 are recorded separately in `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`; the native records own status and next actions. Append-only correction note: `knowledge_6abd482c-a7ca-43da-a4a9-72c45dc63b7b`. These pointers do not grant execution authority or indicate production deployment.
