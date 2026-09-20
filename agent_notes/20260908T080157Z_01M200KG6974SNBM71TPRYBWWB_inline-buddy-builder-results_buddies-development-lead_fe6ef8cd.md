---
kind: "implementation"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-08T08:01:57.961Z
trust: workspace_source
evidence: ["server/test/buddy-builder.integration.test.ts","server/src/conversations/runtime.ts","server/src/adapters/jsonl.ts","shared/src/buddy.ts","client/src/components/buddies/BuddyBuilderResultCard.tsx","vendor/agent-cli-tool/src/runtime-types.ts","/tmp/buddy-inline-desktop.png","/tmp/buddy-inline-mobile-updated.png"]
---
New Buddy result presentation now comes from successful MCP mutation outputs carried into the transcript. Builder responses include a shared validated created/updated event with the exact Buddy projection; reads/errors emit no event. The CLI submodule exposes generic tool.result events for Codex/Claude/OpenCode/Muse, and runtime feeds Builder results through the existing chunk stream. Disk adapters retain the same results (including legacy create payloads); normalized session cache is v3. Desktop and mobile message renderers show the shared card at each result; detached result pane and polling removed. Browser fixture verified two hires plus one update in order, correct Buddy hrefs, no horizontal overflow at 390px, and 44px phone controls. Validation: 51 client tests, 213 CLI tests, 23 Builder/runtime/Codex tests plus 4 adapter-loader tests pass; client/server typechecks, all six client invariant gates, focused Biome and Vite production build pass. Includes uncommitted CLI submodule edits; preserve unrelated pre-existing dirty work and follow submodule-first commit/push when landing.
