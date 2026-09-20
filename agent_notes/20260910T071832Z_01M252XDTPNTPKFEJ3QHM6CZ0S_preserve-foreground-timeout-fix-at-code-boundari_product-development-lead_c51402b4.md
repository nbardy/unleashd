---
kind: "guardrail"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T07:18:32.534Z
trust: workspace_source
evidence: ["server/src/constants/timeouts.ts","server/src/conversations/runtime.ts","server/src/server.ts","AGENTS.md","docs/incident-2026-09-10-buddy-chat-timeout.md"]
---
Owner requested code comments explaining why the recurring ten-minute cutoff inherited a default despite the earlier fix. Added comments at server/src/constants/timeouts.ts (bridge/provider/max distinctions and shared foreground budget), conversations/runtime.ts (must forward explicit budget; expiry must not call stop/user_stop), and server.ts (ms-to-seconds package handoff). Added AGENTS.md regression rule and cross-linked August bridge incident to September foreground deadline incident. Cause: new foreground beginBuddyChatRun reused claimBuddyRun but omitted budget, silently inheriting background default600; earlier heartbeat fix remained intact. Verified latest archive and installed package retain foreground24h and explicit forwarding; provenance clean bd6e61d. Existing real packaged-store and runtime regression suites rerun:23 passed,0 failed. These tests cover authority after11 simulated minutes, explicit budget/expiry/cancellation/background bounds, and truthful timeout with joined drain; prior actual11m32 end-to-end proof remains documented.
