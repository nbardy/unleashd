# Delete during Buddy creation: admission repair — 2026-09-12

Successor to provisional A4 in `AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md`,
preserved at baseline `4c6835b53190a64650c8948ac67f7fd6badbf1ed`.
The original diagnostic used controlled runtime ports; the unresolved question was
whether production deletion/stop handling already prevented provider work.

New evidence reproduces the defect through the real WebSocket delete handler,
conversation config store/service, Buddy integration, conversation runtime and run
executor. Only the provider and socket transport are fixtures. Deletion runs after
the link write but before readiness returns. The durable tombstone is present,
the registry entry is gone and stop has run, yet the previous code admits one
provider turn. A second case removes the runtime after readiness resolves and
also admits one turn. The unchanged positive case completes one turn.

Decision-maker: Buddies Development Lead, implementation choice within the
owner's September 12 authorization to continue repairs and leave commits.
Keep the shared creation service and existing run authority. Re-read the durable
record after asynchronous linking and verify the exact registered runtime before
accepting readiness. The executor rechecks registry identity synchronously with
claim start and dispatch after its readiness await. No new lifecycle, lock,
deadline or session identity is introduced.

Why: stop on an inert conversation does not permanently invalidate a retained
runtime object. A successful link write does not prove that the conversation
still exists. Checking only at creation entry misses deletion across the await;
checking only in readiness misses removal before the awaiting caller resumes.
Revisit if conversation replacement becomes an intentional admission handoff;
it currently requires a fresh explicit readiness pass.

Validation: both negative cases failed before and pass after with zero provider
turns, while normal creation still completes once. The original creation command,
conversation identity and deadline remain intact. The 16-case creation, retry,
background-runtime and WebSocket contract set passes. Two older socket fixtures
now report the active records they pretend to persist instead of returning null
for every record lookup. Full server suite: 343 cases, 340 pass, 3 skip, 0 fail.
Shared build and server TypeScript check pass. These are isolated fixture results,
not a live-provider/deployment claim.

Test isolation correction: a shared dependency/build symlink initially picked up
a concurrent app/package contract-version mismatch. Dependencies for the Buddies
archive and shared build were frozen to the labeled snapshot in the isolated
checkout; checks above use that consistent snapshot. No shared build was reverted.

Delivery follows the A2 isolation note: the repair commit is separate from the
baseline on `codex/buddy-readiness-repair-20260912`; transfer only changed paths
whose shared bytes still match their baseline. Native work records own status.
