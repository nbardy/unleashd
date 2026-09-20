---
kind: "correction"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:32:19.101Z
trust: workspace_source
evidence: ["client/src/utils/chat-message-groups.ts","client/src/components/VirtualizedMessageList.tsx","client/test/chat-message-groups.test.tsx"]
---
Owner screenshot showed 4 earlier updates and 6 earlier updates where the collapsed rows contained only tool calls. AssistantUpdatesGroup labeled all hidden messages as updates because the final prose message put tool history into an assistant_updates group. Added shared describeMessageActivity used by both collapsed renderers: tool-only history says N tool call(s), genuine prose says N earlier update(s), mixed history reports both counts, and multi-line tool messages count individual calls. Rendered regression failed before and passes after; both focused chat grouping tests pass and all six client invariant gates pass. Live Chrome verification of conversation 6414b5d7-3c47-455f-bd87-7fb14bc47789 showed exactly 4 tool calls and 6 tool calls and successful expansion into four saved exec call entries. Client tsc -b is currently blocked by separate BuddyProjectExecution.tsx imports for BuddyProjectExecutionViewSchema/BuddyProjectExecutionView missing from shared exports plus derived implicit-any errors. Browser connected through CUA extension after agent-browser could not find a debugging port.
