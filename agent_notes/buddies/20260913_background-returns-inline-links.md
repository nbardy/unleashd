# Background returns and inline worker links — 2026-09-13

Owner-accepted direction in conversation `89d40447-9d68-4b53-9688-67c154dbfae2`:
“When a given thread kicks off work in other threads,” a reply or timeout should
wake that Buddy in a separate background thread; launch tool calls should show a
small clickable badge opening the worker thread. This succeeds the previous
mailbox-only behavior for new human-chat launches. It is not permission to inject
automatic turns into human chat or to widen employee access.

## Choice and rationale

Register a host-derived background return conversation ID in the existing
message `return_policy`. Preserve `parent_conversation_id` as the original human
thread. Existing reply/failure/inform routing, queued runs, admission, creation,
provider execution and cancellation consume the route. The executor serializes
returns even while creation awaits, then reuses that background conversation.
No new tables, scheduler, supervisor or Worker identity are introduced.

The review gets the original assignment, its evidence and returned report; a
failure notice also includes its latest saved checkpoint when available. It uses
the existing workspace/project memory audience. Full private human-provider
context is not forked into a background audience. That is an implementation
choice to preserve the established privacy boundary, not a claim that complete
launch-transcript inheritance has been implemented.

The host issues a typed `buddyWorkerThread` receipt for successful dispatch.
Live tool results and persisted provider outputs normalize it into a compact
badge on desktop and mobile. The link uses the existing client conversation IDs;
unavailable/deleted threads have no anchor. Project creation alone does not
claim a worker was launched. Multiple launches can show multiple badges in the
same collapsed tool group.

## Verification

- Package suite: 100 passed.
- Buddy/runtime/transcript server suite: 166 passed, 3 optional live cases skipped.
- Final targeted server rerun after serialization/hydration changes: 9 passed.
- Client suite: 89 passed, including live-shaped and persisted Codex receipts,
  collapsed desktop/mobile rendering and unavailable-thread links.
- Server/client typechecks, client production build and six client invariants passed.
- New integration coverage proves a completion return starts a separate background
  runtime and leaves human messages/queue untouched. The timeout fixture supplies
  the executor's terminal timeout classification at the store boundary, restarts
  the store, and verifies one review per return, checkpoint inclusion, simultaneous
  returns serializing/reusing one thread, incoming-work holds and stopped roots.
  Existing runtime tests separately verify actual deadline classification/drain.
- The hydration test initially exposed a discarded tool output; the Codex cheap
  line filter now retains the typed receipt and the test passes.

These are deterministic integration/render checks, not live model judgment or
browser proof. No live Wave Sim assignment was sent and no backend restart was
forced. New host routing requires the backend to load these changes. Older
messages retain their prior route; this change does not replay mailbox history.
Incoming work must remain enabled for background reviews. Budgets still bound
review and continuation; a timeout never grants unlimited fresh work.

## Historical evidence

The adjacent `20260913_background-returns-inline-links.evidence.json` records
SHA-256 hashes of the uncommitted implementation/test files and preserved route
excerpts. Package source is the isolated worktree
`/Users/nicholasbardy/git/.codex-worktrees/buddies/thread-returns-20260913`, based on
`03638bdbcf778a63de22b227aa76099b0f1c8761`. Its runtime change is 9 insertions and
7 deletions, plus the authority type declaration. The archive and its provenance
are installed locally as a non-release snapshot. Existing app edits were retained;
no whole-checkout diff is attributed to this change. The earlier isolated Worker
redo was not merged as part of this work. No commit or push was performed.

Revisit if a real provider return cannot make a useful decision from the scoped
assignment/report/checkpoint, or if a concrete legacy-work migration is requested.
Preserve the human/background and audience boundaries while fixing that evidence.
