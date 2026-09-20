# Token-usage review: Muse report (2026-09-17)

Question: token burn feels too fast — useless messages? input-token volume?
worker-spawn cost? MCP context size? Answer with measured unleashd numbers
plus repo-wide audit findings.

- [01 — burn drivers](01_burn_drivers.md): ranked drivers with code pointers.
- [02 — unleashd Fable/Astra numbers](02_unleashd_fable_astra.md): measured
  Sep 14–17 usage, method, top sessions (conversation-file pointers).
- [03 — audit-tool proposal](03_audit_tool_proposal.md): hooks A–E to make
  this self-serve next time.
- [04 — insights and fixes](04_insights_and_fixes.md): the 40M-turn smoking
  gun, fan-out clusters, fixes ranked by leverage.
- [05 — prefill math](05_prefill_math.md): cost split, memory-bust verdict,
  live-thread warning.
- [06 — compaction, caching, UI](06_compaction_caching_ui.md): auto-compact
  findings, cache-friendly mechanics, bust vectors, build order.
- [07 — SoL-Pi](07_sol_pi.md): the four NVlabs mechanisms, why savings are
  structural, extract-don't-integrate port plan.

Method scripts: `/tmp/unleashd_usage.py` (kept outside the repo so it stays
re-runnable without cluttering the tree).

Staleness note: 02 is a Sep-17 snapshot; Sep-17 Fable has since grown
(96 → 158 msgs — see the live-thread warning in 05). Re-run the script
before quoting totals.

Caveats: worker agents returned no `evidence[]` bundle, so some mechanism
claims rest on cited pointers + targeted re-inspection, noted inline. The
30d $5,876 probe is a prior-worker output, not re-run here. Codex per-file
usage = last cumulative `token_count` (same rule as `GET /api/usage`);
`cached_input_tokens` is a subset of `input_tokens`, not additive.
