# Memory unification board

Integration: lane branches off `lean/integration`, merged back by the orchestrator after the gate.

| ID | Task | Files owned | Depends | Status |
|---|---|---|---|---|
| M1 | One memory per Buddy: delete Thread/Task scopes, docScopeFor, grant.scope; DocRef sum; session key from origin + its test; todo test → real | crate types/docs/schema/index.d.ts, core.ts, briefing.ts, mcp.ts, grants.ts, policy-port.ts, runner.ts, turn-policy.ts (context/audience), shared knowledge scope, routes.ts, BuddyMemory.tsx, memory-review.ts (scope lines only) | — | gated green 11ceb54 (with M2 merged) — awaiting merge into lean/integration |
| M2 | Importer folds per-audience memory into one doc per Buddy; export-notes archives the rest; verify | crates/unleashd-buddies-import/* | — | done, merged into lane/memory-unify |
| M5 | agent-cli-tool: stop the CLI on out_of_tokens | vendor/agent-cli-tool (submodule) | — | done 076f3fe in submodule branch fix/stop-on-out-of-tokens — push + pointer bump = owner gate |
| M3 | Reviewer sees tool calls, runs in the workspace, read-only tools, per-attempt 300 s, tightened prompt | memory-review.ts (harness/transcript), turn-policy.ts reviewCompleted | M1 | gated green 7806092 on lane/memory-reviewer (on top of M1) |
| M4 | Port live curation harness + relevance cases (running = owner gate) | server/test/fixtures/memory-curation/*, a live test file | M3 | gated green beb8c66 on lane/memory-bench (contains M1+M2+M3); live run = owner gate (30 calls) |

Wave 1: M1, M2, M5 in parallel (file-disjoint). Wave 2: M3. Wave 3: M4.
Owner gates: running M4 live (credits); the v33 → v3 swap (existing T15).

**Landing:** `lane/memory-bench` (beb8c66) contains M1+M2+M3+M4, full gate green. Merge it into lean/integration; M5 lands separately (submodule push + pointer bump).
