# Readiness receipt privacy repair — 2026-09-12

Successor to A2 in `AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md` and the readiness
review. Historical source: isolated baseline commit
`4c6835b53190a64650c8948ac67f7fd6badbf1ed`, including the unchanged audited
`server/src/buddies/team-readiness.ts`. That baseline preserves existing concurrent
work; it is not new work authored by this repair.

Question: may a Buddy's unrelated team turn inspect a participant-private
execution merely because the persistent identity participated in its message?
Choice: no. The owner authorized continued development and commits on September 12;
the Development Lead selected this implementation within the existing audience
design. This is an implementation decision, not a new grant or architecture change.

`get_capabilities` now receives the existing message-audience predicate from
`BuddyOperationsService`. It filters messages before deriving target identities,
receipts, admission checks, run-policy blockers and return paths. The existing
participant and selected-workspace checks still apply. A rejected message produces
one generic `message_scope` blocker. The requested workspace cannot replace the
trusted conversation audience used by the predicate.

This reuses the policy already used by `get_message`, inbox and run projections.
Redacting only `execution.error` would leave other private fields and derived
blockers exposed. Reimplementing the audience policy locally would invite drift.
Owner access, project publication and the current request-root exception remain.
Revisit if readiness needs a new explicitly authorized disclosure audience.

Evidence: four native MCP tests with a real in-memory Buddies store. Before the
repair, the three team-audience cases failed and the owner case passed. After the
repair, all four pass, including mixed readable/private requests and inspection
under a live claimed request. The combined privacy, team access, resource
consistency and owner-authority set passed 14/14; server TypeScript check passed.
No live-provider or production-adoption claim follows from these fixture results.

Delivery: the fix is committed separately from the labeled baseline on
`codex/buddy-readiness-repair-20260912`. Only its changed files are transferred back
to the shared checkout after verifying their baseline bytes have not changed.
Do not merge the baseline snapshot over concurrent work; integrate the repair
commit against the pending implementation stack. Native project records own
completion status and subsequent work.
