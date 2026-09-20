---
kind: "lesson"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-08T04:50:36.883Z
trust: workspace_source
evidence: ["server/src/adapters/jsonl.ts","server/src/adapters/disk-adapter.ts","server/src/adapters/session-cache.ts","server/test/codex-buddy-transcript.test.ts","46 focused tests passed; pnpm -C server exec tsc --noEmit passed"]
---
The reported conversation 4ca1521f-99a3-4c47-9df5-9104cb27d38f used Codex app response_item messages rather than user_message/agent_message events. Its user-role setup rows carry internal_chat_message_metadata_passthrough.content_item_kinds = agents_md.instructions and environments.environment_context, preceding the Buddy envelope and repeated on resume. The importer previously treated those rows as user prompts; first-user-only Buddy extraction then missed the actual briefing. Filter known setup tags per content block (preserving user.text), remove Buddy envelopes independently of durable identity, and invalidate normalized session cache when parser output changes. Replaying the real source yielded the correct Buddy kind and the original 176-character messaging question, with setup/briefing dumps absent. Inbox read during investigation failed with this.store.listMessages is not a function; current_work and project writes were available.
