# 06 — Compaction, caching mechanics, and UI proposals (2026-09-18)

## Auto-compact: neither CLI does it under our invocation

- Our argv carries zero compaction flags. Claude:
  `--session-id` / `--resume` / `--resume --fork-session` only
  (`vendor/agent-cli-tool/src/harnesses/claude.ts:67-72`). Codex:
  `exec resume <id}`, fork via rollout-file copy
  (`vendor/agent-cli-tool/src/harnesses/codex.ts:71-78`). A repo-wide grep
  for "compact" hits only buddy-memory compaction — a different thing.
- Observed: 292-step Codex turn, 0 compaction events, grew to 39.9M
  cumulative input. Key subtlety: that 40M is CUMULATIVE re-read across
  steps (avg ~137k/step, inside the ~258k window), not one 40M context.
  Native overflow-triggered auto-compact can never fire on gradual growth —
  no single step looks full while the meter runs.
- Memory-reviewer precedent that slimming works: Codex launched with
  `project_doc_max_bytes=0`, web-search off, read-only sandbox
  (`server/src/buddies/memory-review-runner.ts:47`).

## Why our layer is cache-friendly (verified, not assumed)

- CLI session holds the transcript; each turn sends only the latest string,
  which appends. Prior prefix bytes untouched → cache holds (measured
  96–98% hit on both providers).
- Briefing/memory prepends to the FIRST message only
  (`server/src/conversations/runtime.ts:609`); refresh turns add it to that
  turn's new message (a legitimate write, not history rewrite).
- Per-turn appends (claim/policy lines, `run-executor.ts:459-469`) land at
  the END — prefix-safe.
- MCP config is deterministic per invocation; stable while the audience is
  stable (audiences look fixed at creation — worth asserting in code).
- Measured confirmation: 387/401 Claude msgs are steady-state (~8k avg
  writes under ~173k avg reads).

## Bust vectors, ranked (residual risk only)

1. Idle gaps > cache TTL (~5 min Claude): server-side cache expires, next
   turn pays full input + rewrite. Biggest risk for sparse automation.
2. Audience/MCP change mid-session: tool-surface change busts everything
   after it. Rare by construction; assert, don't assume.
3. Fork: new session, one full-context write. Deliberate — price it in.
4. Refresh volume: not a bust, but each refresh writes a large new block;
   storms show as write volume.

## Proposals (accepted direction, not yet built)

- **Per-turn write-spike alert** (extends Hook D): `cache_write > 50% of
  cumulative context` + time-since-last-turn tag → distinguishes TTL expiry
  from genuine busts from compaction boundaries.
- **Context-breakdown UI**: per-conversation `{history, briefing, memory,
  mcp, handoff}` chars + stacked bar, PAIRED with the session's provider
  token delta ("we sent 12k, the provider priced 40M"). Measures our
  injection; the delta teaches the re-read lesson.
- **Compact & continue (manual)**: Claude forks natively (original kept);
  Codex via rollout copy. Original thread never destroyed.
- **Auto-compact toggle**: cumulative-input threshold → summarize-and-restart
  (reuse the `run-executor.ts:441,511` handoff path; summarize, don't
  tail-slice).
- **Long-context mode**: opt-in per conversation WITH a budget cap, replacing
  today's unbounded default. No need to choose between safety and power.
- Build order: breakdown UI (visibility) → compact button (relief) →
  auto-compact + token budget (guardrails).
