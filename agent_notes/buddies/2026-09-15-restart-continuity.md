# Buddy restart continuity — implementation decision

Recorded 2026-09-15T04:10:21.865259+00:00.

## Decision and motivation

Owner asked for needed fixes rather than a testing workstream: “idk i dont want testing i just want fixes if we need”. Buddies Development Lead chose the bounded restart-continuity repair from the preceding review. This authorizes the fix; the persistence design is the assistant's implementation choice.

Persist the existing disclosure audience key on the exact provider-session binding when `session.started` confirms its ID. Restore it through transcript hydration, recovery without transcripts, and creation replay. Compare against freshly resolved access at the next send. Compatible sessions resume with refreshed briefing/MCP; changed or unverified access starts fresh. Clear the in-memory key on explicit reset. Observation-only binding updates preserve already verified metadata for the same session.

This reuses config-store and runtime authority. It replaces the unconditional loss of audience verification on restart; it does not introduce a new controller. Earlier rationale against resetting on ordinary memory changes still holds. Alternatives rejected: generation-reset loses normal continuity; replaying UI history could copy context into a changed audience.

Predecessors: native note `2026-09-15T03:40:18.725Z:ed079d24-c7fa-4366-9bcc-fcad268c17fb` and proposal `2026-09-15T04:00:42.464Z:c61e2773-9ed3-48e2-a441-f90bd5aab296`, owner_thread `b1c757c7-5398-4858-a6aa-5314717dc533`. Task: `buddy_project_a1901054-80f9-40c6-a5d3-39d9ecb4304a`.

## Validation and limits

Shared ESM/CJS compilation, server typecheck, formatting of the seven changed TS files, and 59 existing persistence/runtime/creation/hydration/history checks passed. No new test files or live-provider test project added. Reviewed the saved-session metadata flow across all three restoration paths. No claim of a live model round trip or production reload. The normal dev watcher adopts source at its safe idle boundary; no server restart forced.

Legacy records have no verified audience and still need one fresh session before future restarts can retain continuity. Missing or changed access continues to reset. Revisit if the audience-key authority changes or session bindings gain external provenance that cannot be trusted for resumption.

## Historical source evidence

The shared checkout has unrelated changes; [the incremental patch](2026-09-15-restart-continuity.patch) captures only this task's changes against its initial snapshot. Patch SHA256 `60ee3b706d27ae31a4639d9db7a6cdb6ac013f3c882102f670547dc7f6211b2f`. Before/after hashes and changed excerpts are preserved below and in that patch; a HEAD commit alone does not identify these uncommitted contents.

- `shared/src/conversation-config.ts`: before `87211096a17501c6ed1a858dca9ff908ac44fccddb09547ff3aaf67b007fda51`, after `3ca636cc7c6cb3087b427fb1faa14ec757a6dd8c1047b628e2021f2169f14d76`
- `server/src/conversations/runtime.ts`: before `f7cca1f9b8daa3a83c1c54ce4a7d589adbcb2147adbb0688b188925317409827`, after `7f39db3e132b19ede27c1e94ebb7fac7f9242f4917813280d4759c324fc07e7b`
- `server/src/conversations/config-store.ts`: before `b43f7d31747a29de9d2a9b272cb818c5182db7355af5a5f87c34a86e36c2ef69`, after `ff0f26a24d6e70b2b601aa919ddb8e8268c8d3b308e74f9096779290fcae71b9`
- `server/src/conversations/buddy-creation-service.ts`: before `15d3fd233b8ef64c05e8ac6271d416de55ae480c3de4d49a0a29b71c18207d4c`, after `739723b5e4fa4394b890bb8caac1e739c687e0a2dc78eba8bd0638c08e9566c9`
- `server/src/conversations/creation-service.ts`: before `e49618d3a29b4988cc533f22b115af2f5eb30a99a2798a972b9ee66abedb5967`, after `ae3eaaf72ea9663b9c2b0abaec38496d6061ad951f794f9c8be55038f4805682`
- `server/src/lifecycle/session-loader.ts`: before `7aad559b6540a861414d5ede3ad89280f37b8ccc3718e5aa8d225c9c11211b79`, after `1fa9a816b117808e7114ba6aee516e6481db5cfc9151d0f185ca5fd9bca4eeeb`
- `server/src/server.ts`: before `75863822f71ed83ebeae0419188848b4bae2ce0362971be3063c7956d6431ccc`, after `dd2f35e9230519ca1fe07d50cc708f87281f801d2e5e8945bf6f6864e142d225`
- `docs/architecture.md`: before `7538b209cc3319e205a5abeb5d65f069bde85148ac441106be34d6f54e11fa6c`, after `4737a9e0e1b10a9165d3e9d96a6c3f042a5f406c852f60f3ab27171a09a623c7`
