# Client and broad verification audit — 2026-09-12

This is one lane of the owner's requested Buddy resource/history audit. It records evidence, not a new product decision or a claim of production deployment. Existing mixed working-tree edits were preserved.

The desktop and mobile Memory pages both use `BuddyMemoryWorkspace`, keyed by Buddy and workspace (`client/src/components/BuddiesDashboard.tsx:774`, `client/src/mobile/buddies/BuddyDetailMobile.tsx:467`). Its selected audience keys the document controller (`client/src/components/buddies/BuddyMemoryWorkspace.tsx:52`). Reads use the abort-aware `usePolledFetch`; writes, notes, and recall carry the selected `knowledgeScope` (`BuddyMemoryWorkspace.tsx:76`). The default Owner memory option is explicitly described as the defaults inherited by new owner conversations. Selecting an owner conversation reads that conversation's scoped head. This is consistent with the repaired server resolver rather than evidence that global defaults should be overwritten after each thread.

The scoped Memory panel suppresses the global soul editor and redundant legacy note/recall scope controls. The two shells render the same document revisions and note content. No new client defect was established in this lane. Static component tests do not exercise browser interaction, rapid selection changes, or a real mobile device; those are coverage limits, not passing claims.

The client consumes the server transcript projection. Passing render/detail-loader tests cannot recover old messages once server polling/hydration has replaced that projection. See the independent [history audit](2026-09-12-audit-history-cause.md) and its rotate/poll/reload reproduction.

Verification rerun against the current working tree:

| Check | Result |
|---|---|
| All `server/test/*.test.ts`, using `pnpm exec tsx --test` | 308 total: 305 pass, 3 opt-in live-provider skips, 0 fail |
| All client `.test.ts` and `.test.tsx`, using `tsx --tsconfig client/tsconfig.app.json --test` | 76 pass, 0 fail |
| Client `pnpm -C client exec tsc -b` | Pass |
| Shared `pnpm -C shared exec tsc -b` | Pass |
| Server `pnpm -C server exec tsc -b` | Pass |
| `bash tools/check-client-invariants.sh` | All six gates pass |

A focused 16-test client run also passed before the full run; it is included in the 76, not an additional independent total. Other agents' overlapping focused runs must not be added to the full server count. Package verification is recorded separately in the privacy/memory lane.

Raw logs, exact expanded commands, original source hashes, and the audit's final source comparison are preserved under `product/buddies/audit-2026-09-12/`. Tests use the repository's fixture setup. This audit did not enable live-provider tests, launch a persistent team, publish, push, restart the application, or modify product source.

The canonical planning doc still advertises an older `send` shape; the separate contract review owns that finding. The current native tools and shared `delivery` schema are the current behavior.
