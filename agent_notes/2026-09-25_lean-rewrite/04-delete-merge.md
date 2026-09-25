# 04 — Delete the merge feature

The merge feature has been removed from unleashd. Nothing was left behind for compatibility: no shims, no leftover optional fields, no fallbacks.

- **Current branch: `chore/delete-merge-v2`, commit `8c9fcfa`.** It is based on `lean/integration` (`ab47223`, which is `cbb8820` plus `ab47223`). It has not been merged into `lean/integration` and has not been pushed.
- **Worktree:** `/Users/nicholasbardy/git/unleashd/.claude/worktrees/agent-ac4d4c612f3d67829`
- **Net change** (`git diff --stat lean/integration 8c9fcfa`): 32 files changed, +77 / −1505 lines.
- **Superseded:** `chore/delete-merge-2026-09-25` (`7369e92`, on base `a7a223b`) conflicts with `cbb8820`. Do not use it.

### How v2 was produced
v2 is a cherry-pick of `7369e92` onto `lean/integration`. Five files conflicted. Every conflict was resolved by keeping the integration branch's new behaviour and dropping only the merge code.
- **`client/src/atoms/actions.ts`:** kept `setConversationDone` and dropped `createMergeConversations`.
- **`client/src/components/Sidebar.tsx`:** kept the nullable `onDone` and the Done button that is disabled while disconnected (tooltip "Reconnecting to the server"). Dropped the `mergeMode`/`mergeSelected`/`mergeDisabled` props and the `!mergeMode` wrapper around the button.
- **`server/src/conversations/runtime.ts`:** kept the new `OwnedBuddyChatRun`/`BuddyChatAdmission` types and dropped `MergeParentMeta`/`MergeChildMeta`. The integration branch had already deleted `BuddyChatCapacityUnavailableError`, and it stays deleted.
- **`server/src/lifecycle/session-loader.ts`:** kept the new `title: source.title ?? null` and dropped the merge metadata.
- **`server/src/server.ts`:** dropped the `registerMergeRoutes` block, which on the integration branch also passed `done: false`.
- **New merge mentions on the integration branch:** two comments referred to merge and were updated:
  - the `sendAdmittedMessage` comment in `runtime.ts`, which listed "merge send blocked";
  - a `stripMergePrefix` comment in `jsonl.ts`.

### Verification of v2 (run on the committed tree `8c9fcfa`; `git status --porcelain` was empty)
| Check | Result |
|---|---|
| `pnpm typecheck` (includes client `tsc -b`) | pass (exit 0) |
| `pnpm test:server` (submodule initialized and built) | 492 tests: 486 pass, 0 fail, 6 skipped |
| `pnpm test:client` | 172 tests: 172 pass |
| `bash tools/check-client-invariants.sh` | all 6 gates pass |
| `biome check` on the changed files | no new diagnostics. The ones reported were already there on lines this change did not touch: `noVoidTypeReturn` in `actions.ts`, `useSemanticElements` in `Chat.tsx`, `useExhaustiveDependencies` in `ConversationView.tsx`, and `organizeImports` in `server.ts` (the `owner-channel-reads` import on the integration branch). |
| `git grep` at HEAD for the merge symbols in `server/src`, `shared/src`, `client/src` and both test dirs | no hits |

Problems caused by the worktree environment, not by this change:
- The first typecheck failed with `@nbardy/buddies has no exported member 'knowledgeAudienceContinuity'`. The installed copy of the vendored tarball was out of date (the trap described in AGENTS.md). Moving the `.pnpm/@nbardy+buddies@…` directory aside and running `pnpm install --frozen-lockfile --offline` fixed it.
- The submodule had to be checked out at the pointer `lean/integration` records (`2674d8c`) and then built.

The sections below describe the change itself and apply to both versions. The verification table at the end is for v1 (`7369e92`).

The merge UI could no longer be reached before this change. Only `MergeModal` ever set `mergeModeAtom`, and it only ever set it to `false`. The button that turned merge mode on was removed in `f0eb945`.

## Files deleted
- `server/src/merge/routes.ts` (`POST /api/conversations/merge`)
- `client/src/atoms/mergeAtoms.ts`
- `client/src/components/MergeModal.tsx`, `MergeModal.css`
- `client/src/components/MergeProgressStrip.tsx`, `MergeProgressStrip.css`

## Files changed
- **`shared/src/index.ts`**
  - Removed from the schema: `mergeParentMeta`, `mergeChildMeta`, `MergeChildStatusSchema`, `MergeChildStatusMessageSchema`, and the `merge_child_status` entry in `ServerMessageSchema`.
  - Removed helpers: `MERGE_REVIEW_PROMPT`, `buildMergeReviewPrompt`, `mergeReviewDocPath`.
  - Rewrote the `FORK_CAPABLE_PROVIDERS` comment so it describes a single kind of fork.
- **`server/src/conversations/runtime.ts`**
  - Removed the `MergeParentMeta` and `MergeChildMeta` types, fields and options.
  - Removed `spawnMergeReviewFork`.
  - Removed the scan on `turn.complete` that broadcast `merge_child_status`.
  - Removed the prefix added on the first send. It blocked the send while children were still running and read each review doc from disk synchronously with `readFileSync`.
  - Removed the `fs` import, which nothing else used.
- **`server/src/server.ts`:** removed the `registerMergeRoutes` wiring and the imports only merge used.
- **`server/src/adapters/jsonl.ts` and `disk-adapter.ts`:** removed `stripMergePrefix` and the `MERGE_PREFIX*` regexes.
- **`server/src/lifecycle/session-loader.ts`:** no longer passes the merge metadata through when hydrating conversations.
- **`server/src/http/conversation-routes.ts`:** the context-breakdown handoff section no longer includes the merge metadata.
- **Client**
  - `Sidebar.tsx`: removed merge mode, the selection checkmark and the filter that hid merge children.
  - `ShellDesktop.tsx`: removed the `mergeMode` switch between `MergeModal` and the normal view.
  - `Chat.tsx`: removed the merge send gate and the `MergeProgressStrip`.
  - `mobile/conversations/ConversationView.tsx`: removed `MobileMergeProgressStrip`.
  - `atoms/actions.ts`: removed `createMergeConversations`, the `merge_child_status` handler and the atomFamily cleanup for merge atoms.
  - `Gallery.tsx` and `atoms/buddy-sidebar.ts`: removed the filters for merge children.
  - CSS: removed the merge rules from `App.css` and `Sidebar.css`, and fixed a comment in `mobile-ui.css`.
  - Updated the fork comments in `ResumeThreadWidget.tsx`, `ShellMobile.tsx` and `utils/conversation-transcript.ts`.
- **Tests**
  - Deleted the test for the merge-prefix round trip in `conversation-runtime.test.ts`.
  - Deleted the test for cleanup of old merge wrappers in `codex-buddy-transcript.test.ts`.
  - Removed the merge fields from the fixtures in `context-breakdown.test.ts`, `conversation-serialization.test.ts` and `client/test/mobile-queue.test.ts`. The context-breakdown test that used merge metadata now covers only the branch and resume lineage.
- **`docs/architecture.md`**
  - Replaced the table headed "Two things are called fork" with a section that describes only Chat Fork.
  - Removed merge from the rules on envelope display. A note says old merge transcripts now display as plain text.
  - Historical planning, audit and benchmark docs were left as they were, because they are records of past work.

## Soft-fork decision: kept
Soft fork is the Chat "Fork" button. It is not part of merge.
- Chat "Fork" (`atoms/fork-actions.ts`) creates a new conversation. It records `resumedFromConversationId` as lineage and puts the old transcript in the draft.
- `ResumeThreadWidget` shows that lineage as a badge.
- In `Conversation.sendMessage`, the first send is upgraded to a native session fork. This happens only when the source and target use the same provider and that provider is in `FORK_CAPABLE_PROVIDERS`. The upgrade passes `forkSourceSessionId` into `spawnForMessage`.

All of these are used by Chat Fork, so they stay:
- `FORK_CAPABLE_PROVIDERS` and `providerSupportsFork`
- the `forkSourceSessionId` parameter of `spawnForMessage`
- `rejectFork`
- `resumedFromConversationId`
- `ResumeThreadWidget`

Only the merge-specific pieces were deleted:
- `spawnMergeReviewFork`
- the merge route's own check on fork-capable providers
- the use of `providerSupportsFork` to disable merge selection in the sidebar

## Wire compatibility
- **Old backend with the new client**
  - `ConversationSchema` is a plain `z.object`, so the new client strips `mergeParentMeta` and `mergeChildMeta` from conversations the old backend sends.
  - A `merge_child_status` message from an old backend no longer matches the union, so `safeParseServerMessage` rejects it. `useWebSocket.ts` then logs it with `console.error` and drops it. It is not sent to the error journal, because the client error reporter only listens for `window` `error` events.
  - An old backend only sends that message while a merge is running, and nothing in the UI can start one.
- **New backend with an old client:** the new backend never sends the merge fields or the message. In the old client's schema both fields were `.nullish()`, so their absence parses fine.
- **Old transcripts on disk**
  - A first message wrapped in `<!-- unleashd:merge-prefix(-v1) -->` now appears as ordinary user text, including the injected reviews. Nothing parses the envelope any more, so nothing can crash on it.
  - Sessions already stored in the cache may still show the stripped version until the cache is rebuilt. `CACHE_VERSION` was not bumped, because either result is harmless.
  - Old merge child conversations now appear as ordinary conversations, since the filters that hid them are gone.

## Verification of the superseded v1 (`7369e92`, all run on the committed tree; `git status --porcelain` was empty)
| Check | Result |
|---|---|
| `pnpm typecheck` (shared build, server, client `tsc -b`, agent-cli) | pass (exit 0) |
| `pnpm --filter @unleashd/client exec tsc -b` | pass |
| `pnpm test:server` | 434 tests: 428 pass, 0 fail, 6 skipped |
| `pnpm test:client` | 123 tests: 123 pass |
| `bash tools/check-client-invariants.sh` | all 6 gates pass |
| `biome check` on the changed files | no new diagnostics. The remaining ones were already there on lines this change did not touch: `noVoidTypeReturn` on the `handleMessage` switch in `actions.ts`, `useSemanticElements` in `Chat.tsx`, `useExhaustiveDependencies` in `ConversationView.tsx`, and `organizeImports` in `ShellMobile.tsx` and `ConversationView.tsx`. |
| `git grep` at HEAD for the merge symbols in `server/src`, `shared/src`, `client/src` and both test dirs | no hits |

The first run of `pnpm test:server` had 58 failures, all `Cannot find module …/@nbardy/agent-cli/dist/index.js`. They were caused by the worktree, not by this change: the `vendor/agent-cli-tool` submodule had not been initialized or built there. Running `git submodule update --init` and `pnpm --dir vendor/agent-cli-tool build` fixed them. Neither step changes any tracked file or the submodule pointer.
