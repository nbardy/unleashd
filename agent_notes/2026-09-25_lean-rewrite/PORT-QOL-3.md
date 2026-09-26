# PORT-QOL-3: snapshot 493c1c7 onto lean/integration (2026-09-26)

Worktree `.claude/worktrees/lane-port3`, branch `port/qol-3` (d2c072b + 12 commits, plus a merge of lean/integration a7156fe as e2b7827). Not pushed or merged.

| Group (snapshot files) | Result | Where / why |
|---|---|---|
| vendor/agent-cli-tool 85ba151 → efe0503 | ported **8f23f4c** | efe0503 is pushed (origin/test/claude-bg-ceiling-2026-09-26) and contains 85ba151 rebased, plus the 12 h `claude -p` background wait. Submodule tests 274/274. |
| agent_notes (16 files) + launch-2.0 FOOTAGE.md | copied **1f96044** | As-is. The ceiling note says the 60-min provider-idle watchdog still kills a silent Claude wait: **owner call**. |
| runtime.ts: early turn.complete dropped answer; JSON error envelope | ported **a6a0176** | Now in `turns/runner.ts`: a `sealed` flag is set only by stop and timeout, and the terminal failure is the provider's unwrapped message. 2 tests, both mutation-checked. |
| channel-reply-gate: Cursor `--trust` | ported **eb82b66** | Same one-line change. |
| config-service: stale creation fingerprint after a seat config change | ported **05af87e** | The Rust records store keeps `creation` write-once, so the replay check also accepts the creation hashed at the current config. Mutation-checked. |
| Mention chip shows the thread seat (shared schema, routes, server.ts, channel-text, composer) | ported **70f87b3** | `seats` is on the thread read (channels.ts `threadSeats`). MentionChoice gains a `seat` variant. Desktop and phone. |
| channel-responder: the reply is the Buddy's own `post`, silence becomes a notice | ported **37b005f** | New prompt; the server no longer pastes the final text. The `followUpSubject` re-pick is **covered**: `considerThreadPost` (newest only), deferral and `settle`/`contextReadAt`. |
| New Buddy "+", Creating buddy rail row, ConversationEye | ported **e9e3426** | Desktop rail and hover toolbar. **Not ported:** the mobile Home New Buddy, the Creating row and the eye on phone rows (snapshot ChannelsMobile BuddySection). |
| ChannelTaskOverlay (Task chip/card click stays in Channels) | ported **e7fed06** | A native modal wrapping the T22 `BuddyTaskPanel` (the old `/projects/:id/execution` API is gone), plus "Open in Work". |
| DM chain / New chat + harness retry (buddy-direct, channel-routes, out-of-tokens.ts) | ported **1216168** (server) | `directChain`/`newDirect` and `retryReply`; shared `isHarnessRetryFailure`. The trigger comes from the notice's `replyToId` and the failed harness from its seat, so no evidence stamps. |
| ChannelDm*, channel-dm, HarnessRetry, DmNewChat*, mobile `?dm=`, Chat.tsx retry | ported **e7017e8** (client) | One ChannelDm for desktop pane and phone screen. New chat and the retries use one HarnessPicker that reuses the chip popover CSS. `useChatPageDm` is deleted. |
| dm-chain atoms + App poller, `dm_divider` in chat groups, Chat.tsx stitched DM / prior→current redirect, sidebar hiding prior DMs | **needs owner** | DMs now render in Channels, where the chain is a per-Buddy resource. The `/chat` page shows one generation, and earlier generations still appear as Buddy chats in the sidebar. |
| DmHarness picker on an empty new chat | covered | The New chat popover picks the harness before the chat is created. |
| CHANNEL_CONVERSATIONS doc | ported | Updated in 70f87b3, 37b005f and e7017e8. |

CSS: +36 lines, paid by merging identical rules (mobile-ui focus/disabled/attach, `.status-dot`) and deleting the dead `.mobile-chat__action-error`. G8 goes 14838 → 14831.

Checks on the clean committed tree (`git status --porcelain` empty), full `pnpm test` exit 0:
- server 194 pass (one pre-existing todo)
- client 165
- dev-supervisor 14
- tools 5
- cli 274
- package and api green
- invariants 8/8

No screenshots were taken. Pre-existing lint issues left alone: channel-reply-gate `noVoidTypeReturn` and Chat.tsx `useSemanticElements`.
