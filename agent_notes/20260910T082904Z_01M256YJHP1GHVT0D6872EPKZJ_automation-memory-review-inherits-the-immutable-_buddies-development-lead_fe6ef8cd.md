---
kind: "correction"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:29:04.438Z
trust: workspace_source
evidence: [{"path":"server/src/conversations/buddy-creation-service.ts","sha256":"d073c902773ebb28e09d6cf846ef400a52ab4e3f1ff485e6ea0360ca3e960a59"},{"path":"server/test/buddy-creation-service.test.ts","sha256":"6803fe40e61ffd264a8fba0458416e710cb54aa4e0c4b242b1a491a5f1135907"}]
---
2026-09-10 follow-up to the independent Luna reviewer validation note 20260910T081628Z_01M2567GD6BMPSY7GJT2CVY318_luna-memory-reviewer-verified-with-real-tool-wri_buddies-development-lead_fe6ef8cd.md. Owner asked whether memory review covers owner chats, Buddy-to-Buddy conversations, tasks and automation conversations. Source inspection confirms all application-managed Buddy executions use the shared runtime completion hook, including runCoordinationMessage for message requests/replies and schedules, and legacy sendAutomationMessage. Review is per successful provider turn, asynchronous, scoped to the executing Buddy. Sending a message or changing a task record alone is not a completed model turn.

Correction found during that coverage check: legacy createAutomationConversation passed automationRunId but omitted allowedBuddyOperations from resolveBuddyConversation. The memory reviewer treats an absent allowlist as unrestricted, so the prior statement that all source restrictions were retained was too broad for this older path. Assistant fixed this implementation gap within the previously accepted design by forwarding a copied run.policy.allowed_operations, not the mutable automation definition's current policy. Preserved new excerpt: 'allowedBuddyOperations: [...run.policy.allowed_operations]'. The owner direction is unchanged; this is a consistency fix, not a new product decision.

Regression uses the existing creation boundary with a definition permitting update_memory and an immutable run permitting only get_current_work; it verifies the created conversation carries only the run's restriction. Creation, reviewer, capture and runtime suites passed 38 tests with one opt-in live skip (39 total); server typecheck and targeted diff whitespace check passed. Current injected briefing also shows a real buddy.memory_review audit event at 2026-09-10T08:22:31.610Z and populated working memory revision 2, so the earlier review feature has reached the running application. This small follow-up source fix follows the normal cooperative reload. Supporting source hashes below are dated uncommitted snapshots; no commit or push.
