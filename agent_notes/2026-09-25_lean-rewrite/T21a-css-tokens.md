# T21a: CSS layers 1–2 (tokens and primitives)

Branch `style/tokens-primitives`, in worktree `~/git/unleashd/.claude/worktrees/agent-ad0cb295c3b433992`. It is not merged and not pushed; the orchestrator's WIP backup is `origin/wip/tokens-primitives`. The branch includes a merge of `lean/integration` at 4e5a01c (T11).

## Commits

| SHA | What |
|---|---|
| 45255b9 | Tokens layer. Adds `ui/tokens.css`. 893 declarations whose px value was already on the scale now use the token. Pixel-identical. |
| 260d2ae | WIP checkpoint saved by the orchestrator: scale snap, 700→768 breakpoints, gate skeleton, docs |
| 803ad55 | Merge of `lean/integration` (T11). One conflict, in `mobile.css`: took T11's deletion. |
| 708dc73 | Primitives layer: 358 rules swapped, dead rules deleted, gates G7/G8 |
| 47514ff | `.ui-control` primitive, 8 more swaps, CSS ceiling set to 14,980 |

Verified on the committed tree (`git status` clean):
- `tsc -b` is clean.
- `pnpm test:client`: 138 pass, 0 fail.
- `tools/check-client-invariants.sh`: all 8 gates pass.
- Biome format is clean on the changed files. The only Biome lint findings in those files are older a11y and deps warnings that I did not change.

## Result

| | Before (`lean/integration` 4e5a01c) | After (47514ff) |
|---|---:|---:|
| Non-Buddy CSS lines | 11,729 | **10,875 (−854, −7.3%)** |
| Buddy UI CSS (T11-owned, untouched) | 4,105 | 4,105 |
| All client CSS | 15,834 | 14,980 |
| Distinct px font sizes, non-Buddy | 20 | **0**: every size is one of the 9 `--fs-*` steps. A few `em`/`rem` sizes remain in markdown and error-page rules. |
| Distinct px paddings and gaps, non-Buddy | ~40 | **0**: all use the 11 `--sp-*` steps, plus `--overlay-top` |
| Width breakpoints, non-Buddy | 700 ×5, 768 ×2, 340 | **768 ×7, 340 ×1** |

**The cut is 7%, not "large".** Layers 1 and 2 remove repeated declarations; they do not remove views. The CSS weight lives in three places:
- the duplicated mobile/desktop stylesheets (T20);
- CSS for features that are being deleted or quarantined (swarm is 2.3k non-Buddy lines; palette/usage is 0.8k);
- the Buddy UI (T22).

Those are the steps that reach the 3,750 budget. What this task leaves behind is the base those steps build on: every size is a token, the primitives exist, and two gates stop regrowth.

### Per file (non-Buddy)

| File | Before | After | Δ |
|---|---:|---:|---:|
| components/Chat.css | 1720 | 1524 | −196 |
| components/SwarmDetail.css | 1064 | 979 | −85 |
| mobile/styles/mobile-ui.css | 1392 | 1310 | −82 |
| components/Sidebar.css | 1063 | 996 | −67 |
| components/ColorPalettePicker.css | 575 | 513 | −62 |
| mobile/styles/mobile-swarm.css | 404 | 348 | −56 |
| components/SwarmAnalytics.css | 663 | 612 | −51 |
| components/Gallery.css | 571 | 523 | −48 |
| mobile/styles/mobile-controls.css | 207 | 162 | −45 |
| components/UsagePanel.css | 322 | 286 | −36 |
| mobile/styles/mobile.css | 572 | 545 | −27 |
| components/FolderFilter.css | 182 | 158 | −24 |
| components/SubAgentPanel.css | 287 | 264 | −23 |
| components/SwarmDashboard.css | 166 | 145 | −21 |
| components/PathAutocomplete.css | 189 | 172 | −17 |
| components/InlineSwarmRunWidget.css | 149 | 134 | −15 |
| components/SearchPalette.css | 200 | 186 | −14 |
| components/SwarmConvoPrefix.css | 289 | 275 | −14 |
| components/ConfigDropdown.css | 73 | 61 | −12 |
| components/PromptPalette.css | 121 | 110 | −11 |
| components/FilePreview.css | 115 | 105 | −10 |
| components/AskUserQuestion.css | 88 | 80 | −8 |
| App.css | 183 | 177 | −6 |
| components/ResumeThreadWidget.css | 63 | 58 | −5 |
| components/TurnStatus.css | 83 | 78 | −5 |
| index.css, composer-attachments.css, search-mobile.css | 647 | 641 | −6 |
| ContextBreakdownMeter, fullscreen-composer, chat-activity, controls | 341 | 341 | 0 |
| **new** ui/tokens.css | 0 | 46 | +46 |
| **new** ui/primitives.css | 0 | 46 | +46 |
| **Non-Buddy total** | **11,729** | **10,875** | **−854** |

## Layer 1: `client/src/ui/tokens.css`

`main.tsx` imports it before everything else.

- **Type, 9 steps.** `--fs-1…9` = 10 / 11 / 12 / 13 / 14 / 16 / 18 / 24 / 32 px.
  - 9 steps rather than 8, because both 18px (panel titles) and 32px (mobile page title) are real tiers.
  - 9px micro labels went up to 10px.
- **Spacing, 11 steps.** `--sp-1…11` = 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32 / 40 px.
  - 11 steps rather than 8, because 10px is 65 paddings and 30 gaps, and 20px is 34. Dropping either one moved every list row, so I kept them.
  - `--overlay-top` (80px) covers the two command palettes, which used to sit at 80px and 100px.
- **Breakpoints, 2.** These cannot be `var()` inside `@media`, so gate G7 checks the value set instead. The two values are documented in `tokens.css`:
  - **768px** is the device switch (`useDeviceKind`). The tree is picked once per load, so a narrowed desktop window keeps the desktop tree. Its 700px tweaks now fire at 768px, which is invisible at every screenshot size.
  - **340px** is compact phones (iPad Slide Over is 320px). It hides two secondary columns in mobile search.

## Layer 2: `client/src/ui/primitives.css`

It holds six classes:

| Class | Declarations |
|---|---|
| `.ui-stack` | flex column |
| `.ui-row` | flex, align-items center |
| `.ui-inline-row` | inline-flex, align-items center |
| `.ui-truncate` | single-line ellipsis |
| `.ui-card` | subtle border + `--ui-radius` |
| `.ui-muted` | `--text-muted` |
| `.ui-control` | radius + pointer |

It loads before every view sheet, so any view rule of equal specificity still overrides a primitive.

- **Swaps.** 404 rules dropped the group they re-declared, about 800 declaration lines in total. Their elements gained the class: about 640 `className` string edits in about 45 TS/TSX files. The edits are class names only, with no structural change.
- **Tool rules (scratchpad `t21a/primitives.mjs`).** It skipped four kinds of class:
  - classes named in `client/test`, because the tests assert on `class="…"` markup;
  - classes used in T11 files or outside a string literal;
  - classes used as selectors;
  - classes with a sibling class that sets a moved property at equal specificity. The sibling used to lose to the view rule by load order and would now beat the primitive.
- **Independent check.** `t21a/verify-prims.mjs` re-checks every literal that carries a primitive. The only remaining hits are modifiers or media rules of the same view, which load later and still win (intended).
- **Dead rules deleted.** No TS/TSX file uses any of these:
  - the `.provider-picker*` family and `.opencode` (Chat.css, 99 lines);
  - `.run-stat-value` (SwarmDetail);
  - `.mobile-toggle` and `.mobile-cta--secondary/--small` (mobile-controls).

## Gates (`tools/check-client-invariants.sh`)

- **G7: no literal px** `font-size` / `padding*` / `gap` outside `ui/tokens.css`, and `@media` widths only 768px or 340px. Buddy files carry a per-file `KNOWN_LITERAL` ratchet: 455 literals across 15 files, and a count may only go down. The gate prints a note when a count can be lowered.
- **G8: `CSS_LINE_CEILING=14980`.** Total client CSS must not exceed it. Lower it in the same commit as any cut.
  - I checked that the gate fires: it failed at 15,072 against a 15,071 ceiling during the work.
- Docs updated:
  - `docs/patterns.md#tokens-and-shells` (Here: files and gates);
  - `docs/mobile-ui.md` layers;
  - the AGENTS.md CSS note, which includes the sibling-class cascade trap.

## Compare results

All runs are under `…/agent-ad0cb295c3b433992/output/screenshots/`. Open `<after>/compare.html`.

| Step | Before → after | Result |
|---|---|---|
| 1. Exact tokens | `t21a-base` → `t21a-s1-exact` | 102/106 identical. The 4 diffs are only sigil avatars, which render differently between runs; no CSS is involved. |
| 2. Scale snap (intended) | `t21a-base` → `t21a-s2-snap` | 69/106 over 0% (see below) |
| 3. Primitives | `t21a-prims-before` → `t21a-prims-after` | One real regression, the "+N older folders" chip colour, **fixed**. The rest are loading states and sigils. |
| Final (3 + fix + `.ui-control`) | `t21a-final-before` → `t21a-final-after` | 93/99 identical; the 6 are explained below. The rerun `t21a-final-thread-*` shows the same loading flake on both sides. |

**Step 2 diffs are intended, and small per element, but not small in pixel %.** Some examples:
- `done@phone` changed 26%: mobile cards went from 14px to 12px padding, which is 4px per card and accumulates down the list.
- `new-conversation@desktop` changed 16%, for the same reason.

I compared before and after by eye on `done@phone` and `new-conversation@desktop`. The layouts are the same and the rhythm is a little tighter. The snaps applied were:
- font: 9→10 (16), 15→14 (7), 20→18 (5), 22→24 (3), and 28/36/48 → 24/32/32;
- padding: 14→12 (24), 3→2 (14), 1→2 (13), 5→4 (11), 7→6 (6), 28→24 (5), 18→16 (4), and large paddings → 40.

Ties rounded down. The full remap is in the step-2 commit diff.

**The final 6 non-identical shots are not CSS:**
- `thread`/`channel` shots caught mid-load ("Loading #projects…"): the crate's `/channels/:id/posts` took more than 20s in both halves;
- the usage "5h window" counter, which is relative to wall-clock time;
- sigil avatars;
- one `mention-model` shot missing from the before run.

## How the runs were made (pitfalls for T18's doc)

- **Server.** A throwaway server on port 7591. PATH held only `node`, and `HOME` pointed at the sandbox (`scratchpad/sandbox`, APFS clones from T18).
- **After T11, the server needs the crate.** I built the addon, built `buddies-import` from the `cli` feature, and imported the sandbox's v33 copy into `sandbox/home/.buddies/buddies-v3.sqlite` with `UNLEASHD_BUDDIES_DB` pointed at it. Live `~/.buddies` was never opened.
- **The Buddy runner mutates the copy.** Queued runs fail with `spawn codex ENOENT`, each failure queues a failure-notice run, and new "buddy-run" conversations appear. This showed up as a 14% "drift" in the gallery between two runs.
  - Fix: cancel queued runs in the copy, snapshot it to `sandbox/pristine/`, and have every run start from a fresh `cp -c` clone of that snapshot.
  - Before and after also run back to back from saved `dist` builds (`t21a/pair.sh`).
  - T18's doc should state this. A second baseline taken after the merge (`t21a-base2`) was unusable for the same reason.
- **Cleanup.** The server and Chrome are killed by a `trap`. Chrome is matched by this run's own `TMPDIR` profile path, so other sessions' Chrome processes are left alone.
- **Scripts** (session scratchpad `t21a/`): `shots.sh`, `pair.sh`, `crate.sh`, `tokenize.mjs`, `primitives.mjs`, `verify-prims.mjs`, `rmclasses.mjs`, `absent.mjs`, `lines.mjs`.
- **Pitfall in my own tooling.** postcss `rule.each(cb)` stops iterating when `cb` returns `false`, and a comment node made `n.type === 'decl' && …` return false. The first primitives pass therefore missed sibling properties declared after a comment, which is how the folder-chip regression got through. Fixed with a plain `for…of`.

## For later (not done; owned elsewhere)

- **T11/T22, Buddy CSS.**
  - 455 px literals across 15 files (the G7 ratchet lists them).
  - Breakpoints 900/720/760/640/600 in `BuddiesDashboard.css`, `BuddyConvoHeader.css` and `components/buddies/*`.
  - Running `t21a/tokenize.mjs … snap`, then `primitives.mjs … apply` with the Buddy exclusion removed, would take these files through the same path.
- **Classes skipped because tests assert on markup** (`message-actions`, `chat-activity-toggle`, `mobile-conversation-item` and about 20 more). Loosening those regexes to `class="[^"]*\bX\b` would let the next pass swap them.
- **`var(--font-xs)`** is referenced once and never defined (css-tokens ratchet). Replace it with `--fs-1`.
- **T20.** The mobile stylesheets (`mobile-ui.css` 1,310, `mobile.css` 545) and their desktop twins are the next big cut. Views should adopt the primitives as they merge.
