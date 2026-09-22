# Thread closeout — channels on mail, archivable, unified surface

Date: 2026-09-22 · Owner thread project: `project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c`
Live channel: `buddies-dev` (`list_4bd52262-8f0b-465d-99e5-60cc33eb8565`)
Guide: `agent_notes/buddies/20260922_channels-run-projects-and-use-channels.md`

## Owner proposal recorded (not accepted)
1. Rename mailing lists → channels, for sure.
2. Make channels archivable.
3. Channels built on top of mail — one unified MCP surface to send to users or channels and read new messages.

Decision note: `2026-09-22T05:55:30.018Z:150f2788-8c0c-43ba-876a-76e052cfc60b` (proposal, pending scope).
Prior: `2026-09-22T05:51:20.930Z:9cddc818` — 2026-09-21 accepted decision chose "mailing lists" and rejected Channels as a new primitive; rename is display-label vs full tool/table/route migration. Owner 2026-09-21 scope freeze: minimal extension to Mail.

## Incomplete / impartial work (authoritative state stays in Tasks)
- `6efaffd1` Deliver lean Buddy repairs (in_progress): todos open `Implement and verify justified API/runtime improvements`, `Record delivery evidence and remaining limitations`. Next: Release removes extra project-evidence validator per Lead packaged acceptance; then complete `f5e8e43a`, close ancestors `9864f34e`, `37f2780f`.
- `40cf0d8d` Correct inform delivery to background-disabled recipients (in_progress): todo in_progress `Apply smallest correctness fix or qualify as growth needing owner review`, open `Record delivery evidence and revisiting conditions`. Triage done; no implementation yet.
- `d157d274` Rename mailing lists to channels (backlog): 4 open — rename scope pick, implement + successor entry, archivable semantics, unified MCP shape.
- Blocked, preserved as-is: `9ef2b573` Wave_sim CEO route (no authorized dispatch route); `95592e35` saved-grant revocation awaits owner approval `message_66ec2c6a`; `ee12e5dd` mailing-lists blocked on `pnpm test:package` behind foreign dev-supervisor PID 6688.
- Deferred backlog (owner lean scope 2026-09-16): `b55e2554`, `de5267b7`, `cdae619b`, `4f875aff`, `556cc4a6`, `814f77fd`.

## Insights recorded
- Three-way rule stands until owner changes it: Mail (`send`/`reply`) carries obligation/info and wakes via admission; Task (`new_project`/`update_project`) carries commitment; Channel `post` is public info, never closes, never wakes. If a Task exists, discussion goes in Task comments; posts may link `projectId`.
- Delivery-admission lesson (2026-09-21, still open via `40cf0d8d`): capability advertised `send` for a background-disabled recipient, then per-delivery admission refused it. Fix must make `get_capabilities` agree with admission or land inform as queued/unread with no run; `inReplyTo` inform failure needs structured code/reason/remedy.
- Omitted-evidence diagnosis (Release, 2026-09-22): rev 5→6 wipe on `95592e35` was explicit `evidence:[]`, not omission; restored rev 7. Location cited: package store layer.
- Cursor rule for channels: `get_list` without cursor = fresh read, advances read mark; with cursor = history paging, moves nothing. Unread never blocks work.
- Reusable provider lesson (2026-09-21): model/reasoning values are opaque catalog-validated IDs, not provider-prefixed names; smallest existing catalog primitive wins.

## Communicated this closeout
- Channel post to `buddies-dev` (handoff): this file + open Task IDs.
- Task comments on `6efaffd1`, `40cf0d8d`, `d157d274` pointing here.
- No code changes in this turn; no new surface; no owner approval consumed.
