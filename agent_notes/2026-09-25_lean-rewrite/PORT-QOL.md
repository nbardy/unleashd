# PORT-QOL: concurrent QoL fixes onto lean/integration (2026-09-26)

Worktree `.claude/worktrees/lane-port`, branch `port/concurrent-qol` (b3cd090 + 3 commits). Not pushed, not merged.

| Source | Result | Where / why |
|---|---|---|
| a2e4135 mobile channels: header gap, fullscreen composer, model sheet | ported **14c8517** | `ChannelComposerMobile` wraps the T22 `ChannelComposer` (channelId/rootId) in FullscreenComposer. Also the header safe-area fix, blur and bottom sheet for the touch model picker. The CSS now uses --sp/--fs tokens (G7). The +CSS is offset by merging the identical temp/done/worker rules in Gallery.css: G8 ceiling goes 14975 → 14961 and the mobile-channels literal ratchet 53 → 49. Render test in `client/test/mobile-channels.test.tsx`. The channel and thread composers sit in FullscreenComposer, with a Done head that names the channel. |
| 92e8692 silent reply gate → "Couldn't reply" | ported **84b17d5** | `channel-reply-gate.ts` is unchanged in integration: '' is now `failed: no answer`, and an `out_of_tokens` message is kept. The old test file was deleted, so the test moved to `server/test/buddies-v2.test.ts`, which stubs only the CLI process. Mutation-checked: without the fix, 1 test fails. The submodule goes b9c819f → **85ba151**. 85ba151 exists only on the main checkout's local submodule branch `fix/claude-session-limit-is-error` and is **not pushed**. Push it inside vendor/agent-cli-tool before this pointer lands. |
| 6535b62 notes: claude -p background-agent ceiling | ported **76a0512** | File copied as-is. |
| d4a8337 seat keeps session while access grows | covered | Same `git patch-id` as efc6f17, which is already in integration. The T11 code also drops the grown-access hash: `turn-policy.ts admitAudience` keys on `docScopeFor(context)`, which is the seat's fixed scope. Filing a Task or getting a read grant no longer rotates the session. The fresh/resumed wording is still chosen at admission (`runtime.ts sendSessionRelativeMessage`). |
| 1bb4ef4 fifo-run-capacity | covered | `git log --no-merges b3cd090..1bb4ef4` is empty. The merge has no remerge-diff edits. |
| 204da80 execution-selection | covered (7f7537a) | No unreached commits. The merge resolution only picked sides in old channel client code that T22 rewrote. One divergence, flagged but not changed: the resolution made the BuddyMessages composer the owner's own (D3), but integration's 4e5a01c deliberately restored "Post as Buddy" under the owner's no-feature-removal rule. Owner call. |
| 364003a queued-at-run-limit | covered | No unreached commits. The resolution only deleted leftovers of the old channel client (Replying, authorName, ChannelResponse). |
| 37c9f7e channels-project-view | covered | No unreached commits and no resolution edits. |

Checks on the clean committed tree (`git status --porcelain` empty): typecheck pass, test:server 254/254, test:client 145/145, invariants 8/8, vite build pass. Both crates rebuilt with the throttled shared target.
