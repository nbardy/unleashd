# MCP resource contract and owner parity audit

Observed 2026-09-12 09:42 UTC. Independent second audit lane for the owner's requested full review. Only audit artifacts were written. All exercised mutations used isolated in-memory stores; no live Buddy state, team configuration, grants, schedules, or external accounts were touched.

## Confirmed contract defect: regex is advertised but unusable in current scoped recall

The actual MCP catalog advertises `regex` as a boolean and says, “Literal matching is the default; regex must be explicitly enabled.” See `server/src/buddies/operations.ts:229` (schema, boolean at line 235) and `server/src/buddies/mcp-server.ts:100` (description). Actual current owner-thread calls select scoped recall at `operations.ts:1420`. `server/src/buddies/knowledge.ts:155` unconditionally throws when that accepted boolean is true.

An isolated real MCP transport test called `listTools`, verified the advertised field/description, and then called the same tool twice. Literal search succeeded; `{pattern:"audit|finding",regex:true}` returned `isError:true` and `Scoped knowledge search supports literal matching only`.

This is a reproduced public contract defect, not a privacy disclosure. The legacy path in `operations.ts:1433` retains regex handling, explaining the mismatch: the current scoped path changed while the shared schema and public description did not. Recommendation: make the current catalog describe and validate actual scoped search capabilities, or deliberately implement bounded authorized regex. Treat compatibility behavior explicitly. This is an assistant repair proposal, not a decision to add regex support.

Diagnostic: `product/buddies/audit-2026-09-12/mcp-contract.repro.ts`. Its first test intentionally asserts the observed bug, so passing means the advertised capability is still broken.

## Confirmed documentation drift: canonical coordination guide teaches the legacy send shape

`product/buddies/PLANNING_PRIMITIVES.md:18` teaches `send({to, purpose, body, evidence?, projectId?, wait?, timeoutSeconds?})`. Line 39 still promises `timeoutSeconds` default 120 and maximum 600. AGENTS.md explicitly directs agents to this file before coordination work, and the document labels itself the current contract.

The current public resource schema instead requires `key` and a strict `delivery` discriminated union (`inform`, `request`, `work`) in `shared/src/buddy-resources.ts:50`. The current MCP description at `mcp-server.ts:235` explicitly says there is no wait/boolean matrix; it overrides the retained legacy description for current clients. Following the guide's example therefore fails current schema validation. Compatibility entry points still accept old shapes, so the correct repair is a clearly labeled current guide and an explicit legacy section, preserving historical decision notes.

Preserved guide excerpt and SHA-256 `d3e53f9ceb705eff7830b5fc55d1547a94992eb99386cf88ff4980cc61b040b3` identify the exact document reviewed; no historical reports were edited.

## Boundaries verified, with no new defect found

- Current catalogs hide superseded `get_soul`, `get_memory`, `update_memory`, and hiring aliases; legacy compatibility remains separately selected.
- Current send uses exact delivery variants and rejects invalid combinations. Automation schemas retain discriminated action variants rather than flattening them.
- Owner `get_document` with omitted scope intentionally exposes the global/default compatibility document. Supplying the exact owner-thread scope returns a different opaque revision bound to that scope. Cross-scope revision reuse is rejected with `INVALID_REVISION` before content changes; this was exercised through owner MCP.
- `shared` and `note` refs now require name and audience; a nameless note request is rejected. This verifies the earlier advertised-optional/runtime-required mismatch is repaired.
- Existing owner authority tests reject stale, spoofed, employee, maintenance, and foreign scopes, and cancellation while awaiting the store fences the commit. No proof of a remaining owner authorization bypass was found in this lane.

## Verification and preserved evidence

```sh
pnpm exec tsx --test product/buddies/audit-2026-09-12/mcp-contract.repro.ts server/test/buddy-resource-contract.test.ts server/test/buddy-employee-contracts.test.ts server/test/buddy-owner-authority.test.ts
```

Result: **12 passed, 0 failed, 0 skipped**: 10 existing acceptance tests plus one observed-defect diagnostic and one added boundary check. These are controlled in-memory MCP/HTTP tests, not a live model acceptance run.

`product/buddies/audit-2026-09-12/mcp-contract.evidence.json` preserves command, source hashes, and exact observations. Diagnostic SHA-256 `ee2a9e2cd20d8925fb045a922d957f2fe5ec897b06eaefa1666089856addf58f`; `mcp-server.ts` SHA-256 `bfb51f72dc0c8f78933f33a094cddeb6dd9b368e2f474fd937569b34d5e118a9`; `knowledge.ts` SHA-256 `010740aefb612d451f0204a50a235e7864627d6ba203df1553cbda66051fbb20`; shared resource schema SHA-256 `2aa546d4e73c904552f80810e9315d3244f2ef927e8e7dc396733ba0019dbada`.

Related lane: `agent_notes/2026-09-12-audit-work-retry.md` verifies the R4/R5 repairs and records a provisional deletion/readiness gap with its limitations. Authoritative project state remains the parent lead's work record; these Markdown files preserve evidence and recommendations.
