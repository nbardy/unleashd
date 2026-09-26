# Buddy memory: measured evidence (2026-09-26)

Sources: live v33 `~/.buddies/buddies.sqlite` (read-only) and 2,055 reviewer receipts in
`~/.agent-viewer/memory-reviews/`. The lean branch imports this data unchanged, so every problem
below survives the swap unless the design changes.

## 1. Memory is fragmented into 519 per-audience copies

| scope | kind | docs | buddies | bytes |
|---|---|---|---|---|
| owner_thread | long_term | 217 | 22 | 581,543 |
| owner_thread | working | 178 | 20 | 243,254 |
| project (task) | long_term | 60 | 23 | 49,321 |
| project (task) | working | 27 | 15 | 25,245 |
| workspace | long_term | 19 | 19 | 30,155 |
| workspace | working | 18 | 18 | 23,459 |
| owner_thread | soul | 5 | 5 | 22,132 |

Plus the 52 per-Buddy legacy heads (soul/working/long_term) that the briefing no longer reads for
chat turns. Worst: Product Development Lead 113 copies, Buddies Development Lead 94, Wave_sim CEO 49.

- 106 of 217 thread long-term docs are revision 1: untouched seed copies of the Sep 10 head.
- A new chat opens on `Revision: 0 (No working memory yet.)` — observed by the owner, reproduced by
  the todo test b662dcb. What the reviewer learned in chat A never reaches chat B.

## 2. The reviewer fails 35% of the time

2,055 receipts: 1,311 complete, 679 failed, 43 interrupted, 26 skipped.

| failure | n | cause |
|---|---|---|
| out_of_tokens | 411 | Codex credits (before the ladder existed) |
| "Knowledge is unavailable in this audience" | 139 | a scope bug: the reviewer's audience could not read its own scoped memory |
| API 402 billing | 90 | muse rung |
| timed out (120 s) | 41 | one budget shared across ladder rungs; grok p50 ≈ 93 s incl. queue |
| non-memory tool (read/shell/glob) | 12 | reviewer sees prose only, tries to verify, guard kills the run |
| other | 26 | harness exits, schema errors |

Measured: a gpt-6-luna out-of-credits failure costs ~4.5 s (2 runs), so the ladder is not the timeout.

## 3. What completed reviews wrote

Of 1,311 complete: 251 wrote nothing (19%); working written in 726, long-term in 456,
notes in 752. Notes (1,082 rows) were never injected into any prompt; removed in 9519dfc.

## 4. Why nothing caught it

The reviewer ladder test and the curation benchmark both review a turn with NO knowledgeScope, so
they read and write Buddy-wide memory — a shape production never sends. The benchmark's live
harness was deleted in T11, so the reviewer prompt has had no live evaluation since.
