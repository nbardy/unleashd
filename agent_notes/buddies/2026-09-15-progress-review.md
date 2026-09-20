# Buddies progress review — September 15, 2026

Owner request: understand what we did, how it is doing, and what updates are warranted. This is a bounded assessment, not a new implementation assignment. Native Tasks remain authoritative for current status.

## What the evidence establishes

- The lean Worker delivery includes reusable helpers, correlated background lead returns, a bounded interruption report, and Task comments. The September 14 implementation record preserves actual Codex normal/timeout artifact-reading and lead-acceptance evidence, with concurrent human follow-up. This is one-provider historical evidence, not a new live-provider run today.
- Native release Task `buddy_project_612461f5-631f-4fa9-950e-77f6d8cccc7c` revision 2 records the verified stack landing on main. A fresh `git ls-remote origin refs/heads/main` returned `7f41bf50b28f9c1c2824e42deab482b319541bfd`. Its recorded verification is 361 server passes/5 optional skips and 91 client passes. These are historical integrated-tree results.
- Final restart-continuity corrections exist in the shared checkout and passed today's real config/adapter/loader/runtime fixture. They are not in that main commit. Direct `git show main:<path>` byte comparisons, rather than the misleading untracked-file deletion display in `git diff`, establish the distinction. The main creation service lacks `buddyAudienceKey`; local creation-service, session-loader and the extended history test match the September 15 closeout hashes.
- The loaded native read contract is `2026-09-15.1`. Work summary/full expansion, recent/outstanding inbox filters and team summaries are callable. The loaded send schema advertises assignment-specific canonical provider/model/effort selection, pinning and continuation-conflict behavior. Current source contains its resolver/admission integration. No assignment was sent or previewed during this review, so actual provider-selection end-to-end acceptance remains unproven here.
- On the same four current Lead projects, normalized summaries measured 3,400 serialized characters versus 17,463 for full reads (about 80.5% fewer). Complete MCP envelopes measured 7,120 versus 35,888 characters. Individual tool-call elapsed samples were 48 ms and 95 ms; this is not a latency benchmark or token/cost measurement. This is not the original Wave_sim four-project corpus.
- The isolated large-history MCP fixture measured 564,726 full versus 3,190 summary characters, retained full expansion and privacy, and rejected stale work cursors. `updatedSince` is explicitly not a deletion feed; these checks do not establish a complete lossless incremental event stream.
- Native team observation still reports token/cost usage as unavailable and queue/claim intervals only. The six visible historical managed records are terminal; the three original September 12 repair requests failed at 600 seconds, have no successor and have zero remaining seconds. This is scoped coordination state, not a census of foreground chats or operating-system processes.

## Fresh check results and limits

Command: `pnpm exec tsx --test server/test/buddy-efficiency-reads.test.ts server/test/buddy-worker-mode.test.ts server/test/buddy-task-comments.test.ts server/test/buddy-blocked-recovery.test.ts server/test/session-history-rotation.test.ts`.

Initial run: 5 passed, 1 failed. Worker reuse, comments, blocked-work recovery, restart/history and compact work passed; the inbox/recent assertion failed. Source files were concurrently edited/formatted during inspection: the efficiency test hash changed from `6c937bc9303583bd657e6e397e601ef2adce58286ec6657e5c8e1fe4a7cfb5de` to `3de619b589418d09a327a6379220bf6d8de6ff25a1feffa98eeffefccdc69b64`. A subsequent efficiency-only run passed both tests. The cause of the transient failure is not established; do not silently erase it or call it a reproduced persistent defect.

Server `pnpm -C server exec tsc --noEmit` passed. No source was modified by this review and no full-suite, browser, deployment, fresh live-provider assignment or cost-savings claim follows. Current package archive matches provenance SHA-256 `961e14438ee1afea02252d5e030bbdbba377a140ca1b3f3c39431097f1d4db0f`, source commit `631829b62ae6a6f706e3fb9b171e85a387ccbebe`.

## Recommended updates and rationale

Decision-maker: assistant. Status: recommendations for the owner's requested assessment, not owner acceptance of new mechanisms.

1. **Finish delivery reconciliation first.** Preserve and integrate the final local restart corrections through the existing delivery work. The current main commit and the newest locally verified fixes differ. A completed local fix and a pushed earlier stack are separate facts.
2. **Update the existing efficiency Tasks with current evidence.** The plan is already behind the loaded summary and assignment-selection surfaces. Qualify and finish those slices rather than starting duplicate implementation. Use a stable source/build snapshot and finish the missing original-corpus, envelope, compatibility and actual-admission checks before marking either child complete.
3. **Next implement trustworthy usage reporting, then bounded review coalescing.** Both have existing child Tasks. Missing usage means we cannot yet judge total cost per accepted result. Retain every individual return and existing limits when reducing redundant wakeups. Do not add another scheduler or billing ledger merely to fill missing fields.
4. **Reconcile stale backlog and orientation.** The old repair requests really failed, but later independent implementation and release succeeded. Assess each old Task against its own criteria before closing or superseding it, and replace obsolete next-action guidance with references to the supported recovery contract. Keep the original failure history intact. Durable memory should point to the successor evidence without copying current task status or widening private-memory access.

Earlier core-design reasoning still holds: Buddies retain identity, Tasks own work, Mail carries directed communication, files hold artifacts, and conversations own session context. The new evidence changes completion/provenance claims and the priority of qualification; it does not justify a new architecture. Revisit these recommendations if a stable build fails the boundaries, the original consumer fixture misses the payload target, a requested selection differs from actual invocation, or measured review/usage data identifies a different bottleneck.

## Historical evidence

- [Review measurements and check output](2026-09-15-progress-review.evidence.json).
- Lean Worker implementation: `agent_notes/buddies/20260914_lean-workers-implementation.md`, with preserved full source/test snapshot `20260914_lean-workers-implementation.evidence.json` and actual provider traces in `20260914_worker-return-live-evidence/`.
- Restart successor: `agent_notes/buddies/2026-09-15-restart-continuity-closeout.md`, SHA-256 `134afc8dd1685406e331974128735c39d45304c5c7133ad1e7c8eb2ad112d66c`; incremental patch SHA-256 `28df05fbacf9db2b696cb3ec0c6e6e304f736f802b96baa80ba4f94e533b0ab9`.
- Efficiency plan sources: `agent_notes/buddies/2026-09-15-efficiency-sources.json`, SHA-256 `0cf628e511a726dc1de2c52e431ac2191980ceb55932e12f8d37c25605fa4345`; includes full preserved handoff, review and core design text.

