# T14a: safe deletions (report)

Branch `chore/safe-deletions` in worktree `.claude/worktrees/agent-a3a322fcc2e3ba18a`, off `lean/integration`.
Checkpoint merge of `lean/integration` @ 4e5a01c (after T11) is `2a3c116`. The only conflict was the AGENTS.md
code-tree map. Nothing was pushed or merged into lean/integration.

| # | Commit | Item | Hand-written lines | Result |
|---|---|---|---|---|
| 1 | ffec8cc | Dead exports and functions | −124 / +11 | done (outside owned files) |
| 2 | 09b03e8 | One model catalog | −356 / +119 hand-written, +95 generated | done |
| 3 | — | Legacy UI-state and composite-model migration | 0 | verified safe to delete, **deferred (owned files)** |
| 4 | 297f4ec | Uploads retention GC | +362 (GC 218, test 110, wiring 34) | done |
| 5 | 8d98565 | `send_message`: its last non-test sender | −1,081 | command itself **deferred (T09)** |
| 6 | 0b0ec3c | 03 §7 item 19 client items outside atoms/CSS | −92 | the rest is owned or already gone |

Net for the branch: about −1,650 deleted, +490 added (of which 95 are generated and 110 are test).

## 1. Dead exports (ffec8cc)

I re-ran the dead-export scan (`.work/dead.mjs`, extended to cover client/src and the root config files) on the
current tree and checked each hit against its own file.
- **shared:** 7 unused codex/jsonl type aliases; `ReasoningEffort`, `ConfigErrorCode`, `RuntimeObservation`
  (and its schema), `ConversationLifecycleStatus`; `isGeneralKind`, `isBuddyBuilderKind`, `getBuddyId`,
  `getWorkspaceId`; `ClaudeModel`, `GeminiModel`, `MuseModel` and the three `*EffortLevel` aliases;
  `CODEX_THINKING_DISPLAY_NAMES`; `EFFORT_DISPLAY_NAMES`.
- **Test-only:** `transitionConversationConfig` and `validateConversationConfig` were used only by tests. The test was
  a real guard (an invalid effort must reject the whole transition), so I kept it and pointed it at the production
  path: apply the patch, then resolve.
- **server:** the `DEFAULT_TURN_IDLE_TIMEOUT_MS` / `TURN_IDLE_TIMEOUT_MS` back-compat aliases.
- **client:** `MobileConversationRouteState`.
- **Kept:** `isAuthEndpoint` and `AUTH_PATH_PREFIX`. The 03 scan called them dead, but `client/vite.config.ts` imports
  them for the dev-server gate, and tsc caught it. `markdownTreeCacheStats` is test-only but backs a real cache-bound
  guard, so it stays.

## 2. One model catalog (09b03e8)

- `gen-catalog.ts` now also emits `PROVIDER_MODEL_CATALOG`: every provider with its default model, dynamic flag, and
  each model's reasoning levels and default effort. It fails if a `defaultModelId` is not among that provider's models.
- `catalogEntryForProvider` in shared throws when a provider is missing, so a stale catalog is a loud startup error.
- Deleted `providers/{claude,codex,cursor,gemini,muse,opencode}.ts` (the six `FALLBACK_*_MODELS` copies) and
  `providers/catalog.ts` (a runtime `catalog.jsonc` search over 5 paths). `providers/index.ts` builds the registry
  from the generated catalog (tag: `Pattern: one-type-source`).
- `catalog-service.ts`: deleted `loadFileCatalogReasoning` (7 paths, including `/Users/nicholasbardy/...`), the
  no-catalog effort fallback, and the dead `refreshProviderCatalog`.
- `defaultReasoningEffortForProvider` now reads the catalog's `defaultEffort`, replacing the hard-coded `'high'` for
  claude and muse. Today's values are unchanged: claude/muse `high`, codex per model.
- AGENTS.md's "Adding a provider" line is updated, since there are no per-provider files now.
- **Still separate:** `EFFORT_LEVELS_BY_PROVIDER` and the Codex registry in shared/index.ts. Both are generated
  arrays, not copies, and they are used by the validators.

## 3. Legacy UI state and codex composite model: deferred

Verification, read-only, on a copy of `~/.agent-viewer`:
- `~/.agent-viewer/ui-state.json` does not exist. It was retired 2026-09-24T07:56Z: 597 conversations marked done and
  707 keys unresolved (listed in `ui-state.retirement-report.json`).
- 8,018 config records hold 0 composite `<model>-<effort>` codex ids. That covers both `config.model.modelId` and
  `lastResolvedConfig.modelId`.
- 0 composite ids appear across 6.8 GB of `~/.codex/sessions`. As a positive control, the same search found 28k base
  ids.

**So nothing un-migrated remains, but the deletion needs owned files:**
- `server/src/conversations/legacy-ui-state.ts` and its call in server.ts (**T09**).
- The composite decoder is consumed by `conversations/legacy-config-migration.ts` (**T09**) and
  `adapters/disk-adapter.ts:297` (**T13/T23**).

Follow-up for them: delete `legacy-ui-state.ts`, the `retireLegacyUiState` call in server.ts, and the retirement test
in `server/test/conversation-done.test.ts`. Then delete `fromCodexModelId`/`toCodexModelId`,
`shared/src/legacy/codex-composite-model.ts`, and the composite branch in `disk-adapter.recoverModelAndEffort` and
`legacy-config-migration`, plus the `codex-spark-model.test.ts` round-trip tests. That is about 260 lines.
`ui-state.retired.json` (620 KB) is user data and I left it on disk.

## 4. Uploads GC (297f4ec)

- **Code:** `server/src/uploads/gc.ts`. `startUploadsGc` runs a pass at startup and once a day in a `worker_thread`.
  It works from both tsx and the compiled `dist`; I ran it from `dist` to confirm.
- **Deletion unit:** a top-level entry under `uploads/`. Uploads are written to `uploads/<conversationId>/…`, and the
  message carries the absolute path.
- **An entry is deleted only when all of these hold:**
  - Its newest file is older than 30 days. This is re-checked right before `rm`.
  - Its name is not a conversation id, active or trashed.
  - It is not `channels/`.
  - Its name never follows `uploads/` in any file under the reference roots. The plain, JSON-escaped (`uploads\/`)
    and URL-encoded (`uploads%2F`) forms all count.
- **Reference roots:** every provider transcript root, the app data dir (its uploads dir is skipped), and the Buddies
  DB dir.
- **Failure rule:** an unreadable root or file aborts the pass with no deletions.
- **Test** (`server/test/uploads-gc.test.ts`): a temp-dir fixture run through the real worker. It covers each
  reference form, a reference straddling the 1 MiB scan-chunk boundary, protected ids, the self-reference skip, and
  the abort-on-unreadable guard.
- **Dry run** on an APFS clone of the live directory: 137 s and 45,895 files scanned. **0 deletable today.** 307 old
  entries are still named by existing transcripts and 47 are recent.
  - The 701 MB is referenced, so the GC only bounds future growth.
  - Reclaiming the existing space needs an **owner decision**, for example "drop uploads older than N days even if an
    old transcript names them".
  - 290 of the 354 entry names (676 MB) are not current conversation ids. They are probably older or rekeyed ids,
    but transcripts still name them.
- **Note for T13b:** the wiring imports the transcript-root constants from `adapters/jsonl.ts`. When jsonl.ts is
  deleted, those constants must move with it, and the GC's roots must stay complete. A missing root means fewer
  protections.

## 5. `send_message`

There are no client or Buddy callers. The client composers use `queue_message`, and T11's Buddy code does not send
it. The remaining users are:
- the WS handler (`transport/conversation-websocket.ts:286`, **T09**);
- the wire schema (`shared/src/index.ts` `SendMessageMessageSchema`, **T09**);
- `server/test/buddy-conversation-contract.test.ts:327` and `buddy-coordination.test.ts`;
- `test/api.test.js:578`, which uses it only as a malformed-message probe and works without the command;
- four manual live-agent scripts (`test/ws-{message,multiturn,duplicate-convo,streaming-providers}-test.js`), which
  should switch to `queue_message`;
- the unserved `public/index.html` page, which I deleted (−1,081) along with `public/parser.js`.

Deferred to **T09**: drop the schema, the handler case and the two server-test rows, and port the four scripts.

## 6. Client items (03 §7 item 19) outside atoms/ and CSS

- **Deleted:** the dev-only `/sigil-gallery.html` and `src/dev/sigil-gallery.ts` (−92). `/robot` was already gone (T05).
- **zustand `settingsStore` (report only, per the brief):** it is used only by `ColorPalettePicker` (palettes),
  `ConfigDropdown` (reads `settings`) and `App.tsx` `initSettings`. Removing it depends on O2 (presets).
- **Owned or already assigned:**

| Item | Where | Owner |
|---|---|---|
| `sidebarViewMode` | atoms/ui.ts | T09/T19 |
| legacy pending-creation migration | atoms/pending-creations.ts | T19 |
| config re-derivation | atoms/config-actions.ts | T19 |
| `[WS] init` console.log | atoms/actions.ts | T09/T19 |
| swarm regroup ×6 | — | T10 |
| mobile panel copies | — | T20 |
| dead CSS | — | T21a |
| `emptyRecallResult` (dead) | components/buddies/memory.ts | T11 |

## Also deferred

| What | Where | Owner | Why |
|---|---|---|---|
| Dead wire types `*Message`/`*Event` (~30 aliases), `parseClientMessage`/`parseServerMessage` (test-only), `isClientMessage`/`isServerMessage`, `SubAgentStatusSource`, test-only `DEFAULT_CODEX_MODEL_ID` | shared/src/index.ts wire section | T09 | wire schemas |
| `extractSubAgentsFromEntries`, `parseJsonlFile`, `extractMessagesFromEntries`, `recoverOpenCodexTurns`, `formatToolResult` | server/src/adapters/* | T13 | deleted with jsonl.ts |
| `ConfigProvenanceSchema` | conversations/config-store.ts | T23 | |
| `isModelInCatalog`, `RuntimeHarness` | vendor/agent-cli-tool | submodule | 2 lines, not worth a submodule commit |

## Verification (on the committed tree, `git status --porcelain` empty)

```text
pnpm typecheck                          tc=0
pnpm test:server                        268 tests, 268 pass, 0 fail
pnpm test:client                        138 tests, 138 pass, 0 fail
bash tools/check-client-invariants.sh   exit 0
pnpm --filter ./client build            ok
```

- One flaky run before the merge commit: `websocket-lifecycle` "liveness terminates a half-open peer" failed once
  with `3 !== 1`. It is timing-sensitive, and it passed 3 of 3 reruns. It is unrelated to this branch.
- The crate addon has to be built in a fresh worktree (`pnpm --dir crates/unleashd-buddies build`) before
  `test:server` after T11.
