---
kind: "correction"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T07:56:01.565Z
trust: workspace_source
evidence: ["client/src/components/BuddiesDashboard.tsx","client/src/components/buddies/BuddyMessages.tsx","client/src/mobile/buddies/BuddyDetailMobile.tsx","client/test/buddy-messages.test.tsx","Client tsc -b passed; 4 targeted rendered tests passed; all six client invariant gates passed; live Chrome desktop and 390x844 mobile verification."]
---
User reported Wave_sim CEO /conversations showing background-work permissions and limits. Root cause: BuddyMessages mounted BuddyCoordination whenever buddyId existed, and both desktop/mobile mounted BuddyMessages before content on every non-settings tab. Fixed by removing coordination from Messages, mounting coordination explicitly in Settings in both shells, and restricting Messages plus desktop send/review tools to Work. Prior inbox render test omitted buddyId and therefore missed the production-only branch; adding buddyId reproduced 3 forms instead of 1 and passed after correction. Live desktop and mobile checks confirmed Conversations/Chats directly show the empty state, Settings retains controls, and Work retains Messages. The CEO page currently reports no direct conversations; this observation is not evidence of deleted history.
