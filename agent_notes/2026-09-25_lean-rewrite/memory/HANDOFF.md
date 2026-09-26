# Buddy memory unification: handoff (2026-09-26)

Landed on `lean/integration` as merge `f41a54f` (tree identical to the gated `bb33726`).
Plan, evidence and per-task reports: `~/git/unleashd-lean-scope/memory/`
(EVIDENCE.md, INVENTORY.md, DESIGN.md, PROJECT.md, M1–M5 reports).

## The model now (owner decision)
A Buddy has ONE soul, ONE working memory and ONE long-term memory. Every turn kind — owner chat,
channel post, worker, schedule, message — reads the same three docs in its briefing, and the owner's
Memory tab edits the same rows. Working vs long-term differ only in their prompt text and caps
(2,000 / 4,000 chars). Only shared docs keep a scope (`buddy` | `workspace`). Notes are
`agent_notes/*.md` files the Buddy writes with its own tools; there is no note store.

After every completed Buddy turn, the reviewer (codex → cursor → claude → muse ladder, next rung
only on out_of_tokens or timeout, 300 s per rung) reads the turn including tool calls, runs in the
workspace root with read-only file tools, and updates working/long-term only when relevant:
in-flight → working, resolved → removed from working, lasting preference/lesson → long-term,
otherwise NONE.

## Why (measured on the live v33 DB, 2,055 reviewer receipts)
- Memory was scoped per chat/task/workspace: 519 copies (Product Development Lead 113), new chats
  opened on "(No working memory yet.)", and the owner's Memory tab edited a different row than the
  agents used.
- 35% of reviews failed: 411 out of credits, 139 "Knowledge is unavailable in this audience" (a
  scope bug), 90 billing, 41 timeouts (one 120 s budget for the whole ladder), 12 guard kills
  after the reviewer tried to read files to verify prose-only claims.
- 1,082 notes were written and never injected into any prompt.
- Nothing caught it: the ladder test and the curation benchmark reviewed scope-less turns, a shape
  production never sends; the benchmark's live harness had been deleted in T11.

## What changed (commits on lean/integration)
| Task | What | Key commits |
|---|---|---|
| notes | note doc kind deleted; importer skips notes; `buddies-import export-notes` writes them to `agent_notes/buddy-notes/<buddy>/<date>.md` | 9519dfc |
| M1 | DocScope Thread/Task, docScopeFor, grant.scope, knowledgeScope deleted; memory kinds refused outside buddy scope; session audience key is a pure function of the turn origin with byte-identical strings | d3a5058, aa4a7fe, 11ceb54 (merge) |
| M2 | importer folds every per-audience working/long_term copy: newest wins, the rest go to `agent_notes/buddy-notes/<buddy>/memory-archive.md`; the soul is always the v33 head, scoped soul copies archived | 2de05c7, a438039, ea7dce7 |
| M3 | reviewer: tool calls in its transcript, workspace cwd, read-only tools per harness, 300 s per rung, tightened prompt; Cursor cleanup no longer deletes a whole shared project dir | 7806092 |
| M4 | live benchmark ported onto `createMemoryReviewer`; cases A–J + relevance cases K–O | beb8c66 |

Verified on a fresh VACUUM copy of the live DB with the final importer: import ok, `verify`
ok=true, 156 memory docs (52 Buddies × soul/working/long_term, all buddy scope), 292 revisions,
524 copies archived across 30 Buddies, soul files 45 match / 4 match-no-header / 3 empty. Winner
check: Wave_sim CEO working = its 2026-09-25T16:33 thread copy (newest).

Gate at bb33726: Rust core 26+1, importer 5, server 203, client 186, dev-supervisor 14, tools/api 5,
agent-cli 275, client invariants 8/8, clean tree.

## Tests added and what each guards
| Test | Guards against |
|---|---|
| buddies-v2 "memory the reviewer saves after one chat is in the next chat's briefing" | the per-chat memory bug itself (real owner-chat context, real reviewer, chat B's briefing) |
| conversation-runtime "session audience key …" | a key-format change silently resetting every saved provider session (fails if the strings change or owner/non-owner keys merge) |
| buddies-v2 "a reviewer rung that outlives its timeout climbs to the next rung" | one slow model failing the whole review |
| buddies-v2 ladder test (extended) | dropping tool calls from the reviewer transcript again |
| cursor-ephemeral (2 tests) | deleting the owner's Cursor history for a repo when the reviewer runs there |
| crate core.rs `memory_kinds_are_refused_outside_buddy_scope` | a second memory copy being stored under another scope |
| importer `memory_folds_to_the_newest_copy_and_archives_the_rest` | losing or mis-picking memory at the swap (one-time; delete with the importer) |
| agent-cli run.test.ts (on the submodule branch, not landed) | waiting ~4.5 s for an out-of-credits CLI to exit |

Deterministic tests cover plumbing: who reads/writes, triggers, transcript contents, timeouts,
sessions, migration. The model's judgment ("update only when relevant") can only be measured by the
live benchmark (M4), which costs credits and is skipped by default.

## Open (owner gates)
1. **M5 not landed.** `vendor/agent-cli-tool` branch `fix/stop-on-out-of-tokens` @ 076f3fe (stop the
   CLI as soon as it reports no credits; 276 submodule tests). Worktree
   `.claude/worktrees/lane-memory-credits`. Needs: push inside the submodule, then bump the outer
   pointer on lean/integration (docs/git-submodule-dance.md).
2. **Run the benchmark.** From a lean/integration worktree:
   `UNLEASHD_LIVE_MEMORY_CURATION=1 UNLEASHD_MEMORY_CURATION_REPEATS=2 UNLEASHD_MEMORY_CURATION_RESULTS=/tmp/memory-curation-<id> pnpm exec tsx --test server/test/buddy-memory-curation.test.ts`
   — 15 cases × 2 = 30 model calls (up to 120 with full fallback). Pilot one case first with
   `UNLEASHD_MEMORY_CURATION_CASE=K-inflight-to-working UNLEASHD_MEMORY_CURATION_REPEATS=1`.
   Group results by the model on each receipt. The prompt has not been re-benchmarked since M3.
3. **The swap (T15)** runs `export-notes --write` after import (crate README "Deploy"); it writes
   ~185 files into 6 repos' `agent_notes/buddy-notes/`.
4. **Possible follow-up, only if the benchmark shows it matters:** live turns inline a ~100-char
   `🔧` tool summary into message text and never set `Message.toolCall`, so the reviewer gets full
   tool inputs only for ingested transcripts.
5. **Leftover data copies** the hook would not let agents delete:
   `~/git/unleashd-lean-scope/memory/tmp-import`, `…/tmp-import2` (live-DB copies, safe to delete).

## Gotchas hit this session
- Any `rm -rf` is refused by a hook, and a `$VAR` target by a built-in check: use literal paths.
- `git worktree remove` needs `--force` when a submodule is initialised; `git branch -d` checks
  against the current checkout, not lean/integration — confirm with
  `git merge-base --is-ancestor <b> lean/integration`, then `-D`.
- The session-audience key is a separate concept from memory; never derive it from memory again.
- A Claude session's scratchpad filled the disk to 100% (26 GB of data copies) on 2026-09-26:
  delete data copies in the same task that makes them.
