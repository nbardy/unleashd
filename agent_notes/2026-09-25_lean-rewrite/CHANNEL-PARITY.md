# CHANNEL-PARITY: the last PORT-3 channel gaps (2026-09-26)

Worktree `.claude/worktrees/lane-parity`, branch `feat/channel-parity`: 0def15d + 3 commits. Not pushed or merged.

| Gap | Commit | What |
|---|---|---|
| 1. Mobile Channels Home | **e8adfae** | Home > Buddies has "New Buddy" (`useNewBuddy`) and a "Creating buddy" row with an archive ×. The phone post heading gets the conversation eye. `ConversationEye` moved to `components/buddies/ConversationEye.tsx`, where mobile may import it. It reads `listField('idSet')` itself, so the desktop and phone availability checks are the same code. No new CSS. Test: `mobile-channels.test.tsx`. |
| 2. DMs on `/chat` | **9284826** | **Option A.** `ChannelDm` already joins the generations and owns New chat and the retry, so porting the joined view (dm-chain atoms, App poller, `dm_divider`, redirect) would build a second copy of the same UI. `DmChannelsNotice` appears on the desktop Chat page and the mobile ConversationView. It says "This DM lives in Channels" (or "An earlier chat in this DM"), links "Open in Channels" to the latest generation, and offers New chat, which opens there. It renders only when `/direct/chain` lists the id, so seat and Wake chats get nothing. Sidebar: `startNewDirectChat` marks the earlier generations done, which removes them from the sidebar. They stay live, so the DM still shows them above its divider and a link still opens them. Test: `channel-dm.test.tsx`, which renders through `ChatRoute`. |
| 3. Buddy wait limit | **ba9f1c0** | A bug, not a product decision: agent-cli already chose 12 h "to match a long Buddy turn", and this watchdog cancelled it. `turns/background-wait.ts` is a per-harness table. Claude declares the wait its spawn gets (server env, else the harness envDefaults). A tool call with `run_in_background: true` calls `TurnWatchdog.allowBackgroundWait`, which widens only the provider-idle budget, to the wait plus 60 min. The bridge and max-runtime clocks are unchanged, so the `TURN_MAX_RUNTIME_MS` rules hold. The runtime test was mutation-checked: a plain silent turn still stalls, a background wait survives, and a turn hung past the wait still stalls. |

CSS: +10 lines, offset by merging Chat.css send/save/upload disabled+hover rules and Sidebar provider/model `.selected`. G8 went from 14831 to 14829, and the ceiling was lowered to match.

Checks on the clean committed tree (`git status --porcelain` empty), full `pnpm test` exit 0:
- server 195 pass (the one pre-existing todo)
- client 167
- dev-supervisor 14
- tools 5
- cli 274
- package and api green
- invariants 8/8

Open (no change made):
- The Claude parser drops `task_*` events, so the widened budget never narrows when agents finish early. Fixing that needs a submodule commit and push.
- `isSubagentSpawnTool` recognises only `Task`, not Claude Code 2.1's `Agent`, so Claude background agents do not show as sub-agents.
- Earlier DM generations created before 9284826 stay in the sidebar until the next New chat or a manual Done.
- No screenshots were taken.
