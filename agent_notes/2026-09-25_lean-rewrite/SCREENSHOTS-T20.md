# SCREENSHOTS-T20: before/after visual check of today's client work

Status: DONE. 53 cells: **3 regression, 4 unclear, 36 expected, 10 no real change** (identical outside the sidebar, or data/timing noise only).

- BEFORE: db98212 (worktree `shots/before`, removed at the end)
- AFTER: a039b77 (`.claude/worktrees/lane-shots`, branch chore/screenshot-compare)
- Merges in range: channel-parity, budget-server-core, claude-agent-subagents, channel-css-tokens,
  budget-buddies, t20-buddy-tabs, t20-conversation-panels, t20-picker-search, t20-swarm, t20-lists,
  background-agent-completion, t20-transcript-composer.

## Setup (safety)
- Data: APFS clones of `~/.agent-viewer` to `shots/data/{before,after}/agent-viewer`, and
  `db/buddies-v4.sqlite` (the newest dry-run import; `~/.buddies/buddies-v3.sqlite` does not exist)
  to `shots/data/{before,after}/buddies/buddies-v3.sqlite`. Each side has its own copy.
- Servers: `shots/run-server.sh` runs `node --import tsx server/src/server.ts` under `env -i`,
  NODE_ENV=production (serves the vite-built `client/dist`), with UNLEASHD_DATA_DIR,
  UNLEASHD_BUDDIES_DB and BUDDIES_HOME pointed at the copies. PATH = `shots/bin` (node, git only)
  + /usr/bin:/bin:/usr/sbin:/sbin. `which` finds none of claude/codex/gemini/cursor-agent/opencode/agent.
- Ports: BEFORE 7611, AFTER 7612. The owner's dev server was not touched.
- The server needs `conversation-records.sqlite` (schema 2). The dry-run copy in `db/` was schema 1,
  so each side got its own fresh import, using the runbook commands (record-migration, then
  records-tool import/verify). Both reported ok=true, 8218/8218.
- Buddy runs failed with `spawn codex ENOENT`, so no agent was launched. The tool reported
  blocked writes: 0 on both runs.

## Run folders (all under `shots/runs/`)
- `A-before/`: BEFORE server + BEFORE tree's tool (the tool is byte-identical in both trees). 53 shots.
- `B-after/`: AFTER server, `--baseline A-before` (same data ids and pinned clock).
  **Compare sheet: `shots/runs/B-after/compare.html`** (50 of 53 over 0%).
- `C-after-selectors/`: 6 re-shots (search, search-empty, chat-picker-open). The tool's selectors
  still name the deleted SearchPalette and chat-config-modal classes, so the AFTER run skipped
  those screens. I used a scratch copy of the tool with the new selectors
  (`shots/tool/screenshots-t20-selectors.mjs`); the committed tool is unchanged.
- `D-after-newconv/`: a re-shot of new-conversation (see U1).
- `pairs/`: before|after composites (phone: left/right; desktop: top/bottom). `crops/`: zoomed evidence.

## Noise to ignore when reading the compare
- **Desktop sidebar**: every desktop shot differs in the sidebar because of data drift. The BEFORE
  server's scheduler briefly had a wave_sim CEO run "running", so wave_sim sorted first; in AFTER
  basketball_model sorts first. Six screens are pixel-identical once the sidebar is masked:
  chat@desktop, chat-picker-open@desktop, buddies@desktop+phone, workspace-activity@desktop+phone,
  plus channels@phone.
- **Conversation lists**: transcripts are ingested from the live `~/.claude/projects` (read-only),
  and background workers were writing at the time, so AFTER holds 6 more conversations
  (3512 vs 3506). Rows reorder on the phone lists.
- **Sigil avatars**: sigils render through a worker, and it had not finished within the tool's
  20 s settle on channel pages or workspace home (the log says `still loading ... sigil.worker`). So
  some AFTER shots show flat coloured squares. A re-shot (`E-after-channel/`) renders them
  normally, so this is timing, not a regression.
- **Scroll offset**: channel lists are pinned to the bottom. Taller text (CSS tokens) changes which
  post sits under the sticky date divider.

## Verdict per cell
Legend: E = expected (lane report), R = regression, U = unclear, = = no real change.
"-" = the mobile tree has no such screen. focus and task-hover were skipped on both runs, because
they need `--focus`.

| screen | phone | desktop | notes |
|---|---|---|---|
| workspace-home | = | = | sigil timing only |
| gallery | E | U | phone: unified ConversationRow (T20-F). desktop: cards now size to content and the "Idle · 1d ago" status lost its pill background. T20-F does not list this |
| done | E | **R1** | desktop: preview text overflows the card |
| search | E | E | T20-B: idle list of recent conversations, palette rows. Minor: the desktop palette input lost its magnifier icon, and the phone input shows no focus ring |
| search-empty | E | E | T20-B sectioned empty states |
| new-conversation | E | U1 | phone: T20-F (PathAutocomplete, Create/New Swarm). desktop: T20-B pills wrap and Create is visible (expected), but see U1 |
| settings-menu | - | E | the menu is identical; the only difference is the gallery cards behind it |
| usage | - | = | data drift (token counts) |
| chat | E | = | T20-E: role label, 1.7 line-height, smaller send glyph. The phone side gutter is narrower (about 10 px against 20 px) |
| chat-picker-open | E | = | T20-B: "Conversation settings" sheet, radio pills, default meta |
| buddies | = | = | |
| buddy-conversations, -mailbox, -memory, -schedules, -work, -background, -settings (7) | E x7 | E x7 | T20-C: status badge on both trees, "About this Buddy", "← Buddies" link on desktop, header about 6 px tighter |
| workspace-activity | = | = | |
| channels | = | E | CSS tokens: 15 px post text, wider column |
| channel | E | E | tokens. The phone right gutter is tighter |
| thread | E | **R2** | desktop: the reply composer placeholder is clipped |
| task-filter | - | E | tokens |
| mention-menu | E | E | tokens, taller rows |
| mention-model | E | E | T20-B default meta ("Model default · xhigh") |
| swarm | U3 | E | T20-D: "Swarms" title, whole-card Link "Open →", runtime counts |
| swarm-detail | **R3** | E | desktop: T20-D (subtitle, run picker no longer hidden under the tabs, compact review log). "No oompa config found" is now red |
| swarm-analytics | U2 | E | desktop: "Loading swarm data…" on BOTH runs (not new) |

## Regressions
**R1: done@desktop (and any Gallery card with a long unbroken preview). The preview text overflows the card.**
`http://unleash.localhost/buddies/workspaces/project_956…` runs past the preview box and the
card's right edge (`crops/done-overflow-after.png`). BEFORE clipped it at the card edge.
Best guess: T20-F moved the card body to `client/src/views/conversation-row/ConversationRow.css`.
`.conversation-row__preview` (line ~284) has no `overflow-wrap:anywhere` / `min-width:0`, and the
old `components/Gallery.css` card had `overflow:hidden` (db98212 Gallery.css:7), which the new card no longer has.

**R2: thread@desktop. The reply composer placeholder is clipped at the top.**
"Reply to @Wave Simulation Lead Can we kic koff tw…" now wraps to two lines in the thread pane.
The first line runs into the box's top border (`crops/thread-reply.png`). BEFORE fit on one line.
Best guess: the channel-css-tokens merge (1fb3dc6), in `client/src/components/buddies/ChannelComposer.css`
(`.channel-composer textarea`). Font 14.5 → 15 px (`--fs-post`) and side padding 14 → 16 px
push the long placeholder onto a second line inside a `min-height: 42px` textarea, which
scrolls instead of growing.

**R3: swarm-detail@phone. The page title collapses to "~".**
The narrow header puts back link, title/subtitle, "All idle" badge and "Debug Conversation" in one
non-wrapping row. At 375 px `~/git/wave_sim` shrinks to "~" and the subtitle to "3.."
(`pairs/swarm-detail@phone.png`). BEFORE stacked the title on its own line.
Best guess: T20-D, in `client/src/swarm/SwarmPage.tsx` (`.swarm-page-header ui-row`, with
`.swarm-page-actions`) and its CSS. For `layout="narrow"` the actions need to wrap below the
title, or to shrink.

## Unclear
- **U1 new-conversation@desktop: the directory field was empty in the first AFTER run.**
  The placeholder "Search recent or type a path..." showed, where BEFORE pre-filled the directory.
  A re-shot (`D-after-newconv/`) and a live probe both showed it pre-filled, so it is a race.
  `views/new-conversation/NewConversationForm.tsx:103` latches the default in a `useState`
  initializer, so the field keeps whatever it saw when the modal opened, before the list atoms
  settle. Worth a look (T20-F).
- **U2 swarm-analytics@phone: still on "Loading swarm data…" at shot time.** BEFORE's mobile
  analytics had data within the settle window. A probe shows AFTER loads in about 7 s at phone
  width, so it works, just slower. T20-D moved analytics to the shared `resource` loader.
- **U3 swarm@phone.** The page header is now a small "Swarms" title with a secondary "+ New",
  unlike the big header and primary button on Chats and Buddies. room-runners-arena-lib reads
  "0 workers" (BEFORE mobile said "8 workers · 8 idle") because the counts now come from the
  runtime snapshot. That may be correct, but check it.
- **gallery@desktop.** Card sizing and status-pill styling changed. T20-F does not list either.

## Tool gap (not fixed; the committed tool is unchanged)
`tools/screenshots.mjs` still uses the pre-T20-B selectors: `.search-palette`, `.search-palette-input`,
`.search-palette-empty`, `.mobile-search__input` and `.chat-config-modal`. On AFTER those screens
are silently skipped as "precondition absent". The new ones are `.search-view--palette`,
`.search-view__input`, `.search-view__status`, `.search-view--page .search-view__input` and
`.config-overlay--popover`. The patched copy is `shots/tool/screenshots-t20-selectors.mjs`.

## Cleanup
- Both servers were stopped with SIGINT. Afterwards nothing listens on 7611/7612, and no server.ts
  process has a cwd in shots/ or lane-shots.
- **The `shots/before` worktree is NOT removed.** `git worktree remove` refuses: "working trees
  containing submodules cannot be moved or removed". It still refused after
  `git submodule deinit -f`. The fallback, deleting the directory and then pruning, is a recursive
  delete, which the dcg guard blocks. The owner has to delete
  `/Users/nicholasbardy/git/unleashd-lean-scope/shots/before` and then run
  `git -C /Users/nicholasbardy/git/unleashd worktree prune`.
- `shots/data/` holds about 2 x 1.4 GB of APFS clones plus the fresh records DBs. Delete it when done.
