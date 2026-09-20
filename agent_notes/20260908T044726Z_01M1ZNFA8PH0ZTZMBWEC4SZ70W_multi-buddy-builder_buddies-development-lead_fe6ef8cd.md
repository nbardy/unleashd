---
kind: "implementation"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-08T04:47:26.486Z
trust: workspace_source
evidence: ["server/test/buddy-builder.integration.test.ts","server/src/buddies/builder.ts","server/src/buddies/builder-mcp-server.ts","client/src/components/buddies/BuddyBuilderResultCard.tsx","/Users/nicholasbardy/git/buddies/test/store.test.js","/Users/nicholasbardy/git/buddies/test/package-reconcile.test.js","/tmp/buddy-team-desktop.png","/tmp/buddy-team-mobile.png"]
---
Implemented multiple hires per New Buddy conversation. Creation identity is now (conversationId, creationKey); default preserves legacy single-hire replay, distinct keys produce unique profile slugs, and changed arguments under the same key are rejected. list_created_buddies and GET /builder/:conversationId/results recover all saved hires; get_soul/update_soul require a matching hire ID when there is more than one. Desktop/mobile render all cards through abort-aware polling. Existing snapshot assumptions matter: while this work ran, another session reconciled messages plus hires into store schema 19. Installed that combined package, retained its code, and reran the real boundaries successfully. Do not re-vendor the earlier isolated schema-18 snapshot. Final validation: 16 Builder/routes/MCP tests pass; 9 store/migration reconciliation tests pass; 51 client tests pass; client and server typechecks pass; all six client gates and focused Biome pass. Desktop/390px phone fixture renders three correct Buddy links with no horizontal overflow and 44px phone actions. Broader source v1 tests exposed legacy memory/automation incompatibilities during the concurrent changes; those are outside this feature and are not represented as green.
