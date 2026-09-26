# Dead-code sweep: chore/dead-code-sweep (456e4db..0e47b9b, 15 commits, not pushed)
Net: 59 files, +39 / -1505. `pnpm test` exit 0 and check-client-invariants 8/8 on the clean committed tree.
- shared (-211): jsonc subpath and stripJsonc, buddy-access.ts, DEFAULT_CODEX_MODEL_ID, defaultReasoningEffortForProvider, modelValidationHint, DEFAULT_PROVIDER, PROVIDER_IDS, generated CURSOR_MODEL_IDS, the configure_team TeamConfiguration/ConfigureTeamInput schemas, 12 unused z.infer aliases.
- client/src (-120 +13): saved activeConversationId and sidebarViewMode prefs (written, never read), stopConversation, lerpLatent, isRowBusy, getLastMessageTime, ComposerMobile's deprecated queueLength prop.
- CSS (-40): 15 unused custom properties, @keyframes buddy-task-pulse, .mobile-chat__action-error. G8 ceiling lowered 14838 -> 14798.
- server/src (-17): automationClaimToken plumbing (never set) and the free formatToolResult.
- tests (-863): restore-on-load.test.ts (its restore is gone), 8 broken manual test/{cli,ws}-*.js probes, fixtures chat-run.ts, syntheticTranscript, replaceRecord.
- deps (-193): concurrently, the duplicate root ws devDep, @types/uuid (plus lockfile).
- client files (-75): Vite template README, react.svg, the unreferenced save-prompt.png.
- docs (+16 -21): AGENTS-linked docs, the ingest README and the G2 message pointed at deleted adapters/, conversation-kind.ts, change-feed.ts, ingest-parity.ts, useBuddyAutomations, refreshIfStale, AutomationCard.
- Correction: 6279503 alone breaks the shared build (it left the index re-export). 0e47b9b fixes it, so keep both or squash them.
## Deferred
- server/src/buddies/turn-policy.ts: buildFirstTurnCliContent and extractBuddyMemorySnapshot (~70 lines) are used only by tests (conversation-runtime and buddy-conversation-contract). Production calls the policies' providerPrompt. Retarget those 3 tests, then delete.
- Memory-curation benchmark: its harness (buddy-memory-curation.test.ts) was deleted in 2090959. The fixtures/memory-curation README (an AGENTS.md row) and CURATION_CASES are orphaned. Restoring or retiring it needs an owner decision.
- Rust napi: BuddiesCore.pruneEvents and listChannels have no TS caller. Removing them needs an addon rebuild. clippy -W dead_code is otherwise clean.
- About 220 exports are used only inside their own file (knip, --production). This is over-export only; I did not strip the `export` keywords.
- The vendor submodule comment in src/catalog.ts still names shared/src/utils/jsonc.ts. I did not bump the submodule for a comment.
## Channel area (not edited, for PORT-3)
- channel-data.ts: authorKey, CHANNEL_PAGE, inboxUrl, joinNames, workspaceDirectory, workspaceTasksUrl, respondingUrl, respondingText, OWNER_INBOXES_KEY, inboxRequests and type FeedOpening are exported but used only in-file. channel-text.ts: same for fuzzyScore, referenceToken, EMPTY_CHANNEL_DRAFT.
- buddy-channel-posts.ts: ChannelReferenceSchema is used only in-file. out-of-tokens.ts: nothing dead. No unused CSS selectors in Channel*.css or mobile-channels.css.
- docs/ws-contract-surprises.md:190 still names `onChannelPost`, which no longer exists.
