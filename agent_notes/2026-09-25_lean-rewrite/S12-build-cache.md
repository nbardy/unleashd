# S12 build cache: report (branch tools/addon-cache, worktree lane-s12, 5 commits f88d757..5f421e7)

**What landed**
- `tools/ensure-addons.mjs` (tag `Pattern: build-cache`). The key hashes the crate's `src/**`, `build.rs`, `Cargo.toml`, package.json's `napi` + `scripts.build`, the workspace Cargo.toml without `members`, the Cargo.lock entries the crate can reach, `rustc -vV`, CARGO_BUILD_TARGET and RUSTFLAGS.
  - Hit: the `.node` and `index.d.ts` are copied (by rename, only when the bytes differ) from `.addon-cache/<crate>/<key>/`.
  - Miss: builds with `nice -n 15`, CARGO_BUILD_JOBS=3 and the shared CARGO_TARGET_DIR, then publishes with an atomic dir rename under a `<key>.lock` directory. A lock whose owner is dead is reclaimed.
  - If the key changes during the build (a save), nothing is cached. Every run prints `hit`/`miss` and its timing.
- The importers are split out: `crates/unleashd-buddies-import` (import + verify + the `buddies-import` bin) and `crates/unleashd-records-tool` (records import + the `records-tool` bin).
  - Both depend on their addon crate with `default-features = false`. The `cli` features are gone.
  - `store::collect`, `records::store::put` and `Records::connection` became `pub`.
  - The ingest crate dropped its unused `sha2` dependency.
  - `index.d.ts` diff vs base: empty (no napi bindings removed).
- Wiring:
  - New scripts: `pnpm run bootstrap` (install, cli, shared, addons) and `pnpm addons`.
  - The dev-supervisor `build`, `dev` and `dev-server` tasks run ensure-addons. `build` previously built buddies-core only; `dev` had no addon step.
  - `test:server` runs it first, and so do the crates' own `pnpm test` scripts.
  - The dev watcher's saved-`.rs` path calls ensure-addons, and only for addon crates (those with a napi package.json).
  - `pnpm --dir crates/<c> run build` still forces a build.
- Docs: a build-cache section in `docs/patterns.md`, AGENTS.md Misc, `docs/architecture.md`, both crate READMEs, and the records-tool command in `config-records.ts`.
- T15-RUNBOOK:
  - Step 0 is now `cargo build --release -p unleashd-buddies-import -p unleashd-records-tool`.
  - Step 9 is now `pnpm addons`.
  - Both steps keep the pre-S12 commands as a fallback note.

**Measured (fresh worktree s12-measure, since removed)**
- `pnpm run bootstrap` with a cache hit took 5.5 s in total. The addons step took 0.01 s per crate and never started cargo.
- Cold ensure (empty cache, empty target dir) took 68.2 s: buddies 30.4 s, ingest 37.7 s. A miss on a warm shared target dir takes about 12–14 s per crate.
- After editing an importer file in each tool crate, ensure-addons took 0.14 s with both crates hitting, and the `.node` mtimes did not change.
  - Rebuilding the tool bins took 22.7 s. That recompiles the addon crates as rlibs, not the `.node`.

**Guards**
- `tools/ensure-addons.test.mjs`:
  - A TS edit, a tool-crate edit, a `members` edit, a test-script edit or an unreachable lock entry keeps the key; a source edit, a new file or a reachable lock entry changes it.
  - A hit with spawn set to throw installs the cached addon.
- `tools/watch-server.test.mjs`: saving in a non-addon crate builds nothing.

**Checks on the clean committed tree (all rc=0)**
- typecheck, test:server, test:client, test:tools, test:dev-supervisor, invariants, vite build.
- Crate tests (throttled): buddies, ingest, buddies-import and records-tool.
- test:tools and test:dev-supervisor were re-run after the last 2 commits.

**Incidents / leftovers**
- `pnpm setup` is a pnpm BUILTIN. My first measurement ran it, and it appended a PNPM_HOME block to `~/.zshrc`.
  - I removed exactly that block; the backup is at `scratchpad/zshrc.with-pnpm-block.bak`.
  - The script is renamed `bootstrap`, and AGENTS.md now warns about it.
  - pnpm may also have placed files under `~/Library/pnpm`; I did not check that.
- dcg blocked `rm -rf` of the scratchpad `cold-target` (445 MB) and `cold-cache` (12 MB). Both are left under the session scratchpad.
- dcg blocked `git checkout --` on the measure worktree, so I reverted the appended lines by editing them out. `git worktree remove --force` was needed because of the submodule; the tree was clean.
- Startup is strict: if a changed Rust source doesn't build, `pnpm dev`/`build` now fail instead of starting with a stale addon. The watcher still keeps the current addon on a failed save.
- Known race, not introduced here: two worktrees missing on the same crate with different sources share one target dir. Cargo serializes them, but napi's copy step can race.
