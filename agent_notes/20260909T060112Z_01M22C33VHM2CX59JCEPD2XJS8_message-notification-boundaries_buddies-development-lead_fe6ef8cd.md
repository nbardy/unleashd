---
kind: "handoff"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T06:01:12.817Z
trust: workspace_source
evidence: ["docs/buddy-message-notifications.md","server/test/buddy-message-notifications.test.ts","23 focused server tests and 53 package tests passed; server typecheck passed."]
---
Implemented generic Buddy send/reply/get_message and active-chat notifications in isolated Unleashd worktree 20260909T052648Z-77684. Notification headers append to Buddy MCP results only; arbitrary provider-native shell/file tool boundaries are not intercepted. Fallback waits for successful process/event/session-persistence drain and never revives stopped or failed turns. Store schema v20 removes unique recipient-conversation binding and atomically hands off bounded pending batches; this is a handoff receipt, not model-read acknowledgement. Inbox messages survive a lost transport nudge. Preserve legacy memory APIs when updating the vendored package: importing the entire newer shared package snapshot removed those methods and broke existing operation tests; isolated source commit d7f4a19bcf0eb3ad66a198168e2571d539eacfcb retains them.
