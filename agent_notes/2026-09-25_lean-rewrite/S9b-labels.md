# S9b — Codex rate-limit labels (commit f7cb17d, branch fix/usage-limit-labels, worktree lane-labels)
- `server/src/http/usage-routes.ts`: new pure `rateWindowLabel(minutes)` (10080→7d, 300→5h, 90→90m); Codex primary/secondary loop pushes every window that exists, labelled `<duration> limit` (no more "168h"/slot-named "Weekly").
- `client/src/components/UsagePanel.tsx`: gauges extracted into exported `RateLimitGroup` (same markup/CSS, zero CSS added); renders whatever windows arrive.
- Tests: `server/test/rate-window-label.test.ts` (5h/7d/1d/36h/90m), `client/test/usage-rate-limits.test.tsx` (weekly-only payload → one 7d gauge).
- Parity golden `server/test/usage-context-async-parity.test.ts:401` updated 'Weekly limit' → '7d limit' (intended change).
- Checks on clean committed tree: typecheck, test:server (255/255), test:client, invariants, vite build all green.
- Claude windows still use their own hardcoded labels ('5h window'/'Weekly'); not in scope.
