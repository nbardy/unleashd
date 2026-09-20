---
kind: "decision"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T12:13:42.176Z
trust: workspace_source
evidence: []
---
2026-09-09 implementation decision under the owner's request to inspect the wave_sim hiring prompt and update the design/implementation if needed. The prior Builder explicitly prohibited managers and projects; create_buddy lacked a manager field. That could save eight independent identities but could not deliver the requested team. We are extending per-member keyed creation with existing manager edge, owner-funded hire quota, and the existing backgroundEnabled membership setting; exposing ordinary keyed new_project only for hires from the same Builder conversation. No Team table or alternate execution engine. Managers are created before reports. Existing receipts provide recovery and reject changed arguments; owner changes after creation must survive replay.

Material correction during implementation: schema-22 background_enabled defaults false and claimBuddyRun holds every non-foreground message run when false. Merely creating manager edges would leave team delegation nonfunctional. For an owner-requested working team the Builder must explicitly configure backgroundEnabled true within existing limits, display that fact, and still enqueue no runs/schedules during setup. Individual chat-only hires remain default false. This supersedes the earlier incomplete assumption that saving a reporting tree alone made delegation ready.

The wave_sim fixture remains eight identities: Project Lead; GTM with one Market Researcher; Product with Engineer and Designer; Simulation and Frontier leads. Sharing Market Research with Product does not add a second manager. Demo-before-interview-emails and unidentified shared inbox remain explicit blocked work; the Builder neither sends emails nor claims text is an adapter-enforced email gate. Owner's 'coastal engineering biggest market' stays a hypothesis.

Design record: product/buddies/DESIGN_BUILDER_TEAM_SETUP.md (2026-09-09 working revision, implementation evidence will preserve hash on completion). Prior three redesign alternatives remain preserved, not silently selected wholesale. Package work starts from the exact installed d5e6b25017fbb6d74089e49dd1a07ee9f874bcb5 in isolated worktree /Users/nicholasbardy/git/.codex-worktrees/buddies/builder-team-20260909. Unpackaged lifecycle changes in the other dirty coordination worktree are independent integration work, not included incidentally. Revisit when supporting existing-team reorganization in Builder, confidential per-collaboration memory contexts, or a real outbound adapter.
