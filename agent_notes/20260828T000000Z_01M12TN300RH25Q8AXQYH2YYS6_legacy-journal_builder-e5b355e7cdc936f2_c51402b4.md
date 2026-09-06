---
kind: "legacy_journal"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-08-28T00:00:00.000Z
trust: workspace_source
evidence: ["memory/journal/2026-08-28.md"]
legacy_source: "memory/journal/2026-08-28.md"
---

## 2026-08-28T06:02:29.494Z

2026-08-28: Fixed Buddy submission error crushing the Chat composer. Evidence: client/src/components/Chat.tsx moved submissionError outside the .input-wrapper flex row; Chat.css now gives the alert full width, spacing, line-height, and overflow wrapping. pnpm -C client exec tsc -b and git diff --check pass. Lesson: long admission errors must be block-level above the input/action row, never a sibling flex item of the textarea. Next attempt: visually verify in the running app and consider a focused render/layout regression if this area changes again.
