---
kind: "legacy_journal"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-08-22T00:00:00.000Z
trust: workspace_source
evidence: ["memory/journal/2026-08-22.md"]
legacy_source: "memory/journal/2026-08-22.md"
---

## 2026-08-22T08:40:49.100Z

Diagnosed c884e6fc-a16b-411d-ac70-736a2b906adb disappearing from the Buddies Development Lead sidebar group. Outcome: durable config `/Users/nicholasbardy/.agent-viewer/conversation-config/v1/by-conversation/Yzg4NGU2ZmMtYTE2Yi00MTFkLWFjNzAtNzM2YTJiOTA2YWRi.json` and Buddy API link both retain buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd/workspace project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c, while live API reports general/null. Evidence: current Codex adapter parses native session 01a0285c-01ec-78c3-b3ca-8f00d2fd3392 with a pseudo-user `<recommended_plugins>` before the buddy marker; jsonl.ts extractor checks only first user, so disk-adapter emits general; session-loader.ts poll lines 438-440 then overwrites the specific live kind. Lesson: apply first-specific-wins at poll boundaries just as startup hydration does; never let transcript-derived general demote durable Buddy identity. Do not fix by trusting arbitrary later user markers, which could permit spoofed identity on legacy/config-missing transcripts. Next attempt: add a real poll-boundary regression and preserve existing specific kind when source is general.

## 2026-08-22T08:41:45.484Z

Outcome: diagnosed c884e6fc-a16b-411d-ac70-736a2b906adb disappearing from the Buddies Development Lead sidebar. Durable creation metadata and Buddy link remain correct (buddy_d3f11f11); the live 5s disk poll demotes the runtime to general. Codex records <recommended_plugins> as the first user message and the buddy marker second; extractBuddyContext checks only the first, then applyPolledUpdate blindly assigns source.kind=general. Evidence: conversation config record Yzg4...json; native rollout 01a0285c...jsonl; jsonl.ts:1269; session-loader.ts:418-440; Sidebar.tsx:136-175. Lesson: durable creation metadata owns Buddy identity at every lifecycle boundary, not only startup. Next attempt: preserve an existing specific kind over polled general and add a real poll-boundary regression; do not scan arbitrary later user messages for trusted markers because that can enable identity spoofing.

## 2026-08-22T10:01:44.787Z

Outcome: fixed Buddy sidebar/runtime demotion caused by provider polling overwriting a durable specific kind with transcript-derived general. Evidence: commit 87dba0c; server/src/lifecycle/session-loader.ts monotonic general-to-specific reconciliation; server/test/session-loader-hydration.test.ts real poll-boundary demotion/promotion tests; full server suite 193 tests/192 pass/0 fail/1 skip; server typecheck, biome, and diff check pass; live sidebar restored Product Development Lead and Buddies Development Lead groups, and scoped Buddy MCP tools returned. Lesson: Codex host metadata such as recommended_plugins may precede the real prompt in native session storage; this is discovery noise, not authority to detach app-owned identity. Do not scan arbitrary later user messages for identity markers because that creates a spoofing path. Durable runtime/config identity must remain monotonic unless an explicit detach/retype command exists.

## 2026-08-22T10:21:48.686Z

Outcome: disabled Codex discoverable tool/plugin suggestions globally for this user by setting [features] tool_suggest = false in /Users/nicholasbardy/.codex/config.toml. Evidence: both codex-cli 0.149.0 and ChatGPT-bundled codex 0.148.0-alpha.15 report tool_suggest stable false while plugins remain true; debug prompt-input from both contains zero recommended_plugins blocks. Lesson: features.recommended_plugins=false alone does not remove the injected list in these builds; tool_suggest is the effective targeted switch. Existing persisted session history may retain an old block, but new process prompt construction omits it.
