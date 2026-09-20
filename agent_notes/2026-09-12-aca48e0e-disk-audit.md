# Exact-thread disk and journal audit — 2026-09-12

Read-only inspection of production files, normalized caches and the live HTTP detail route at approximately 17:49–17:54 Asia/Makassar (UTC+8). This report adds independent evidence for the exact owner-reported thread, `aca48e0e-ee06-42d1-831b-5470d2c2402a`. No provider was launched, message sent, session changed, production record edited or process restarted by this audit. Parallel agents are repairing source; findings below describe the live pre-repair process. The [sanitized machine-readable evidence](2026-09-12-aca48e0e-disk-audit.evidence.json) captures a final baseline at `2026-09-12T09:54:25.175250Z` with all native paths/hashes, normalized counts, journal events and API metadata.

**The native history remains on disk. The live API exposes only the latest of four bound Codex sessions: 12 of 121 normalized messages, omitting 109 earlier messages. It also reports a September 12 birth date instead of the durable September 10 birth date. Three fresh-session rotations occurred on September 12.**

## Durable identity and live discrepancy

- Stable application ID: `aca48e0e-ee06-42d1-831b-5470d2c2402a`.
- Durable file: `/Users/nicholasbardy/.agent-viewer/conversation-config/v1/by-conversation/YWNhNDhlMGUtZWUwNi00MmQxLTgzMWItNTQ3MGQyYzI0MDJh.json`.
- Durable status/provenance: `active` / `user`; record revision 4, configuration revision 0.
- Durable `createdAt`: `2026-09-10T17:19:40.782Z`; `updatedAt`: `2026-09-12T09:28:40.296Z`.
- Current session: `01a094f2-90d8-7db0-b9f4-d0f033e219be`; all three earlier sessions remain in `sessionBindings`.
- Live GET `http://unleashd.localhost/api/conversations/aca48e0e-ee06-42d1-831b-5470d2c2402a` returned that same ID/current session, but `createdAt=2026-09-12T09:28:40.335Z` and only 12 messages: 3 user, 9 assistant (4 of those tool calls).
- Live first message is the screenshot's “that messsage was suppose ot be resuming…” question. It is followed by the recovered-thread answer and the later “Hello” / “hello” exchanges. The original questions and the 17:11 repair result are absent.
- Authorized local GET uses the existing bearer token read privately from `~/.agent-viewer/auth-token`. No token value is included here. Python `urllib.request` successfully reached the exact hostname directly.

## Preserved transcript inventory

All four native files existed; their normalized cache records are version 6 and exactly match their source size and mtime. “Messages” below is the existing real adapter's cached projection, including tools and excluding setup messages; these counts are not raw JSONL line counts.

| Session | Native path under `/Users/nicholasbardy/.codex/sessions/` | Bytes | Messages | User / assistant / tool |
|---|---|---:|---:|---|
| `01a08c55-6b5a-7e33-98b7-c7829ed6dd4c` | `2026/09/11/rollout-2026-09-11T01-20-03-01a08c55-6b5a-7e33-98b7-c7829ed6dd4c.jsonl` | 2,031,414 | 16 | 3 / 13 / 7 |
| `01a094c0-07bd-7802-8708-b0b885391205` | `2026/09/12/rollout-2026-09-12T16-33-28-01a094c0-07bd-7802-8708-b0b885391205.jsonl` | 1,902,041 | 26 | 1 / 25 / 20 |
| `01a094c7-5429-7fc3-9c91-0339c3b3bdd9` | `2026/09/12/rollout-2026-09-12T16-41-26-01a094c7-5429-7fc3-9c91-0339c3b3bdd9.jsonl` | 3,709,157 | 67 | 2 / 65 / 55 |
| `01a094f2-90d8-7db0-b9f4-d0f033e219be` | `2026/09/12/rollout-2026-09-12T17-28-39-01a094f2-90d8-7db0-b9f4-d0f033e219be.jsonl` | 1,176,245 | 12 | 3 / 9 / 4 |

Tools are included in the assistant count, not additional messages. Total: **121 messages, 9 user prompts, 112 assistant entries, including 86 tool calls**. These four sessions do not have `forked_from_id` metadata, and the prompts advance chronologically rather than repeating inherited history.

SHA-256, in the same order:

```text
b454a45cc56e688cc3a7d5ad57b19f97e48919c960b718f93c23d9eebfb6f736
23a413826a0375832260a16ea030f6e4a02dcfa8667d4f2a0e87cb4bebd78e3c
70ab38d86a5c0b4d945b6322e098bda00b274e1999e0f2b6afbef8115301d02e
996a8dc586c78b5328062ca421ee937ff9b385f0f9427faad7c40bcf74af8e73
```

Normalized cache files, same order, under `~/.agent-viewer/session-cache-v1/`:

```text
272b7b12e71f5c41a5e5f56d17e7f907c8c33c113d22c3535a36d6cae6ee13a2.json
4244c9fb97ec4977ce4e565042aaab6ea664f9253e8348f0f283bfe69e4d2644.json
8fa4c595594342a047eaca1e4e78f28ea66e4f4f9b4e75c963ff3bad7e995599.json
0efa29ee78ec7da6c3a015091021f2abf93032062601c4c28c27224760b491fa.json
```

## Timeline from the actual journal

Source: `/Users/nicholasbardy/.agent-viewer/observability/turn-attempts.jsonl`. Line numbers below were obtained by directly enumerating this single file, not recursive RTK search output. Dates/times are UTC; add eight hours for Bali/Makassar.

| UTC | Journal lines | Observed transition |
|---|---|---|
| Sep 10 17:20:03 | 3666, 3668, 3671 | Initial fresh execution binds `01a08c55…` under boot `140522e4-debc-449f-851a-a253c4366283`. |
| Sep 10 18:17:39, 18:23:46 | 3870, 3902 | Two follow-ups correctly use `execution.resume` for `01a08c55…`. |
| Sep 12 08:33:27–28 | 4027, 4029, 4032 | Queue has old `01a08c55…`, but execution is **fresh**, provisional `cfb2d6a0…`, then binds `01a094c0…`; boot `178c9c5e-5444-4257-878c-5e5a84d74088`. |
| Sep 12 08:41:26 | 4080, 4082, 4085 | Queue has `01a094c0…`, again **fresh**, provisional `616ddf16…`, then binds `01a094c7…`; same server boot. |
| Sep 12 08:49:15 | 4162, 4164, 4167 | First repair turn cancelled with `user_stop`; corrective owner input resumes the same `01a094c7…`. This was not a fresh-session rotation. |
| Sep 12 09:11:28 | 4275 | Repair turn succeeds with `provider_complete` in `01a094c7…`. |
| Sep 12 09:28:39–40 | 4293, 4295, 4298 | Screenshot complaint queues `01a094c7…`, but executes **fresh**, provisional `82ea4d97…`, and binds `01a094f2…`; new boot `ce71a588-8e6a-42da-a80c-3230a5b820e2`. |
| Sep 12 09:34:56, 09:35:25 | 4326, 4336 | “Hello” and “hello” both correctly resume `01a094f2…`, same new boot. |

The latest apparent empty resume therefore coincides with the first input after a backend restart. The repeated loss is not every input: the journal proves successful resumes between rotations.

## What the old conversation actually contains

The first transcript has the September 10 discussion about the `HOST OWNER CONTROLS` paragraph being appended to user messages. User entries are at lines 9, 64 and 103; assistant finals at lines 57, 96 and 108. The last asks whether that instruction belongs in Buddy context or the MCP tool descriptions rather than every message.

The September 12 16:33 local input, “Okay so wht is the fix? And is there any other issues like this?”, arrives in a fresh session. At line 12 the assistant says it needs Chronicle to identify the recent issue. Its final at line 194 / `2026-09-12T08:39:10.844Z` discusses five broader resource defects. The records support a real continuity failure in model context as well as the missing display history; the assistant's subsequent recovery introduced another thread's review into this conversation. Whether the owner intended that subject change is not established by the ambiguous follow-up alone.

The next transcript contains “Fix it all…” at line 9, the owner correction that Buddy mail is a disk-backed store at line 173, and the preserved repair final at **line 480 / `2026-09-12T09:11:27.477Z`**, beginning “Fixed all seven reproduced defects and consolidated memory, visibility, pagination, and retry handling.” It reports 302 tests and links `product/buddies/IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md`.

The current transcript's line 51 final explicitly says this application's ID matches the repair thread while earlier messages were not loaded. Its links point back to itself because stable application identity survived the native rotation.

## Reset triggers: evidence versus inference

The first Sep 12 reset follows the dev-supervisor startup at `2026-09-12T08:33:01.057Z`. The latest reset follows a new server process that started at **17:11:41 local**, just after the repair and its memory review completed. Both fit the runtime's deliberately unknown restored `_providerAudienceKey=null` fence; the server boots and fresh executions are directly logged. The precise key comparison was not logged in the pre-repair implementation.

The intermediate 08:41 reset happens within one boot after the 08:39 memory reviewer writes working/long-term/notes once each. Its saved review is `~/.agent-viewer/memory-reviews/6ce730b44f73c0f2b2d33463d45f97b20ec5e8ec4b3a5e4d97e22317a3d71055.json`, finished `08:39:43.334Z`. The transcript briefing generations progress 0 → 1. The then-current key algorithm included content revisions, so memory-write invalidation is strongly supported but remains an inference without recorded hashes/reason.

The repair's reviewer saved **zero writes**, finishing `09:11:40.722Z` (`f5b687da349d9adce9f6a02107a9c7d1ff9e1b2e97ebcdd0fa13495345786efc.json`). The latest reset should not be blamed on that review learning new content: the subsequent server restart is the direct distinguishing observation. After the current session's first turn the reviewer did write working + notes, finishing `09:30:20.834Z`, and the subsequent Hello turns still resumed. This is live evidence that ordinary learning no longer necessarily rotates the provider after the earlier resource repair.

## Live process and code boundary

At inspection:

- Supervisor PID 9372; concurrently PID 9528; watcher PID 9532.
- Backend PID 26438, parent 9532, started Sep 12 17:11:41 local.
- Backend argv: `/Users/nicholasbardy/.nvm/versions/node/v24.3.0/bin/node --import tsx src/server.ts`.
- `tools/watch-server.mjs:344` spawns this source path; rebuilding dist alone is not how this running development backend adopts a repair.
- Parent stdout ultimately points to `/dev/ttys000`; backend output is piped through concurrently. No separate persisted console log was discovered. The durable turn-attempt journal is the saved Unleashd execution evidence used above.

Before the parallel source fix, `server/src/lifecycle/session-loader.ts:153` rejects historical sessions during hydration, `:225–226` assigns current-source messages/date, and `:465–470` replaces inactive runtime messages/date from the current polled source. Dist has the same behavior (`server/dist/lifecycle/session-loader.js:86`, `:151–152`, `:366–371`). Historical bindings preserve identity but this loader does not reconstruct their visible messages. This matches the earlier independently reproduced rotate → poll → reload defect in [the history audit](2026-09-12-audit-history-cause.md).

The parent repair must validate restored API history/date after the existing watcher reaches its safe idle reload boundary. This audit does not claim that recovery already happened. It must retain the separation between owner-visible history and the model's audience-authorized context; preserving display history is not permission to replay all old context into a new model audience.

## Isolated recovery verification — 18:00 local

The repaired current source successfully reconstructs this exact target from its actual four native transcripts: **121 messages, 9 user prompts, 112 assistant entries including 86 tools**, original durable creation date, and the unchanged current native session. The original owner-controls question, the seven-defect repair final and both latest greetings are present. See [the verification result and source hashes](2026-09-12-aca48e0e-recovery-verification.json).

This verification used the real Codex adapter, runtime and session loader, with a copy of only this conversation's config in a temporary application directory, discovery restricted to its four actual native paths, and startup limit 1. No normalized cache was supplied. Provider execution and initial-message dispatch were explicitly forbidden in the harness and did not occur. All four native file hashes and the production configuration bytes were unchanged afterward. Temporary state was removed on completion. This proves the exact source data can be recovered through the repaired boundary; it does not claim the still-running production backend had reloaded.

An independent temporary desired-behavior test also checked two review findings: selecting an old native source with the current source attached for an externally discovered conversation, and preserving existing middle-session runtime rows when that middle native source is unavailable. The latter failed before the correction and both passed afterward. No repository source or test file was edited by this reviewer.
