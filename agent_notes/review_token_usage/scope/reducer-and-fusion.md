# Scope: reduce_log MCP tool + fusion-prize measurement (plan only)

SoL-Pi Evidence-Preserving Reducer pattern
(`/tmp/sol-pi/src/sol-pi/extensions/evidence-preserving-reducer/`:
`receipt.ts`, `provider.ts`, `archive.ts`): cheap reader → receipt of
exact byte-for-byte quotes, sha-pinned, deterministically verified before
the frontier model sees it. Verdict from discussion: transparent
interception inside CLI sessions needs a fork; the pattern still ports
wherever long text crosses OUR layer.

## Plan steps

1. `reduce_log` MCP tool: model hands it a log (or handle); implementation
   shells a cheap CLI (haiku/spark) with strict receipt instructions, then
   verifies quotes against archived text in our code; fail-open returns
   full text on invalid receipt. Plugs into `buddyMcpServers` selection
   (`server/src/conversations/runtime.ts:1065`).
2. Trigger tuning: description-search for handle→recall uptake, same as
   SoL-Pi's prompt search (their trigger went 28%→100%).
3. Handoff summarization with quotes (same trust shape, our code only).
4. Fusion-prize measurement FIRST: scan transcripts for adjacent
   edit→command pairs (their oracle: 12.3% of cross-turn transitions).
   If our rate is similar, spec a fused edit-and-run MCP tool; if low,
   drop fusion. Do not build fusion without the number.

## Risks

- Models prefer native Edit/Bash; MCP-tool uptake needs tuning, may stay low.
- Extra cheap-model calls add latency; bound log size and timeout.
- Quote verification must be byte-exact; normalize line endings once.

Estimate: S for the transcript scan; M for reduce_log; fusion TBD by scan.
