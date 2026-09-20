---
kind: "correction"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T12:24:49.601Z
trust: workspace_source
evidence: []
---
2026-09-09 OWNER CORRECTION, superseding the quota approach in note 01M231D5D0T2G72K9AVQM92DAS and older direct-report designs. The owner said hiring quotas seem ridiculous and asked for simple creation followed by relationships: on a team, direct report, collaboration; a lead sends a document/work handoff that starts a recipient conversation, the recipient creates tasks/subtasks and works, then the lead follows up. This is explicit product direction to remove staffing quota machinery, not an inferred cost-control decision.

Implementation direction changed accordingly: remove quota UI controls, obsolete profile writes, briefing/tool instructions, hire/reparent admission checks, and canonical hiring counters. Keep the legacy SQLite column only as inert migration compatibility; it is not authority. Existing execution budgets remain independent. Builder gains set_relationship(key,fromBuddyId,toBuddyId,kind=manager|consults), scoped to its saved hires and shared workspaces, using existing canonical relationship writes plus command receipts. Optional managerBuddyId on create_buddy is only an atomic convenience composition. One manager and no manager cycles remain; Product consulting Market Research does not reparent the Researcher from GTM.

Reason for the correction: the requested emergent behavior needs identity, relationships, work and messages. A headcount funding step complicates team setup and has no requested product purpose. New tests should demonstrate valid multiple hires even when legacy hire_quota is zero, and message handoff/reply eligibility after setup. The earlier attempt to automatically fund exact seats is abandoned, preserved in the predecessor note rather than erased. Current design is product/buddies/DESIGN_BUILDER_TEAM_SETUP.md; PLANNING_SUB_BUDDIES.md now identifies the superseding owner decision. No live staff or outbound communications are created by this implementation exercise.
