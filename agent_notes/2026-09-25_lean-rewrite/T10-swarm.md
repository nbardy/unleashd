# T10 swarm quarantine: report (branch refactor/swarm-quarantine, lane-swarm worktree)

**Commits:** d8bba69 (async routes and the server entry), 658169d, 6c7b8af, 77b29b2 (docs), 4a305d3 (test typing fix) and 84e8038 (trim to stay under the G8 CSS ceiling).
- **Commit message error:** 658169d says "core server imports" but it also contains the client move, which had been staged before that commit. 6c7b8af holds only biome's import sort and the client guard. History was not rewritten.

**1. Async routes.** `oompa-config`, `swarm-reviews`, `swarm-projects`, `swarm-signal` (read of stopped.json and write of stopped.json) and `buildSwarmContext` (the `oompa-swarm-context` route) now use `fs/promises`.
- Guard: `server/test/swarm-routes.test.ts` sends real HTTP requests through the entry to all 5 routes, with every sync fs call set to throw.
- I checked that the guard fails when the old context.ts is swapped back in.

**2. Imports before and after.**
- Server before: `server.ts` imported 4 swarm files, and `conversations/runtime.ts` and `turns/runner.ts` imported `swarm/observer`.
  - After: 3 files import only `server/src/swarm/index.ts`: server.ts (`readLatestSwarmRuntime`, `registerSwarmRoutes`), runtime.ts (`SwarmObservers`) and runner.ts (`watchSwarmRuns`, `SwarmObservers`).
- Client before: 9 core files imported swarm modules (App, Chat, VirtualizedMessageList, ConversationView, Gallery, directories, atoms/conversations, atoms/conversation-index, and ShellMobile via CSS).
  - After: 4 files import only `client/src/swarm/index.ts`: App, Chat, VirtualizedMessageList and mobile ConversationView.
  - Every export in that entry is lazy, so the core chunks carry no swarm code or CSS.
- The worktree fold (`getProjectRoot`, `isWorktreeDirectory`) is core code, not swarm code. It moved to `utils/directories.ts`, which changed one import line in each of the two atoms files.
- `MobileSwarmPrefix` (about 165 lines) moved out of ConversationView. The `.mobile-swarm-card` CSS moved out of mobile.css.

**3. Guards.** `server/test/swarm-quarantine.test.ts` and `client/test/swarm-quarantine.test.ts` fail when a file outside `swarm/` reaches a file inside it without going through the entry. They also pin the exact list of files that import the entry.
- Both guards were seen failing when a deep import was added.
- Pattern `quarantine` was added to docs/patterns.md. AGENTS.md gained a code-map line, and its `getProjectRoot` note was updated.

**4. What "delete swarm" removes.** Line numbers are approximate and were read before the final commits.
- `rm -r server/src/swarm client/src/swarm` (7 server files and 22 client files).
- Tests: `server/test/swarm-{observer,runtime,read-model-routes,routes,quarantine}.test.ts` and `client/test/swarm-quarantine.test.ts`.
- `server/src/server.ts`:
  - the `./swarm` import (about line 70);
  - `readLatestOompaRuntime: readLatestSwarmRuntime` (about line 361);
  - the `registerSwarmRoutes(app, {…})` block (6 lines).
- `server/src/conversations/runtime.ts`:
  - the import (line 45);
  - the `readLatestOompaRuntime` dependency (about line 121);
  - the `swarmObservers: new SwarmObservers(…)` entry (about lines 271–275).
- `server/src/turns/runner.ts`:
  - the import (line 25);
  - the `swarmObservers` port (about line 110);
  - `poke` (about line 427);
  - the `stopSwarmWatch` field and the watch calls in `clearWatchdogs` / `startWatchdogs`.
- `server/src/constants/timeouts.ts`: `SWARM_POLL_*` and `SWARM_CONTEXT_COMMAND_TIMEOUT_MS`.
- `client/src/App.tsx`:
  - the `./swarm` import;
  - 6 `lazyNamed(SWARM_PAGE_LOADERS.*)` lines;
  - 6 `DEVICE_CHUNKS` entries;
  - 3 `/workers*` route rows.
- `client/src/components/Chat.tsx`: the import, `visibleSwarmDebugPrefix`, the `<SwarmConvoPrefix>` block (about lines 720–727) and 2 props (about lines 771–772).
- `client/src/components/VirtualizedMessageList.tsx`: the import, the `InlineSwarmRunWidget` line (about line 543), and the `swarmDebugPrefix`/`swarmId` props and row slot (about lines 637–850).
- `client/src/mobile/conversations/ConversationView.tsx`: the import and the `showSwarmPrefix` render.

**Still tangled, outside this lane.**
- `shared/src/generated/oompa-types.ts` and its re-export at `shared/src/index.ts:868`.
- The `worker` variant of the Conversation kind and `RowKind` (T09), and `swarmDebugPrefix` on the detail.
- Oompa marker parsing in `server/src/adapters/jsonl.ts`, `tool-format.ts` and the ingest crate's `markers.rs`. This belongs to lane ingest-switch; I did not edit `adapters/*`.
- `swarmWorkersByProjectAtom` (client-state lane) and the `/workers` nav links in Sidebar and ShellMobile.

**Checks on the clean committed tree** (`git status --porcelain` was empty):

| Check | Result |
|---|---|
| typecheck | 0 |
| test:client | 138/138 pass |
| invariants | 8/8 pass |
| vite build | ok |
| test:server | 273/273 pass |

**Disk:** `/System/Volumes/Data` is at 100% (about 130 MB free), and some commands failed with ENOSPC partway through. Freeing my own `crates/target` (453 MB) needs `rm -rf`, which the dcg hook blocked, so the owner has to approve or run it.
