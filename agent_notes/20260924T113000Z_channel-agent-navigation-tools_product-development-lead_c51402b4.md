# Channel navigation tools for agents: short mention context, search, threads, keyset paging

2026-09-24 · Product Development Lead · branch `feat/channels-project-view-2026-09-22`

## Owner ask

An @mention launch should carry the ~10 most recent messages with threads NOT
expanded; agents should be able to "search Slack" by keyword and "expand
thread" on any hit; then mentions in search and pagination.

## What shipped

| Commit | Change |
|---|---|
| `4b9c09c` | Mention context = 10 latest posts, threads collapsed to `[thread: N replies, latest …]`, post ids on every line (`channel-text.ts`). `search_posts` (keyword, all terms, replies included) and `get_thread({postId})` (any post, root or reply). |
| `0f95fdc` | `search_posts({mentions: "me" \| buddyId})`, with or without keywords. Keyset paging: `get_list` `before/after/around`, `get_thread` pages and centres on a reply (`channel-pages.ts`). Mention prompt reads a thread's real latest replies. |
| `66db722` | `get_list` reduced to one keyset read path; offset `cursor` and `threadId` deleted (net −44 lines). |

Package (`~/git/.codex-worktrees/buddies/channel-agent-tools-20260924`, no git
remote; shipped via the vendored tarball whose provenance names the commit):
`c844ac2` `searchPosts`, `c4dfcdc` mentions filter + `pagePosts`.

## Decisions and why

- **Short prompt, pull the rest.** Expanding side threads inline buried the
  recent flow; the Buddy fetches depth with tools only when the reply needs it.
- **Keyset, not offsets.** A post arriving between two reads shifts an offset
  page (repeat/skip). `pagePosts` pages by `(created_at, id)` from an anchor post.
- **`listThread` cannot answer "last 10".** It returns the OLDEST replies up to
  its 200 cap; the mention prompt and `get_thread` use `pagePosts` instead.
- **Mentions match the composer link** `](buddy:<id>)`, not the name in prose.
- **All reads are workspace-scoped and move no read mark**, except the plain
  `get_list` latest page, which still marks the list read.

## Verification

- Package: 126 tests. Server: full suite green on the committed snapshot
  (`git checkout-index` + symlinked node_modules); 5 provider/Builder failures
  there were the snapshot's empty `vendor/agent-cli-tool` and pass in the tree.
- End-to-end test `server/test/channel-conversations.test.ts`: launch context,
  search → centred thread → channel `around` → page back, `mentions: "me"`.
- Live, after the backend reloaded: `search_posts` (keyword and mentions) and
  `get_thread` on a real `#buddies-dev` reply returned correct pages and anchors.

## Gotchas recorded

- A new Buddy tool shows up in-session before it works: the per-turn MCP process
  is fresh, but the foreground run policy comes from the long-lived backend,
  which defers reloads while turns run. "Operation is outside the run policy"
  until it restarts — compare the `tsx src/server.ts` start time to the commit.
- Concurrent sessions edited `channel-responder.ts` and the channel test at the
  same time; commits staged only this work's hunks (`git apply --cached`) and
  verified the index snapshot, not the dirty tree.

## Open

- An empty `before` page returns `newer: null` although the anchor is newer;
  harmless (the caller holds the anchor), noted rather than special-cased.
