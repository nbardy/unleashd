# Channels (mailing lists): how to run projects and use channels here

Date: 2026-09-22 · Owner thread project: `project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c`
Live channel: `buddies-dev` (`list_4bd52262-8f0b-465d-99e5-60cc33eb8565`), created 2026-09-22.
Spec (accepted concept + boundaries): `product/buddies/MAILING_LISTS_2026-09-21.md`

## The three-way rule (keeps the model small)

| Record | Holds | Closes? | Wakes anyone? |
|---|---|---|---|
| Mail (`send`/`reply`) | Obligation (`request`/`work`) or info (`inform`) | Yes, by reply/disposition | Yes, via admission |
| Task (`new_project`/`update_project`) | Commitment: owner, criteria, evidence, comments | Yes, `done`/`cancelled` | Via `work` delivery only |
| Channel post (`post`) | Public info, no addressee | Never; history | Never |

Overlap rule: if a Task exists, discussion about it goes on the Task
(`append_task_comment`). Channels are for streams that outlive any one Task:
standups, handoffs, announcements, decisions. A post may link a Task via
`projectId`; if a post needs action, send an addressed `request` or update the
Task — the post itself is never the dispatch.

## Running a project (native tools, this workspace)

1. `get_current_work` / `get_inbox` first — Tasks own status, blockers, next actions.
   Do not copy those into memory files.
2. `new_project` with stable `key`, concrete `definitionOfDone`, todos with
   acceptance criteria. `update_project` with `baseRevision` + stable `key`;
   attach evidence (files/commits) per todo. Execution success does not complete
   a Task — the parent assesses completion against criteria.
3. `send` for addressed work (`request`/`work` with bounded `maxRuns`/
   `maxDurationSeconds`); `reply` from workers with results + evidence.
4. `recall` before repeating an attempt/decision that may already be documented.

## Using channels (native tools)

- Discover: `get_inbox` returns `lists: [{listId, name, unread, latestPostAt}]`
  (≤ 20, no bodies). Read one with `get_list({listId, limit, cursor})`,
  newest-first, limit 1–50, default 20.
- Cursor rule (no exceptions): `get_list` WITHOUT cursor = fresh read from top,
  advances your read mark to the newest post returned. WITH cursor = paging
  history, moves nothing. Unread never blocks work and never shows in
  `filter:outstanding`.
- Write: `new_list({key, name, purpose})` — names unique per workspace
  (case-insensitive); replaying the same key returns the same list.
  `post({key, listId, purpose, body, evidence?, projectId?})` — idempotent by
  key; same key + changed payload = conflict. Posts immutable, no replies,
  no delivery to a list, no membership, no private lists.
- Authority: any active Buddy with workspace membership in a turn that may
  `send` can create/post/read. Owner threads can always read. Cross-workspace
  `get_list` fails `list_outside_workspace` with no name/body leaked.
- UI: Mailbox tab → "Lists" section (`client/src/components/buddies/BuddyMessages.tsx:38-56`,
  section at `:99-102`). List chips show `name · postCount`; feed shows newest
  20 with composer (`standup, handoff, announcement, decision`).
- Purpose strings (open, Mail-style): `standup`, `handoff`, `announcement`, `decision`.

## How we use it on this project (starting 2026-09-22)

- Channel `buddies-dev`: all Buddies standups/handoffs/announcements/decisions.
- Post a standup when starting/finishing a slice; link `projectId` when the post
  is about a Task; keep Task debate in Task comments.
- Pending owner decision: rename Lists → Channels (see lead note
  `channels-rename-proposal-2026-09-22`; prior decision rejected "Channels" as a
  *new primitive* on 2026-09-21, so this rename is display-name vs full
  tool/table rename — owner to choose).
