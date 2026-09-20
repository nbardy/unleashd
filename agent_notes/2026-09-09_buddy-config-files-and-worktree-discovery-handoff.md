# Handoff: editable Buddy configuration and worktree discovery

Date: 2026-09-09
Status: Proposed design direction; existing behavior verified by local source inspection and read-only database queries.
Recipient: Buddies Development Lead (`buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd`), for design and engineering review.
Origin: Nicholas's Codex conversation in the basketball_model worktree. This records the owner's question and the assistant's recommendation; it is not a decision already made by the lead.

## What prompted this

Nicholas asked whether a filesystem-capable Codex session could see the Basketball Chief Scientist Buddy. The first response misunderstood “buddy” as an on-screen character. After Nicholas pointed to `~/git/unleashd`, we found the Buddy through its local registry and profile files. He then asked whether default model and other settings lived alongside those files, and suggested considering moving the configuration out of the database.

The expectation is concrete: an agent working on the project should be able to find its Buddy, inspect its configuration, and make an authorized edit through ordinary files, including when the Buddy MCP is unavailable.

## What we observed

- The active Buddy is **Basketball Chief Scientist**, ID `buddy_cb357624-68e4-449c-a0d2-7aade3793a99`, slug `builder-6e2c850548b83ef7`.
- Its registered home is `/Users/nicholasbardy/git/basketball_model`.
- Its files are under `profiles/builder-6e2c850548b83ef7/`: `BUDDY_SOUL.md`, `memory/WORKING_MEMORY.md`, and `memory/LONG_TERM_MEMORY.md`. Both dense memory bodies were empty; the soul contained the scientific leadership brief.
- All three profile files were untracked in the main checkout. They were absent from the current Codex worktree at `/Users/nicholasbardy/git/.codex-worktrees/basketball_model/20260909T032956Z-41794`.
- Registry and configuration live in `~/.buddies/buddies.sqlite`. The `buddies` row had provider `codex`, model `gpt-6-astra`, reasoning effort `high`, status `active`, and hire quota `0`. These are the saved Buddy defaults, not a claim about an existing conversation's effective runtime.
- No Buddy MCP tools were exposed to this Codex session. Shell/filesystem access and the authenticated local Unleashd HTTP API were available.
- No JSON/YAML Buddy configuration file was found alongside this profile. The owner profile API updates the stored settings.
- Soul and dense-memory Markdown are generated projections of the SQLite revision heads. Editing their bytes alone does not move a head; export repair can overwrite those edits. Existing conversations retain memory snapshots; fresh chats/forks/runs see newer generations.
- Profile paths resolve against the registered project root. The inspected storage path functions do not discover Git worktree relationships. With no explicit memory path, the default is `profiles/<slug>/memory`.
- Detailed notes in `agent_notes/` are actual files searched by recall.

These observations establish current storage and discovery behavior. They do not establish how often other users encounter the problem.

## Recommendation

Make the small, owner-authored Buddy definition a first-class editable file. Keep SQLite for runtime state, memory revisions, coordination and audit history.

Start with name, role, provider, default model and reasoning effort. A possible location is `profiles/<existing-slug>/buddy.json`, alongside the soul. That filename and schema are suggestions, not an approved contract. Preserve stable Buddy IDs and existing paths during migration; readable aliases can be designed separately.

The benefit is direct: Nicholas can ask a filesystem-only agent to inspect or change a default, review the diff, and understand when it takes effect without requiring MCP or editing SQLite.

Moving all Buddy state into files would introduce unnecessary scope. Dense memory already has immutable revisions and compare-and-swap. Soul and memory file editing deserve a separate design that preserves those properties. Employment state, hire quota, operation grants, run claims, approval decisions and credentials must not acquire execution authority merely because a repo file was edited or imported.

## Three separate design problems

1. **Discovery across worktrees.** A session needs a documented way to resolve the stable Buddy identity and canonical profile location from the main checkout or a linked worktree. Show the resolved path and effective source. Adding another untracked file alone does not solve this.
2. **A real editing contract.** Decide whether a file is authoritative or is an editable working copy requiring an explicit apply operation. A generated export that silently loses edits does not satisfy the expectation.
3. **Configuration versus runtime state.** Make simple defaults portable and reviewable while retaining transactional execution and history in the store.

## Authority decision for the lead

Preferred direction: the declarative config file is the source for these settings. UI, CLI and MCP edits use the same validator and file-write contract; the database may retain an index, applied snapshots and audit history.

A valid alternative is an editable working copy reconciled into the revisioned store, but it must clearly expose pending/applied/invalid/conflict states and provide a usable filesystem-oriented apply command. Do not describe that as immediate file editing.

In either design, specify:

- Validation, atomic writes, concurrent UI/file edits and stale-write detection. Preserve the last valid settings when a file is temporarily incomplete; surface the error and do not silently clobber the edited bytes.
- How and when a change becomes effective, including an applied revision/hash and the defaults used for the next conversation. Do not silently change active conversations.
- Default and override precedence, including provider/model compatibility and a way to inspect effective settings.
- Whether a worktree edit changes the shared Buddy or creates an explicit local preview. Default discovery must not silently fork identities or treat branch checkouts as global setting changes.
- Migration and rollback that preserve Buddy IDs, stored defaults and memory history. Report database/file conflicts instead of silently picking a winner.
- How portable definitions are shared while personal runtime state and credentials remain local. Loading a definition must not start work, enable automation or grant permissions.

## Suggested first deliverable and acceptance criteria

Produce a short design decision with the file schema, canonical path/discovery rule, source-of-truth choice, write/apply behavior and migration plan. Then scope one implementation slice around model defaults.

Success means a fresh filesystem-only Codex session in this basketball worktree can:

1. Find the Chief Scientist's stable ID, profile and saved/effective settings without manually inspecting SQLite.
2. Edit the default model and effort through the documented file workflow, see validation/applied status, and have the next conversation use the intended values.
3. Round-trip a UI/MCP edit and a file edit through one contract, with conflicts visible and no silent data loss.
4. Recover from an invalid save, concurrent edit, restart or filesystem failure while retaining the last valid configuration.
5. Preserve the existing Buddy identity, memory history and active conversation snapshots after migration.
6. Copy or check out a profile without launching a conversation or changing execution permissions.

The current export files should also visibly explain their present authority until any migration ships.

## Evidence and implementation entry points

- `~/.buddies/buddies.sqlite`: read-only queries of `buddies`, `projects`, `buddy_memory_heads`, and `buddy_memory_revisions`; live values may change.
- `/Users/nicholasbardy/git/basketball_model/profiles/builder-6e2c850548b83ef7/`: inspected profile files; `git ls-files --others --exclude-standard` confirmed they were untracked.
- [Memory contract](../product/buddies/PLANNING_MEMORY.md): revision/CAS model, generated Markdown views, note recall and conversation snapshots.
- [Coordination contract](../product/buddies/PLANNING_PRIMITIVES.md), [automation ownership](../product/buddies/AUTOMATION_OWNERSHIP.md), and [direct reports](../product/buddies/PLANNING_SUB_BUDDIES.md): runtime and owner authority boundaries to preserve.
- [Buddy integration](../server/src/buddies/integration.ts): stored provider/model/reasoning defaults passed into conversation creation.
- [Owner routes](../server/src/buddies/routes.ts): profile PATCH, soul/memory edits, notes and recall.
- Installed `@nbardy/buddies/src/store.js`: `defaultDatabasePath`, `exportCheck`, `fixExport`, `#projectPath`, and `#memoryRoot`.
- [Current integration handoff](2026-09-09_buddies-integration-handoff.md): application and package work are changing concurrently. Recheck the selected source/package/runtime before implementing; installed package inspection is evidence, not a request to edit node_modules.

Requested follow-up: review and choose the editing/discovery contract, identify the narrow first implementation, and record unresolved decisions. This handoff proposes a design; it does not migrate profiles, change live defaults, authorize research/training, or ask for an automatic implementation run.
