# S11: leftovers (docs + legacy deletions): report

Branch `chore/leftovers-docs` in `.claude/worktrees/lane-leftovers`, on b484aaa. Three commits, not pushed or merged.

| Commit | What |
|---|---|
| 56c96de | docs/architecture.md: the records-store paragraph replaces the `withSessionLookupIndex` and scan text; the Buddies-page tombstone paragraph is gone; addons, bootstrap and swarm entry notes added. docs/pass-through-pattern.md step 4 now points at config-records.ts and the Rust store. |
| 7dbce5d | Deleted `legacy-config-migration.ts` and `shared/src/legacy/codex-composite-model.ts`. **Correction to the brief:** the migration was also the live κ for discovered native sessions (session-loader → `configService.hydrate`). That mapping moved into config-service.ts as `configFromSessionEvidence`; only the Codex composite decode was dropped (per T14a). `toCodexModelId` is gone. `fromCodexModelId` is kept, inlined in shared/index.ts. |
| 1f6a362 | README Buddies section: dropped the `@nbardy/buddies` package, its CLI scripts and `vendor:buddies`; it now points at the crate README's import and deploy steps. ws-contract-surprises.md: `change-feed.ts` becomes the event bus, and the "config-store read" wording is fixed. The conversation-config.ts comment is fixed. |

Checks on the clean committed tree (`git status` empty): typecheck 0; test:server 254/254; test:client 152/152; test:tools 5/5; invariants 0; vite build 0.

**Not done / handed off:**
- **AGENTS.md (= CLAUDE.md) not edited.** My rules say an agent message cannot authorize changing CLAUDE.md; T23b stopped at the same point. The owner should apply this: in the tree map, `config-{service,store}.ts` → `config-service.ts + config-records.ts → config over the Rust ConversationRecords store (crates/unleashd-ingest)`, and add `crates/unleashd-ingest/ → records + transcript ingest addon`. Bootstrap, addons, the Buddy crate and swarm are already correct there. Its "Never run the Buddies package CLI" bullet is now historical.
- S2 call sites left alone:
  - `adapters/disk-adapter.ts:24,256` uses `fromCodexModelId`. Delete that function and `codex-spark-model.test.ts` with it.
  - `lifecycle/session-loader.ts:225,349` passes `legacy:` to `hydrate`. The field keeps that name; a comment marks it for renaming.
- **`test/package-smoke.js` (`pnpm test:package`) is dead.** It asserts the vendored `@nbardy/buddies` archive and provenance, and spawns the deleted stdio builder MCP. It needs a rewrite for buddies-core and the HTTP MCP, or deletion. Owner call.
- Left as history: config-store and mcp-server mentions in product/buddies/*, the crate comments ("was config-store.ts"), the `send_message (deleted)` notes, and patterns.md.
