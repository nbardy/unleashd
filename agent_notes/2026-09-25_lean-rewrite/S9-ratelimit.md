# S9: Codex rate limits skip windowless buckets (2026-09-26)

Branch `fix/codex-ratelimit-buckets` (worktree `lane-ratelimit`), commit `1079114`. Not pushed or merged.

- **Choice:** keep the latest payload that has a window, not one payload per bucket. The panel draws only `primary` and `secondary` gauges, and `premium` never carries either. So a per-bucket list would change the `codexRateLimits?: string` contract and the route, and would add nothing to draw. With this choice the route and panel stay unchanged, and the switched route (`fa6f1ee` `codexLimits`) works as is.
- **Where:** the fix is in the parser (`parsers/codex.rs` `has_window`), not the query. Buckets interleave within one session: session `01a08991` has `codex` ×445, `codex_bengalfox` ×8 and then `premium` ×1. A query-only filter would still lose that session's windowed payload. The reason comment carries `Pattern: parse-dont-validate`. Doc comments in `model.rs`, `mod.rs` and `index.d.ts` are updated.
- **Test:** `tests/aggregates.rs::codex_rate_limits_skip_a_newer_bucket_without_windows` covers an older session (`codex` with a window, then `premium` null) and a newer session with only `premium`. On the old code it fails with `(Some("premium"), None)`; it passes with the fix.
- **Real data** (scratch store, codex root, 2,495 files in 4.1 s): `usage()` now returns `limit_id` `codex`, primary 65% of 10,080 min, resetting 2026-09-26T01:50Z, which is still in the future. The old code returned the `premium` payload with no windows, so the panel showed nothing.
- **Checks** on the committed tree: typecheck, test:server, test:client, invariants and crate `pnpm test` (cargo plus node) all pass.
- **Blocked:** the dcg guard refused `rm -rf` of the untracked `.s9-scratch/` (check script and scratch sqlite) in the worktree. Please remove it by hand.
- **Not fixed:** a 10,080-minute primary window shows the label "168h limit", from `window_minutes/60` in the route. Also, the weekly window arrives as `primary` with `secondary` null.
