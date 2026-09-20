---
kind: "conversation-memory-review"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:42:20.099Z
trust: workspace_source
evidence: [{"conversationId":"6414b5d7-3c47-455f-bd87-7fb14bc47789","attemptId":"2044b8e1-b89e-45bc-b05b-e3a28af838b3","reviewId":"82270c94b8f5a89d101726427764d88f641daae799ef9f0190210c168f39bfa4","model":"gpt-5.6-luna"}]
---
2026-09-10 conversation evidence: After preserving streamed Codex tool calls on JSONL/cache reload and correcting collapsed labels, expanded calls were still empty because only call names survived; saved scripts/commands/arguments had been discarded in the hydrated message shape. The fix keeps tool inputs as separate data and renders scripts, commands, and JSON arguments when expanded; Copy includes them. Verified with real recorded calls, saved-input/cache tests, rendered regression tests, client/server typechecks, and live UI inspection. Existing history requires a safe server reload to load the fix. This extends the prior tool-history note: preserving call identity alone is insufficient; preserve inspectable inputs/details too.
