# Wave_sim recovery clarification — 2026-09-14

Owner accepted targeted implementation with “code it up and then respond to the wave sim ceo”. This follows the CEO report and the Lead recommendation in this conversation; it does not authorize a new budget model.

Choice (implementation by Buddies Development Lead): retain shared access and execution authority; split generic project rejection into condition-specific errors; explain completed-attempt rejection and fresh bounded resumption of the same Task; document managed continueFrom as done-only. Existing primitives provide recovery with a fresh request, but cannot promise same-allowance or same-session blocked continuation. No lifecycle extension was necessary to prove the documented recovery route. Revisit if the owner requires that stronger continuity or exact incident receipts demonstrate valid work is rejected.

Evidence: evidence.json pins changed files by SHA-256. tests.log preserves 25 passing focused tests; server source typecheck passed. The fixture uses real MCP, dispatch and SQLite/package boundaries with explicit run settlement, not live model judgment or the Wave_sim app/database. Existing return regression tests cover runtime routing. No production reload, migration, push or main merge.

The app commit is based on aef62634020e03e738a579e55a72a32178434e80. Its operator-guide return paragraph also retains a pre-existing uncommitted documentation update absent from that snapshot; other changes are isolated using before-edit backups. Shared working-tree edits and the agent-cli submodule remain untouched.

Native list_buddies(scope:permitted, query:wave) returned no contacts; the full permitted directory exposed only four Unleashd contacts and no Wave_sim route (audit_721721c0-c92a-4732-833f-8b6ea491ba64). CEO response is prepared in ceo-response.md, not sent. No CLI/HTTP/database fallback was used to bypass native scope.
