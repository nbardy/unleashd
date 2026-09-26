# CSS-TOKENS: channel CSS onto tokens + primitives

Branch `refactor/channel-css-tokens` (worktree `.claude/worktrees/lane-css-tokens`), base fc5b976. Commit **1fb3dc6**. Not pushed or merged.

Checks were run on the clean committed tree (`git status --porcelain` empty, so they check the commit): `pnpm typecheck` 0, `pnpm test:client` 167/167, `bash tools/check-client-invariants.sh` G1–G8 all pass.

## Scope

`rg -l channel client/src --glob '*.css'` lists 9 sheets. Only the five in G7's `KNOWN_LITERAL` still had literals: Sidebar.css, mobile.css, BuddyWorkspaceActivity.css, ColorPalettePicker.css and chat-activity.css were already at 0, and BuddiesDashboard.css was done in S6.

| File | Literals before → after | Lines before → after |
|---|---:|---:|
| components/buddies/ChannelBrowser.css | 106 → 0 | 971 → 938 |
| components/buddies/ChannelComposer.css | 43 → 0 | 429 → 403 |
| components/buddies/ChannelContent.css | 23 → 0 | 379 → 375 |
| components/buddies/ChannelLoader.css | 11 → 0 | 121 → 117 |
| mobile/styles/mobile-channels.css | 49 → 0 | 578 → 549 |
| ui/tokens.css | – | 46 → 47 (+ `--fs-post`) |
| **Total** | **232 → 0** | **2,524 → 2,429 (−95)** |

Client CSS total went from 14,799 to 14,704 lines. The G8 ceiling is lowered to 14,704, with a note.

TSX touched to add primitive classes: BuddyRailRow, ChannelBrowser, ChannelComposer, ChannelDm (frame class table), ChannelLoader, ChannelMarkdown, HarnessPicker, mobile/channels/ChannelsMobile. Four client tests (channel-browser, channel-dm, channel-markdown, mobile-channels) matched exact class strings; their regexes now accept extra classes (`cls[^"]*"`).

## Gates

- **G7:** the `KNOWN_LITERAL` table and its ratchet notes are deleted. Every stylesheet except tokens.css must now have 0 literals.
- **G8:** 14799 → 14704.

## Breakpoints

No change was needed. The 760/640/600px `@media` rules were already gone at base fc5b976: every `@media` in client/src is 768px, 340px or prefers-*. The remaining `640px`/`600px` hits are `max-width`/`min-width` on elements, not breakpoints.

## Tokens: where a pixel value changed

Rule: nearest token, and a tie rounds up. One token was added: `--fs-post: 15px`, the channel reading size (desktop post body, mobile markdown and author names, thread titles). 15px was used 6 times, and it is the only step that 14.5px and 15px could share.

57 values moved. Everything else mapped exactly.

| Change | Count | Where (examples) |
|---|---:|---|
| font 12.5 → 13 | 9 | meta rows, composer chips |
| font 13.5 → 14 | 4 | markdown tables, task-card title, picker buttons |
| font 14.5 → 15 (`--fs-post`) | 3 | desktop `.channel-markdown`, composer textarea |
| font 11.5 → 12 | 3 | composer hints / small labels |
| font 17 → 18 | 2 | browser h1, mobile channel header h1 |
| font 28 → 32 | 1 | mobile header back chevron (sits in a fixed 44×44 box, so there is no layout shift) |
| padding 14 → 16 | 8 | horizontal row/header padding (e.g. `10px 14px`, and the 768px block's 14px sides) |
| padding 3 → 4 | 9 | pill/chip vertical padding |
| padding 18 → 20 | 3 | browser header, loader |
| padding/gap 1 → 2 | 5 | badges, list gaps |
| 5 → 6, 7 → 8, 9 → 10, 11 → 12, 22 → 24 | 8 | small paddings/gaps; markdown list indent 22 → 24 |

Two values are kept exact, because they are alignment offsets to the post text column and not spacing steps. Snapping them would misalign continuation posts:
- `.channel-thread-replying` left 64px → `calc(var(--sp-10) * 2)`
- `.mobile-channel-post--continuation` left 60px → `calc(var(--sp-11) + var(--sp-8))`

## Primitives

48 single-class rules contained a whole primitive group. Those declarations were removed and the class was added to each element in TSX: 57 swaps on 48 classes: ui-muted 26, ui-row 10, ui-stack 9, ui-truncate 7, ui-inline-row 5 (some rules got two). One exception: `.channel-loader` got only ui-stack, not ui-row, because it is a column.

Sibling-class check (AGENTS.md: a sibling class that used to lose by load order now beats the primitive):
- `channel-composer-picker-icon`: no color, so no conflict.
- `mobile-channels-row--add`: sets only color, and the row's ui-row group has none.
- `channel-history`: no bare rule.

Rules with compound or attribute selectors were left alone, for example `[data-unread="read"]` muted overrides.

## Screenshots: not run

No compatible server was reachable.
- The owner's backend (port 7499, started 03:10 from the main checkout) is a different lineage from this branch. `/api/buddies/overview` returns `{generatedAt, employees}`, and this branch's `tools/screenshots.mjs` expects a workspace array, so discovery fails (`overview.filter is not a function`).
- I served this worktree's client briefly with vite on port 7591 against that backend, then stopped it. I did not start or restart any backend.
- A real before/after needs a throwaway backend from this branch on cloned data (AGENTS.md recipe). The baseline commit for `--baseline` is fc5b976, and the change is 1fb3dc6.
- What to look at: every change above is at most 2px except the 64/60px offsets (unchanged) and the 28→32 back glyph. Expect small text-reflow diffs on channel/thread at both sizes, from 12.5→13 and 14.5→15.
