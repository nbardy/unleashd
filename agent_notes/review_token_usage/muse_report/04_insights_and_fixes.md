# 04 — Key insight + fixes (2026-09-17)

## The insight: single turns grow to 40M tokens with zero compaction

Biggest unleashd session in window:

- `~/.codex/sessions/2026/09/16/rollout-2026-09-16T11-10-36-01a0a831-e0e1-71c1-bf29-f72ab71302b8.jsonl`
- **1 turn, 292 token_count updates, 0 compactions**
- final: input 39,934,455 (of which cached 38,959,616), output 115,594
- cost ≈ 39.9M × $2.50 + 115k × $10 ≈ **~$100 for one turn**
- `originator: codex_exec`, cwd `/Users/nicholasbardy/git/unleashd`

Second finding: **fan-out clusters**. Sep-16 sol sessions all open with the
identical AGENTS.md instruction block, launched minutes apart — 11:10:36 ×2,
11:12:08, 11:12:14, 11:12:19, … — 18 sessions totaling $413. Each grows its
own multi-million-token transcript. Fan-out N multiplies the per-turn
re-read cost by N (driver #5 in 01).

Net: server-side per-turn sends are lean (latest string + ≤40k-char briefing
+ ≤60KB handoff). Micro-optimizing prompts cannot move a bill dominated by
40M-token provider-side re-reads. **Thread lifecycle is the lever.**

## Fixes, ranked by leverage

1. **Token/context budget per run (highest leverage).** Background runs are
   only wall-clock-boxed (`min(3600, policy||600)s`); tokens are unbounded.
   Cap cumulative input per run (e.g. stop/compact at 5–10M) — one 40M turn
   costs as much as the entire Fable bill for two days.
2. **Compact or restart with summary instead of endless growth.** Zero
   compactions in 292 updates. Force compaction past a threshold, or end the
   turn and restart fresh with a written summary (the handoff path in
   `server/src/buddies/run-executor.ts:441,511` already exists — lower the
   60KB cap's effective ceiling by summarizing rather than tail-slicing).
3. **Fan-out discipline.** Dedupe/stagger launches; the 11:10–11:12 cluster
   looks like retries or parallel workers on the same work. Add idempotency
   (reuse a live run instead of spawning a twin) and cap parallel workers
   per task.
4. **Narrower worker context.** Every worker opens with the full AGENTS.md
   block + repo-wide cwd. Scope cwd/instructions to the task; fewer files in
   context = slower re-read growth.
5. **Attribution before/after (03, hooks A–E).** Per-run token accounting so
   the next expensive cluster pages you instead of surfacing in a manual audit.
6. **Later / minor:** briefing cap trims, handoff tail → summary, dispatch
   boilerplate dedup. Each is hundreds of tokens against a 40M problem —
   do after 1–4.
