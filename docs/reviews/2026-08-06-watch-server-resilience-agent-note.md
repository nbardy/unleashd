# Agent Note — Watch-Server Resilience (PR Review Wrap)

**Branch:** `main`  
**Files:** `tools/watch-server.mjs` (+ `docs/refactor-plans/2026-08-06-watch-server-resilience.md`) — also this note  
**Incident:** `jsonl.ts:13:42 Expected ";" but found "is"` → `esbuild Transform failed` (via `tsx`) → `watch-server` exit 1 → `concurrently --kill-others-on-fail` killed 4 siblings → `pnpm dev:replace` required.

## What shipped

**Bandaid + Tweaks + B-minus + 3-agent hardening (all in `tools/watch-server.mjs`, ~170 insertions):**

1. **Quick-exit guard (B-minus, now hardened):**
   - `childStartMs` + `lastStderr` ring buffer (**32KB**, was 8KB, tee'd to `process.stderr` via `stdio: ['inherit','inherit','pipe','ipc']`).
   - Classification on **`close`** not `exit` (**fix HIGH: exit vs close race** — `exit` fires before stdio drains, `close` guarantees buffer complete).
   - `isTransformFailure = /Transform failed/i || /ERROR:\s+Expected/i` on buffer, `isQuickBuildFailure = !signal && code!=0 && (isTransformFailure || uptime<3000)`. `3s` is fallback only.
   - On match: log `Backend failed to start (exit 1, Transform failure)`, keep `pollTimer`, don't set `stopping`/`exitCode`, schedule one `5s` retry (`backendDownRetryTimer`, budgeted **3 retries then escalate to fatal** — **fix HIGH: infinite EADDRINUSE**) and `30s` `Backend is DOWN` reminder. Cleared on next successful `spawn` and in `stop()`/`poll()`.

2. **Tweak 1 — silent DOWN (HIGH):**
   - Env crash that exits <3s no longer waits forever. Now budgeted 3 retries then fatal, with 30s reminder. Fixes `nc -l 7499` zombie where 4 siblings look healthy but backend is DOWN.

3. **Tweak 2 — failWatcher backoff (LOW) + poll respect:**
   - `failWatcherConsecutive` with `backoff = min(5000, 300 * 2^(n-1))`, `scheduleReload(backoff)`, escalate after 20. `poll()` now early-returns if `failWatcherConsecutive>0 && reloadTimer` (**fix HIGH: pollTimer bypassing backoff**), and resets on success. Prevents `3.3Hz` spew on persistent `EACCES`.

4. **Docs:**
   - Header at line 29 + inline at ~187 explain incident, `tsx` vs `vite` HMR, and B-minus tradeoff. Plan doc corrected: `tsc` *does* emit on type errors (no `noEmitOnError`) + partial-emit race, Option A rejected; B-minus kept `close` + `32KB`; added Option D pre-flight.

## Why not Option A / full B / C

- **A (`tsc --watch` → `dist`):** False premise + file-by-file emit race (`600ms` settle can restart mid-emit). Would need `noEmitOnError` + atomic emit.
- **Full B/C (`chokidar` + drop `--kill-others-on-fail`):** Would zombie `vite`/`shared` on stale `shared/dist` — worse than incident. B-minus gets precision without that.

## Lifecycle check

Clean. `RELOAD_MESSAGE` IPC → `controller.handleReload` drain still `wait-for-exit-then-spawn` at line 135 (load-bearing). No process adoption, no second readiness gate. `stop()` clears retry/reminder timers. `poll()`/`startServer()` correctly reset counters.

## Verification

```
node --check tools/watch-server.mjs  # 0
pnpm --filter @unleashd/server build  # 0
```

Manual:
- `const x is string` typo → `Backend failed to start` logged, runtime stays up, fix → restarts without `pnpm dev:replace`
- `nc -l 7499` + save → `EADDRINUSE` quick crash → DOWN log, 5s retry, 30s reminders
- `kill -9` backend → signal path still fatal
- `Ctrl-C` while DOWN → timers cleared, exit 0

## Commits (for PR)

**Note:** Sandbox `.git` is read-only (`Unable to create '.git/index.lock': Operation not permitted`), so this commit was prepared but not applied in-session. Run the commands below outside the sandbox to finalize.

**Intended commit (includes 3-agent hardening):**
```
fix: make watch-server resilient to transient build failures (B-minus + hardening)

- esbuild Transform errors no longer kill dev runtime via --kill-others-on-fail
- B-minus: pipe stderr (tee, 32KB ring, close not exit), classify Transform failed vs env crash, 3s fallback
- Tweak 1: 5s retry budgeted 3× then fatal + 30s DOWN reminder (fixes infinite EADDRINUSE)
- Tweak 2: failWatcher backoff (min 5000, escalate after 20) + poll respects backoff (fixes 3.3Hz spew)
- Docs: correct tsc premise (noEmitOnError false), slim Option B to B-minus, add Option D pre-flight
```

**Files in commit:**
- `tools/watch-server.mjs` — ~170 insertions, 10 deletions (B-minus + 3-agent hardening: close vs exit, 32KB, retry budget, poll backoff respect)
- `docs/refactor-plans/2026-08-06-watch-server-resilience.md` — corrected tsc premise, B-minus + hardening, Option D
- `docs/reviews/2026-08-06-watch-server-resilience-agent-note.md` — this note

**To commit (outside sandbox — .git is read-only in-session):**
```bash
git add tools/watch-server.mjs docs/refactor-plans/2026-08-06-watch-server-resilience.md docs/reviews/2026-08-06-watch-server-resilience-agent-note.md
git commit -m "fix: make watch-server resilient to transient build failures (B-minus + hardening)

- esbuild Transform errors no longer kill dev runtime via --kill-others-on-fail
- B-minus: pipe stderr (tee, 32KB ring, close not exit), classify Transform failed vs env crash, 3s fallback
- Tweak 1: 5s retry budgeted 3× then fatal + 30s DOWN reminder (fixes infinite EADDRINUSE)
- Tweak 2: failWatcher backoff (min 5000, escalate after 20) + poll respects backoff (fixes 3.3Hz spew)
- Docs: correct tsc premise (noEmitOnError false), slim Option B to B-minus, add Option D pre-flight"
git log --oneline -1  # copy hash into PR description
```

**Current `git status` (for reviewer):**
- Modified but not yet committed: `tools/watch-server.mjs` (+ plan/note as untracked)
- Other `M` files (`client/src/components/Chat.tsx`, `server/src/adapters/*`, `shared/src/index.ts`, `vendor/agent-cli-tool`) are unrelated to this PR — do not include in this commit.

## Cleanup Disposition (Repo Janitor — 2026-08-10)

Reviewed remaining dirty/untracked files named in janitor task against `git diff` and history:

| File | `git diff` vs HEAD | Disposition | Rationale |
|---|---|---|---|
| `client/src/components/Sidebar.tsx` | clean (0 diff) | **committed** — no action | Part of aa97bdf follow-ups, committed in `91aea25` (Sidebar kind-aware, 23 lines). Not part of watch-server fix (`c7040ee` only touches `tools/watch-server.mjs` + docs). |
| `client/src/components/Chat.tsx` | clean | **committed** — no action | Same — committed in `91aea25` (fork transcript, 8 lines). |
| `server/src/adapters/*` (`disk-adapter.ts`, `jsonl.ts`, `muse-adapter.ts`, `loader.ts`, `registry.ts`) | clean, tracked (`git ls-files` lists 8 files) | **committed** — no action | Holistic `ConversationKind` + Muse/Cursor rehydration adapters introduced in `aa97bdf` (905 ins), polished in `91aea25` (88+ lines disk-adapter, etc.). Not watch-server. |
| `server/src/conversations/runtime.ts` | clean | **committed** — no action | Kind dispatcher + fork retention — `aa97bdf` → `91aea25` (49 lines). |
| `server/src/lifecycle/session-loader.ts` | clean | **committed** — no action | Loader mtime handling — `aa97bdf` (18 lines) → `91aea25` (31 lines). |
| `server/src/transport/conversation-websocket.ts` | clean | **committed** — no action | WS kind handling — `aa97bdf` (54 lines) → `91aea25` (29 lines). |
| `shared/src/index.ts` | clean | **committed** — no action | Re-export of `conversation-kind` — `aa97bdf` (15 lines) → `91aea25` (11 lines). |
| `vendor/agent-cli-tool` | clean, submodule at `1977de2` | **committed** — no action | Submodule bump `dda24d6→1977de2` committed in `91aea25`. `git submodule status` shows `-1977de20...` (not initialized locally, but recorded in index). Not discarding. |
| `product/` (`PLANNING_MOBILE.md`, 297 lines) | untracked, never in `git log --all -- product/` | **gitignored** — not committed, not removed | Standalone Mobile PWA planning doc (v2, "planned, not yet coded"), unrelated to both watch-server fix and aa97bdf follow-ups. Preserved on disk; added `product/` to `.gitignore:38` so `git status` is clean. To publish: `git add -f product/mobile/PLANNING_MOBILE.md` and commit separately. |

**Result:** `git status --porcelain` now shows only `M .gitignore` (the new ignore entry). After that is committed or stashed, working tree is clean. `git diff HEAD` for all 8 claimed code paths is empty — nothing to stash or discard. `vendor/agent-cli-tool` dist artifacts are inside submodule and ignored by parent. No collateral `yarn.lock`/`node_modules` changes.

## PR Reviewer Checklist

- [ ] Confirm `stdio: pipe` + tee doesn't lose logs (should appear exactly as before)
- [ ] Confirm `3s` fallback still desired for non-Transform quick crashes (top-level throw)
- [ ] Consider follow-up: Option D pre-flight check (keep old server on typo, true Vite HMR) — deferred, composes with B-minus
