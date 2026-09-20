---
kind: "handoff"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T08:03:06.536Z
trust: workspace_source
evidence: ["/Users/nicholasbardy/git/unleashd/agent_notes/2026-09-09_buddy-config-files-and-worktree-discovery-handoff.md","/Users/nicholasbardy/git/unleashd/product/buddies/PLANNING_MEMORY.md","/Users/nicholasbardy/git/unleashd/server/src/buddies/routes.ts","/Users/nicholasbardy/git/basketball_model/profiles/builder-6e2c850548b83ef7/BUDDY_SOUL.md"]
---
Owner-requested design handoff from Nicholas's basketball_model Codex conversation, prepared by the assisting Codex session for the Buddies Development Lead.

Full handoff: /Users/nicholasbardy/git/unleashd/agent_notes/2026-09-09_buddy-config-files-and-worktree-discovery-handoff.md

Nicholas expected the Basketball Chief Scientist's files, including default model settings, to be discoverable and editable from a filesystem-only agent in a Git worktree. We found untracked soul/memory files only in the main checkout; saved provider/model/effort are in ~/.buddies/buddies.sqlite, and Markdown soul/memory edits do not update their revision heads. This session had no Buddy MCP tools. Current saved Chief Scientist defaults were codex / gpt-6-astra / high.

Recommended design direction: make the small owner-authored definition (name, role, provider, model and effort) a first-class editable file, while retaining SQLite for runtime/coordination, audit and memory revision history. Separately solve worktree-to-Buddy discovery. A JSON export alone will not satisfy the request: choose authoritative file writes shared by UI/CLI/MCP, or an explicit versioned apply workflow with visible pending/applied/error/conflict states. Preserve stable IDs, last-valid settings, active conversation snapshots and execution permission boundaries.

Requested follow-up is a design decision and narrow implementation scope, including source of truth, path/discovery, validation/concurrency, effective-setting precedence, migration and acceptance criteria. This is a proposal, not an adopted design or an instruction to start an implementation or training run.
