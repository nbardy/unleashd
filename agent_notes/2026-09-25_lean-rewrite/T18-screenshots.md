# T18: screenshot coverage and compare (client step S0)

Branch `tools/screenshot-coverage`, based on `lean/integration`. It merges `lean/integration` up to d7613fd. Nothing was pushed by me, and nothing was merged into `lean/integration`.

## Commits (`git log lean/integration..HEAD`)

| SHA | What |
|---|---|
| 34e972b | tools(screenshots): cover every client route, read-only session, `--compare` / `--baseline` |
| a960817 | test(tools): pixel-diff math. Identical images give 0; a known rectangle gives its area. Adds `pnpm test:tools`. |
| a3f1158 | docs(agents): Screenshot review covers every screen, plus the before/after loop |
| 72bb25d | merge lean/integration (5b0dffb). Conflict in package.json: kept `test:tools` |
| 6fe44c6 | fix: write guard moved into the page, idle tracking per page, clean exit. Tags the compare loop as `fix-guards` in docs/patterns.md. |
| a58a790 | merge lean/integration (d7613fd) |
| 97348ad | fix: software raster, a volatile mask that does not change layout, re-pin of followed bottoms. AGENTS.md updated. |

Verified at HEAD with a clean tree: `pnpm test:tools` (3/3 pass), client `tsc -b` (clean), biome check (clean).

## Result: two full runs and a compare

**0 of 106 shots differ. Every pair is pixel-identical at threshold 0% and tolerance 2/255.** The after run exits 0.

- Before: `/Users/nicholasbardy/git/unleashd/.claude/worktrees/agent-a30b91dc6e58ee73e/output/screenshots/t18-final2-before/index.html`
- After: `.../output/screenshots/t18-final2-after/index.html`
- Compare: `.../output/screenshots/t18-final2-after/compare.html` and `compare.json`

**Server.** This worktree's built server ran on port 7589 with `HOME` pointing at a sandbox:
- The sandbox holds APFS clones of `~/.agent-viewer`, `~/.claude/projects`, `~/.codex/sessions`, `~/.cursor/projects` and `~/.gemini`, plus a `sqlite3 .backup` snapshot of `~/.buddies`. `BUDDIES_HOME` pointed at that copy.
- The server's `PATH` held only `node`.
- The Buddy scheduler does run on that server. It tried to run a due return and logged `spawn codex ENOENT`, which is the intended outcome: with no agent binaries on `PATH`, it cannot launch a real agent.
- The driver script killed the server and any Chrome on exit, using a `trap`.
- Scripts: `scratchpad/sandbox/`, `run-var.sh` (session scratchpad).

**Earlier runs show that compare catches real change.** Before the last fixes, the same pair produced 22 of 106 over 0%:
- a `swarm@ipad-portrait` diff where the card changed from "4 idle" to "4 running". This was real drift: swarm state is read from the real repo's `runs/` directory, not from the copy.
- sigil GPU speckle, a reflowed timestamp, and a thread 1px short of the bottom.

Each non-data cause was fixed (see below). Against the owner's live dev server at :7489, gallery and search show 3–20% diffs from live activity. That is real drift the masks cannot hide, so a static copy is the right baseline.

## Screens per size (final run: 106 shot, 14 skipped)

- **phone** (mobile tree): 25 shot
  - Shot: gallery, done, search, search-empty, new-conversation, chat, chat-picker-open, buddies, buddy-{conversations, work, team, mailbox, background, memory, automations, settings}, workspace-activity, channels, channel, thread, mention-menu, mention-model, swarm, swarm-detail, swarm-analytics.
  - Skipped: settings-menu, usage and task-filter (no mobile UI); focus and task-hover (these need `--focus <text>`).
- **ipad-portrait** (mobile tree): the same 25 shot, and the same 5 skipped.
- **ipad-landscape** (desktop tree): 28 shot. That is the phone list plus settings-menu, usage and task-filter. Skipped: focus and task-hover (need `--focus`).
- **desktop**: 28 shot, the same as ipad-landscape. Skipped: focus and task-hover (need `--focus`).

**Data used:**
- workspace wave_sim, channel #projects, with a replied thread and a Task-linked post
- chat `01a095e5…` (967 messages; the longest general chat that is not running, not done, and idle for at least 1h)
- Buddy "Animal Fights Lead"
- swarm project `~/git/unleashd`

**Not shot:**
- Streaming. A live turn always differs between runs, so the tail-regroup test covers it instead.
- A separate "sidebar" screen. The sidebar appears in every desktop shot.

## How it works (non-obvious choices, each with a reason comment in code)

- **Read-only session.** The page refuses non-GET fetch, XHR and beacon calls, and drops WebSocket sends. The manifest records what was refused.
  - The old tool POSTed `owner-read` to whatever server it pointed at. Every run now shows 18 of those blocked.
  - Interception moved into the page, not CDP `Fetch`. Pausing every request through CDP stalled the app's idle chunk preloads: 22 requests were still open after 90s.
- **Stable pixels:**
  - The page's `Date` is frozen at the run's clock, and `--baseline` replays that clock.
  - Animations and transitions jump to their end state, and carets are transparent.
  - localStorage, sessionStorage and IndexedDB are cleared before every page. Otherwise desktop `/` restored the last chat, and shots depended on the order screens ran in.
  - Each shot waits until the network has been idle for 500ms. The idle-time prefetch of chat history is ignored; it ran for more than 30s on real data.
  - Panes that are following the bottom are re-pinned just before the shot.
  - Chrome runs with `--disable-gpu` and SwiftShader WebGL. On the GPU, sigil speckle and dot anti-aliasing varied from run to run.
- **Volatile regions.** `[data-volatile]` is set to `display:none`. It is used once: `BuddyTeamExecution`'s "Updated <server time>". That time comes from the server's clock, so the frozen page clock cannot pin it. `display:none` rather than hidden, because a hidden element still reflowed its line.
- **Diff runs in the headless Chrome the tool already drives**, using `createImageBitmap` and `OffscreenCanvas`, so it adds no dependency.
  - The pure math is `tools/lib/pixel-diff.mjs`, shipped into the page as its source string. The Node test therefore covers the code that actually runs.
  - Why not a hand-written PNG decoder: it would need inflate, 5 filter types, palettes and 16-bit handling.
  - Why not `sips`: it only exists on macOS and cannot produce a diff image.
  - Per-channel tolerance is 2/255, so a colour-token rounding change does not light up a whole panel. The measured noise in the final runs is 0.
- **`--baseline <A>`** replays A's data ids, clock, sizes and `--only`, captures, then compares and exits 1 if any screen is over threshold. `--compare A B [--threshold pct]` re-diffs two existing runs. A shot missing from either run counts as a failure.
- **Clean exit.** Chrome is spawned with no stdio pipes. A surviving crashpad helper had kept the stderr pipe, and with it the Node process, alive after a finished run.

## Files

- `tools/screenshots.mjs`: screens, discovery, `--baseline`/`--compare`, and the contact sheet.
- `tools/lib/headless-chrome.mjs`: the stabilising script, read-only guard, network-idle wait, and the blank tab used by compare.
- `tools/lib/screenshot-compare.mjs`: the compare loop, which writes `diff/`, `compare.json` and `compare.html`. Tagged `Pattern: fix-guards`.
- `tools/lib/pixel-diff.mjs` and `pixel-diff.test.mjs`.
- `AGENTS.md` (CLAUDE.md is a symlink to it), "Screenshot review": the no-regression loop, the read-only session, and how to run a static server.
- `docs/patterns.md` fix-guards: the screenshot compare loop is named as the visual regression guard.

## Follow-ups (not done)

- **Swarm views read real repo `runs/` directories even on a copied data dir**, so they can drift between runs, as "4 running" did once. Pin swarm screens with `--only`, or accept the drift.
- **`useFollowBottom` pins only once per render.** Content that grows afterwards leaves the pane short of the bottom. The tool compensates, but this is probably a small real UI bug.
- **`focus` and `task-hover` still need `--focus <text>`**, so they were not exercised in these runs.
