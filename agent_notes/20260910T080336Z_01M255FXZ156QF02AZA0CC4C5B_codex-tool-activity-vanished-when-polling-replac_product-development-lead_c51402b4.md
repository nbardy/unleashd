---
kind: "finding"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:03:36.033Z
trust: workspace_source
evidence: ["server/src/adapters/jsonl.ts","server/src/adapters/session-cache.ts","server/test/codex-tool-history.test.ts","server/src/lifecycle/session-loader.ts","docs/architecture.md"]
---
Owner reported visible streaming tool use disappearing afterward. Confirmed runtime.handleOutput appends formatted tools into server messages, but parseCodexJsonlFile skipped function_call/custom_tool_call and extractMessagesFromCodexEntries ignored them; session-loader.applyPolledUpdate replaces runtime messages with parsed history when no process is active. Fixed the Codex adapter to retain and format those calls for both event-message and response-message transcript sources, dedupe calls by call_id/id so repeated identical tool labels survive, preserve original row order including equal timestamps, and advance normalized cache v3 to v4 so unchanged transcripts are reparsed. Existing Builder results and setup filtering remain covered. New real filesystem/loader/cache integration tests failed before the patch and pass afterward for both source formats. 24 targeted server tests passed, server tsc --noEmit passed, all six client invariant gates passed, formatting passed. Read-only parse of a completed real Unleashd transcript restored all 21/21 raw tool calls. Running backend PID 19565 started 15:26 local, before this fix, so live rollout still needs the normal safe idle reload; no force restart was performed.
