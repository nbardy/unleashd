# S6: Buddy CSS onto T21a tokens + primitives

Branch `style/buddy-css-tokens` (worktree `.claude/worktrees/lane-buddy-css`), base b484aaa. Not pushed or merged. Commits: 80753f7 (screenshot tool fix), 09d5434 (exact tokens), cf095ee (snap + 768px breakpoints + G7), 512fb84 (primitives), 148e750 (dead rules + G8 14855).
Checks run on the clean committed tree (`git status` empty): typecheck 0, test:client 152/0, test:tools 5/0, invariants G1–G8 pass, vite build 0.

| File | Before | After |
|---|---:|---:|
| components/BuddiesDashboard.css | 568 | 537 |
| components/BuddyConvoHeader.css | 80 | 67 |
| buddies/BuddyBackgroundTasks.css | 95 | 94 |
| buddies/BuddyBuilderResultCard.css | 123 | 119 |
| buddies/BuddyDetail.css | 356 | 348 |
| buddies/BuddySettings.css / BuddySoulConflict.css | 33 / 50 | 33 / 50 |
| buddies/BuddyWorkerThreadBadge.css | 19 | 15 |
| buddies/BuddyWorkspaceActivity.css | 253 | 230 |
| mobile/styles/mobile-buddy.css | 162 | 140 |
| **Buddy total** | **1,739** | **1,633 (−106)** |

- **G7:** the 10 Buddy files had 215 literals and now have 0, so their KNOWN_LITERAL entries are gone. The 720px and 900px breakpoints are folded into one 768px block; the sheets are desktop-only, so this changes only desktop windows between 720 and 900px wide. The 760/640/600px breakpoints and about 230 literals live in Channel*.css and mobile-channels.css, which were left untouched as instructed (ChannelBrowser.css is 106, under its ratchet of 107).
- **G8:** the ceiling drops from 14,961 to 14,855.
- **Screenshots** (Buddy screens + channels, 4 sizes = 40 shots; `output/screenshots/s6-*`): noise 0/40; exact 0/40; snap 34/40 (intended: e.g. 18→16 padding, 36→32 title, 54/64→40 empty-state padding; largest workspace-activity@phone 19.5%, channels 0); primitives 0/40; dead rules 0/40.
- **The cut is small (−6%)** because most Buddy CSS is real layout. Primitives swapped 37 rules (76 declarations). The only dead class was `.mobile-buddy-section`.
- **Tool fix, needed for any run:** `tools/screenshots.mjs` still waited for the v2 `init` and failed against the v3 `hello`/`rows` wire ("No init in 30s"). It now reads `hello`/`rows`.
- **Server:** port 7597, PATH held only node. HOME was a sandbox holding APFS clones of ~/.claude/projects and .cursor/.gemini. Data dir: t15-dryrun agent-viewer (its session-cache symlink to LIVE was replaced by a clone). BUDDIES_HOME: a clone of `db/buddies-v4.sqlite`, with 19 queued runs cancelled and 1 overdue schedule pushed out 30 days. Each run starts from a fresh clone of the pristine copy. Live data was never written. The dcg guard blocks `rm -rf`, so old run dirs were moved aside rather than deleted, and they remain in scratchpad `s6/run-*`.
- **Scripts** (session scratchpad `s6/`): shots.sh, tokenize.mjs, primitives.mjs, absent.mjs, each with the channel exclusion.
