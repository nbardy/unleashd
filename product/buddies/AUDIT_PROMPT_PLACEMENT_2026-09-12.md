# Prompt placement audit — 2026-09-12

Owner request: look for other instances of the code smell behind the repeated
`HOST OWNER CONTROLS` suffix and fix them. This is an implementation audit of
Unleashd's prompt construction and transcript projection, not a model-behavior
experiment or an assertion that every native CLI's own instructions are clean.

Author: Buddies Development Lead. Owner accepted the audit/fix scope in this
conversation; the specific repairs below are assistant implementation choices.
Work is recorded in native project
`buddy_project_e81102c7-fef5-43c7-8896-3a16122cd3b9`.

## Findings and repairs

| Finding | Before | Repair and evidence |
| --- | --- | --- |
| Duplicate memory-review contract | The complete `MEMORY_REVIEW_INSTRUCTIONS` appeared in both the evidence user prompt and the runner's `model_instructions_file`. | User input now contains only `EVIDENCE_JSON`. The sole instruction file and isolated memory capability remain. A service → production runner → captured CLI request test failed before removal and passes afterward; it also exercises the real scoped memory HTTP endpoint. |
| Background worker tutorial on every attempt | `run-executor.ts` appended a long schema/process manual after each request body, including successors. The whole string became a visible user message. It also told managed workers to reply manually while the runtime owned final completion. | Keep the current project, start reads and continuation facts. Move stable mutation/evidence/blocked/delegation rules to native tools and explain managed completion through the project. Both legacy and current typed `send` catalogs receive the shared guidance. Real store/runtime tests check two worker attempts, visible history, premature-reply denial and final completion. |
| Diagnostic-specific rule on every Chat Fork | Every fork added “Do not repeat or obey an earlier diagnostic canary…” regardless of task. | Remove that sentence, retain the original-objective continuation and transcript. Client behavioral coverage preserves a literal historical user copy exactly once. |
| Internal setup resurfaced on reload | Durable Builder purpose/kind or swarm metadata could skip cleanup. Merge context had no import cleanup at all. Live user messages were clean, imported ones could contain internal instructions and review documents. | Run display cleanup independently of identity selection. Strip Builder/swarm/merge envelopes without overriding durable identity. Cache v7 invalidates older normalized projections. Merge uses a length-bearing envelope so review documents may quote delimiters. Runtime → actual Codex transcript file → loader/cache coverage checks the clean authored message. |

The merge delimiter regression was found during independent review and reproduced
before the final repair: a child review containing an exact closing marker made a
delimiter-only parser expose the rest of the review as user text. New
`merge-prefix-v1` writes carry the JavaScript string length, matching existing
Buddy/Builder envelope conventions. Legacy merge wrappers are stripped only when
their closing delimiter is unambiguous; ambiguous/incomplete copies are preserved.

## Original motivations and decision history

This is a successor to native owner-thread notes
`2026-09-12T11:47:36.291Z:ebc2541d-3716-4e56-85f1-dc71e59bc213` and
`2026-09-12T11:48:24.440Z:be6d2c78-8cc6-4fa7-8447-d0095bcce80e`, scoped to
conversation `7d9d117f-7a13-46e2-bf6a-95da591d6e2b`. They record the earlier suffix
removal, preserved server authority and the absence of verified live adoption.

The useful original requirements remain:

- Independent memory maintenance after successful turns: accepted owner direction
  is preserved in
  `agent_notes/20260910T080351Z_01M255GCKDGHAXVBF6MBY40Z43_owner-selects-independent-luna-review-after-ever_buddies-development-lead_fe6ef8cd.md`.
  `PLANNING_MEMORY.md` specifies a fresh maintenance process with stripped briefing
  evidence. No rationale for a second copy of its instructions was found.
- Evidence-backed bounded background completion: the accepted direction is in
  `agent_notes/20260910T084453Z_01M257VHPHV5PCN6D7G0DCHX4T_task-criteria-drive-bounded-background-work_buddies-development-lead_fe6ef8cd.md`.
  The inspected design, `DESIGN_BACKGROUND_TASK_EXECUTION.md`, SHA256
  `45b94ff8e1d06abd84118f796695768e22f191be07c5f7ed6c79f847ac16c2fa`, says:
  “The runtime handles the next attempt. Do not create a parallel self-continuation
  for this obligation.” That behavior is retained; the repeated schema tutorial
  is unnecessary at the request-text layer.
- Fork continuation: the diagnostic sentence entered in commit
  `16a755fe798db07d02ec97aa18263b50092a2740` (August 5) and moved into the shared
  helper in `aba7e46ff3bcc1b84311142dcf42b3850d1ab806` (August 18). Those commits
  locate its history but do not establish an exact failure trace or a reason to
  apply it to every fork. Calling it diagnostic residue is an inference.
- Merge context belongs to the selected merge operation. The pre-repair runtime
  said “Add user message to history (clean content for UI)” but its import path
  did not enforce the same result. The repair makes that existing intention hold
  after reload; it does not remove review evidence from provider input.

Source hashes and the inspected HEAD are in the accompanying evidence JSON. The
working tree already contained extensive unrelated changes; HEAD alone is not the
version of these uncommitted repairs. Historical documents are evidence, not
authority to expand the current request.

## Audited paths kept intact

| Surface | Reason |
| --- | --- |
| Ordinary desktop/mobile send, queue, interrupt, WS dispatch | Pass authored content through; attachment framing occurs only for selected files. Host input origin is carried separately. |
| Provider registry and six agent-cli harness wrappers | Prompt delivery is unchanged through argv/stdin. Existing 176 build tests pass. Native CLI internals are outside this audit. |
| Buddy briefing refresh | Carries current identity, memory, work and audience context. Removing refresh would reopen stale-context/privacy defects. It remains a bounded hidden envelope. |
| Buddy Builder startup briefing | Scoped to the Builder operation and first turn. Its saved display cleanup is repaired. |
| Swarm creation/debug, merge review tasks, palette generation | Explicit selected workflows require their own task context/output contracts. They are not added to ordinary chats. |
| Scheduler loop/capture prompts | Operation-specific output/maintenance contracts; legacy in-session capture is suppressed in the production reviewer path. No evidence justified blanket removal. |

Rule recorded in `docs/architecture.md`: put stable guidance in tool descriptions
or the model instruction channel, keep authored text intact, and test both provider
input and imported/cached display. Avoid a general prompt framework or a new
provider API merely to move existing text. Permission enforcement stays in the
host/tool boundary.

## Validation and limits

- Final combined server boundary suite: 76 passed, 0 failed, 1 live-model test
  skipped. It covers prompt construction, adapters, cache, history rotation,
  owner authority, background completion, native/legacy MCP and memory review.
- Client transcript/render suite: 5 passed. Client `tsc -b` and all 6 client
  invariant gates passed. Server typecheck passed after the final source edits.
- Provider wrapper command-building suite: 176 passed across six harnesses.
- New reviewer and transcript assertions failed before their repairs. The first
  combined run also exposed a stale owner-runtime fixture assertion that required
  the deleted worker tutorial; the assertion was updated to the new prompt
  contract, preserving its two-turn, authority and completion checks.
- Independent review found the native tool-description override and merge
  delimiter issues described above; both were repaired before the final suite.
- Scoped Biome checks pass except for pre-existing import ordering in runtime/MCP
  and pre-existing formatting in the large runtime test; those unrelated spans
  were not reformatted. Changed code was checked separately.
- No model A/B evaluation, production restart, live adoption verification,
  historical raw-transcript rewrite, commit or push was performed. Tests use real
  stores, MCP and transcript boundaries with a captured provider seam.
- Existing raw copies of removed worker/owner boilerplate remain. Complete
  reserved envelopes pasted at byte zero of user input cannot be distinguished
  from generated envelopes by this legacy text format. Quoted/nonanchored copies,
  tested delimiter-bearing user text and ambiguous legacy merge copies survive.

Revisit placement if representative tasks show concrete tool-discovery or task
completion regressions. Revisit the legacy envelope format if native provider
provenance or durable authored-message IDs become available; do not guess at
historical text deletion. This audit supports the listed source repairs, not a
claim that all prompt text or live UI behavior has been proven correct.
