# Scope: compaction economics + explicit --autocompact (plan only)

Findings to build on: `claude --help` exposes
`--autocompact <auto|tokens>` (100k–1M) and we never pass it
(`vendor/agent-cli-tool/src/harnesses/claude.ts:67-72` carries only
session/model/MCP flags); `codex exec --help` shows no compact flag,
matching 0 compactions in 292 steps. SoL-Pi `economics.ts`
(`/tmp/sol-pi/src/sol-pi/extensions/online-context-compact/`) gates
compaction on breakeven: compact only when expected remaining-turns ×
context exceeds rewrite cost (16k window reserve).

## Plan steps

1. Confirm Claude's `--autocompact` default behavior (help text only gives
   the range) with a scratch-session probe; record whether `auto` fires
   and at what size.
2. Pass `--autocompact` explicitly per conversation: default threshold for
   normal threads, higher/opt-out for long-context mode.
3. Port the breakeven formula into Hook D / auto-compact trigger:
   remaining-turns estimate × context vs rewrite cost, instead of a
   hand-picked threshold.
4. Codex path: no CLI knob found — auto-compact there means our own
   summarize-and-restart via the `run-executor.ts:441,511` handoff path
   (summarize, don't tail-slice).

## Risks

- CLI flag semantics may differ across versions; pin and probe per upgrade.
- Explicit thresholds interact with fork (fresh session = fresh budget).
- Wrong threshold either churns (rewrite storms) or never fires; the
  economics formula exists precisely to avoid hand-tuning.

Estimate: S (flag pass-through + probe); M for the economics port.
