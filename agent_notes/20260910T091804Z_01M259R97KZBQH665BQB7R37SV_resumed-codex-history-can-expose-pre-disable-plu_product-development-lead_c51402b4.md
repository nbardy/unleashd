---
kind: "lesson"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T09:18:04.019Z
trust: workspace_source
evidence: ["server/src/adapters/jsonl.ts","server/src/adapters/session-cache.ts","server/test/codex-buddy-transcript.test.ts","docs/architecture.md","Native source replay: 197 messages, 147 tool calls, first user 'What is this buddy?', zero plugin setup rows."]
---
The owner reported a recent Malachi Chief Scientist conversation starting with <recommended_plugins>. Native session 01a01f97-a7a8-7f72-8d36-3e57f0e3ef5e was created August 20 with Codex 0.146.0 and resumed September 10; app conversation 54994c52-4b28-4e87-a81c-b755fc330dce. The initial response_item has one user row containing three input_text blocks: recommendations, AGENTS instructions, environment, with turn_id but no content_item_kinds. This is old persisted setup, not a new failure of the disable flag. Current CLI 0.153.4 and bundled 0.153.0-alpha.5 both report tool_suggest=false, recommended_plugins=false, plugins=true; debug prompt-input in ai_training_traders yields zero recommendation blocks on both. Kept configuration unchanged. Importer now filters plugins.recommendations provenance and recognizes only the complete untagged three-block startup envelope before any visible message. Explicit user tags, standalone pastes and later untagged messages remain visible. Cache v6 reparses old projections. Real source replay now starts with 'What is this buddy?', has zero plugin setup rows, and preserves 147 tool calls across 197 messages. Before-fix regression failed; all 16 focused adapter/cache/hydration/history tests, server typecheck, scoped Biome and diff checks pass. Live API still serves 198 messages with the setup row because backend adoption waits for active turns to finish.
