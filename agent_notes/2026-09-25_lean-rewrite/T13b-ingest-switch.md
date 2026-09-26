# T13b-1: ingest switch (STOPPED: disk full, and a guard blocked the cleanup)

Worktree `.claude/worktrees/lane-ingest-switch`, branch `feat/ingest-switch`, at base `9dcfe5a`. **No commits.**
Nothing is pushed or merged. No server processes were left running.

## Why it stopped
- The data volume filled up: 178 MB free out of 460 GB. `pnpm test` in the crate died with ENOSPC while writing
  its output.
- I tried to free my own scratch store (`rm -rf <scratchpad>/ingest`, a 547 MB probe DB). The `dcg` hook blocked
  it with rule `core.filesystem:rm-rf-root-home`. Per the lane rules I stopped instead of working around it.
- To free space by hand, these are mine and can be removed:
  - `<scratchpad>/ingest/` (547 MB);
  - `<scratchpad>/av-before/` and `<scratchpad>/av-after/` (APFS clones of ~/.agent-viewer; only their changed
    blocks use space).
- `<scratchpad>` = `/private/tmp/claude-501/-Users-nicholasbardy-git-unleashd/b1890725-b145-431c-a693-6aa36fde749c/scratchpad`.

## Done (uncommitted, in the worktree)
- **Crate: `ChangeEvent.changes.rewritten`**, the sessions whose history was replaced or withdrawn and not only
  appended. This is the flag T13a asked for, so the server can cache pages by seq. Guard:
  `tests/engine.rs a_rewritten_source_is_reported_as_rewritten`.
- **Crate: `Ingest.search(query, limit)`**, a deep search that replaces `/api/search`'s scan of in-memory
  transcripts:
  - It uses a LIKE scan on its own connection, so it never holds the page reader.
  - Measured on real data: 0.3–0.5 s warm and 7 s the first time (cold page cache).
  - Guard: `search_finds_listed_messages_newest_first_with_literal_wildcards`.
- `cargo test --test engine`: 5/5 pass.
- The napi rebuild is not current. `index.d.ts` has `search` but not yet `rewritten`.
- `server/package.json` gained `@unleashd/ingest: workspace:*`, and the lockfile is updated.

## Measured (old code, copy of ~/.agent-viewer, port 7611, no agent CLIs on PATH, buddies DB absent)
- First boot: 21.1 s to "Initial load complete". This includes the one-time v1→v2 record migration.
- Warm boot: 1.57 s. The loader read 500 files (all 500 served from the session cache) and hydrated
  342 conversations.
- Crate on the same machine (load ~35):
  - cold ingest 25.7 s: 7,968 sources, 293k messages, 9.5 GB read;
  - warm start 2.0 s; `listSessions` 0.65 s for 5,979 rows (4.6 MB);
  - fetching all 19k messages of the largest session (14.7 MB) takes 57 ms.
- Rows with `cwd: unknown`: 95, all Muse approval-review children. TS showed them with `process.cwd()`.
- Records with more than one bound session: 880 of 8,161. Their history has to be merged across files.

## Design decided (not yet written)
- Runtime `messages` becomes the live-turn overlay only.
- History = `mergeSessionMessages(natives truncated to the counts at the last settle, overlay)`, served async
  through `MessageSource`.
- Row counts are `settled + new overlay`. A settle runs on hydrate, and on `onChange` for idle conversations;
  changes for active ones are queued until idle.
- The epoch bumps on a rewrite, on overlay absorption, or when a count shrinks.
- One backstop timer, armed only while external activity or queued changes exist.

## Deferred
- All of steps 1–3: the server switch, deleting jsonl.ts, the parsers, session-cache and the poller, and the
  startup-after measurement.
