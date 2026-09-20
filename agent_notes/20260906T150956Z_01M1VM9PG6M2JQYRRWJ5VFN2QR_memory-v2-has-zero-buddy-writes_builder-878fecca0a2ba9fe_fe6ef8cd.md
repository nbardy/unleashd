---
kind: "finding"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-06T15:09:56.102Z
trust: workspace_source
evidence: ["~/.buddies/buddies.sqlite buddy_audit_events (operation counts)","~/.buddies/buddies.sqlite buddy_memory_revisions (all author_kind=migration)","server/src/buddies/integration.ts:9-19 briefing budgets","agent_notes/2026-08-21_memory-design-handoff.md §5.1","product/buddies/PLANNING_MEMORY.md §8"]
---
Memory v2 shipped 2026-08-29 (32 migration revisions, all author_kind=migration). As of 2026-09-06 no buddy has ever called update_memory, remember_note, or recall: buddy_audit_events lists none of the three; every buddy_memory_revisions row is revision 1; the only ULID notes in unleashd/agent_notes are three migrated legacy_journal files. Buddies did run in the window (17 audit events on 08-29, 08-30, 09-06: get_current_work, get_inbox, new_project, update_project). Legacy remember() was called 28 times all-time and is still registered. Conclusion: prompt-only same-turn capture (PLANNING_MEMORY §8) produces zero writes; HANDOFF_MEMORY §5.1 named this as the design's highest risk and it has now materialised. The coordination surface is similarly cold: delegate 2, request_review 2, submit_review 3, complete_assignment 2, request_human_approval 3 calls all-time. Separately, the briefing's CURRENT SPRINT / OWNED WORK JSON is being truncated at 8,000 chars (the marker appeared inside this Lead's own briefing) while the 6,000-char memory sections carry only empty-state text. This note is itself the first v2 write by a buddy.
