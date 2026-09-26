# T15 runbook: live switch to lean/integration (owner-gated)

Dry run of every data step on a 2026-09-26 snapshot: `T15-dryrun.md` (all verifies ok).
Target: `origin/lean/integration` at its current HEAD (the final review ran on 6b5c6c1 plus the review/final fixes; f6f629b was the dry-run SHA). Paste the blocks in order in ONE zsh shell (the variables carry over).
Every block that can fail ends in a gate. If a gate prints `ABORT`, stop and go to ROLLBACK.

## 0. Prep (backend still RUNNING; nothing live is touched)

Two blockers found in the dry run. Clear them before any downtime:

- **The main checkout cannot take the merge as it is.** 38 files that the merge changes carry
  uncommitted edits from other sessions (App.tsx, Chat.tsx, the channel components, server.ts,
  runtime.ts, config-service.ts, routes.ts, shared/src/index.ts, vendor/agent-cli-tool, ...). `git merge`
  refuses, and stashing is forbidden here. Their owners must commit them (or you discard them) first.
- **The merge conflicts on 2 files** (`git merge-tree`, read-only):
  `client/src/mobile/channels/ChannelsMobile.tsx` (content) and
  `server/test/channel-conversations.test.ts` (modified here, deleted on lean). Resolve on a
  branch now, not during the downtime:

```bash
export PATH="$HOME/.nvm/versions/node/v24.3.0/bin:$PATH"
R=~/git/unleashd
L=$R/.claude/worktrees/t15-merge
git -C $R fetch origin lean/integration
git -C $R worktree add -b ops/t15-merge $L feat/channels-project-view-2026-09-22
cd $L && git merge origin/lean/integration      # resolve the 2 conflicts, then commit
pnpm install --frozen-lockfile --offline && pnpm --dir shared build
pnpm typecheck && pnpm test:server && pnpm test:client
# Import CLIs (only lean code has them). The .node addons are built in step 9.
# Since S12 (branch tools/addon-cache) each CLI is its own crate. If the merged tree predates S12
# (no crates/unleashd-buddies-import), use: cargo build --release --no-default-features --features cli
#   -p unleashd-buddies --bin buddies-import, then the same for -p unleashd-ingest --bin records-tool.
# CARGO_TARGET_DIR is pinned so a globally exported one cannot move the binaries away from $BI/$RT.
(cd $L/crates && CARGO_TARGET_DIR=$L/crates/target cargo build --release -p unleashd-buddies-import -p unleashd-records-tool)
BI=$L/crates/target/release/buddies-import; RT=$L/crates/target/release/records-tool
ls -la $BI $RT && git -C $L rev-parse HEAD      # note this SHA: it is what you will run
```

Also decide on the queued runs (step 6) before you begin.

## 1. Stop the backend

```bash
PRE=$(git -C $R rev-parse HEAD); echo "rollback target: $PRE"
cat ~/.agent-viewer/dev-supervisor.lock.json     # the supervisor pid
# Ctrl-C the `pnpm dev` terminal, or: kill -INT <pid from the lock file>
# Running Buddy turns end here. v33 recovery would mark them interrupted; the new server does so at start.
lsof ~/.buddies/buddies.sqlite ~/.buddies/buddies.sqlite-wal 2>/dev/null | grep -v '^COMMAND' \
  && echo 'ABORT: something still holds the v33 DB' || echo 'ok: v33 DB closed'
lsof -iTCP:7499 -sTCP:LISTEN >/dev/null && echo 'ABORT: API port 7499 still listening' || echo 'ok: API down'
```

## 2. Backups (consistent copies; the live files are not modified)

```bash
T=$(date +%Y%m%dT%H%M%S); BK=~/unleashd-t15-backup-$T; mkdir -p $BK
sqlite3 ~/.buddies/buddies.sqlite "VACUUM INTO '$BK/buddies-v33.sqlite'"
sqlite3 $BK/buddies-v33.sqlite 'PRAGMA integrity_check' | grep -qx ok && echo 'ok: backup intact' || echo 'ABORT: backup corrupt'
cp -c -R ~/.agent-viewer/conversation-config $BK/conversation-config      # APFS clone (untouched live copy)
cp -c ~/.agent-viewer/owner-channel-reads.json $BK/
# Records staging: the v1->v2 migration rewrites files, so it runs on a second clone, never on live.
C=$BK/records-import; mkdir $C
cp -c -R ~/.agent-viewer/conversation-config $C/
ln -s ~/.agent-viewer/session-cache-v1 $C/session-cache-v1    # read only by the migration
ls -la ~/.buddies/buddies-v3.sqlite ~/.agent-viewer/conversation-records.sqlite 2>/dev/null \
  && echo 'ABORT: a target already exists (see ROLLBACK "retry")' || echo 'ok: targets absent'
```

## 3. Imports

```bash
B3=~/.buddies/buddies-v3.sqlite; CR=~/.agent-viewer/conversation-records.sqlite
$BI import --from $BK/buddies-v33.sqlite --to $B3 --report $B3.import.json \
  --owner-reads ~/.agent-viewer/owner-channel-reads.json
cd $L && pnpm --dir server exec tsx src/conversations/record-migration.ts $C   # exit 0, 0 failures
$RT import $C/conversation-config/v1 $CR
```
A failure here needs no cleanup of its own: step 4 then fails and removes both targets. Since the
final review, `records-tool` refuses a source without `by-conversation/` (a wrong path used to
import and verify zero records as ok=true).
Not imported by design (DESIGN.md "Deleted outright"): sprints, work_items, skills, delegations,
reviews, approvals, builder_creations, access grants, mail, checkpoints. Their rows stay only in
`$BK/buddies-v33.sqlite`; to see what that drops:
`for t in sprints work_items buddy_skills buddy_delegations buddy_reviews buddy_approval_requests buddy_builder_creations buddy_access_grants buddy_mail_effects buddy_mail_inbound buddy_checkpoints; do echo "$t $(sqlite3 $BK/buddies-v33.sqlite "select count(*) from $t")"; done`

## 4. Verifies (the gate)

```bash
$BI verify --from $BK/buddies-v33.sqlite --to $B3 --import-report $B3.import.json --out $B3.verify.json; BV=$?
$RT verify $C/conversation-config/v1 $CR; RV=$?
jq -e '.failures|length==0' $C/conversation-config/v1/migration-v2-report.json >/dev/null; MV=$?
if [ $BV -eq 0 ] && [ "$(jq .ok $B3.verify.json)" = true ] && [ $RV -eq 0 ] && [ $MV -eq 0 ]; then
  echo 'GATE PASSED'
else
  echo 'ABORT: verify failed; removing the new files'; rm -f $B3 $B3-wal $B3-shm $CR $CR-wal $CR-shm
fi
```
Expected (dry run): every Buddies line `ok`, soul_files `{"match":45,"match_no_header":4,"no_path_empty":3}`;
records `ok=true ... 1/1 rejects byte-equal` (the one reject is a stray by-session `.tmp` file).

## 5. File placement

Both imports wrote straight to the paths the server opens, so nothing moves. Check:
```bash
ls -la $B3 $B3.import.json $B3.verify.json $CR $CR.import.json $CR.verify.json
env | grep -E 'UNLEASHD_BUDDIES_DB|UNLEASHD_DATA_DIR' || echo 'ok: default paths'
# Keep ~/.buddies/buddies.sqlite and ~/.agent-viewer/conversation-config untouched (rollback source).
```

## 6. Optional: cancel queued runs (before start, or the runner takes them)

The same UPDATE the server's `cancel_run` does for a queued run. List what is queued now (the ids
below come from the 2026-09-26 snapshot, so re-check them):
```bash
sqlite3 -separator ' | ' $B3 "SELECT r.id, r.input_kind, b.slug, b.background_enabled, substr(r.created_at,1,16)
  FROM run r JOIN buddy b ON b.id=r.buddy_id WHERE r.status='queued' ORDER BY r.input_kind, r.created_at"
```
Recommended: cancel groups A, B and C; let D run. See T15-dryrun.md for the reasons.
```bash
cancel() { sqlite3 $B3 "UPDATE run SET status='cancelled', error_code='user_stop',
  ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='queued' AND id IN ($1)"; }
# A: 12 failure notices (6 'Parent Buddy conversation does not match' bugs, 5 capacity 'held', 1 about a completed run)
cancel "SELECT id FROM run WHERE status='queued' AND input_kind='failure_notice'"
# B: stale requests: fa2b 'Acceptance/refusal ... geometry handoff' (12 d), d1c6 svg lane check-in (5 d, held: background off)
cancel "'buddy_run_a59ec7c0-cad2-447c-b55f-e9746ff613c5','buddy_run_81cbaa21-bda3-4c67-b028-bccd6251fe19'"
# C: 4 basketball PM Season Readiness replies (1 d) -- cancel ONLY if that plan is no longer current
# cancel "'buddy_run_a2016321-bc0e-41a5-affb-f4eb2f17f297','buddy_run_607b7357-e651-4d15-9285-4e58d6666cba','buddy_run_a5c5141f-fbaa-4f9a-993c-0f833cfebb1e','buddy_run_bbe2d381-2078-45fe-a059-089523908049'"
# D (run): fa2b W2-E redesign reply, 8f4d 'speed project on Opus 5.5' reply (owner-directed, same day)
sqlite3 $B3 "SELECT status, count(*) FROM run WHERE status IN ('queued','cancelled') GROUP BY status"
```

## 7. Merge lean/integration into the working branch

Needs step 0: overlapping dirty files committed, and ops/t15-merge resolved and green.
```bash
cd $R && git status --porcelain | wc -l                       # overlapping edits must be gone
git merge --ff-only ops/t15-merge || echo 'ABORT: not a fast-forward; merge ops/t15-merge by hand'
git log -1 --oneline
```

## 8. Install + stale-extract check

```bash
cd $R && pnpm install --frozen-lockfile --offline
readlink node_modules/@unleashd/buddies-core      # -> ../../crates/unleashd-buddies
readlink server/node_modules/@unleashd/buddies-core
ls node_modules/@nbardy/buddies 2>/dev/null && echo 'ABORT: old @nbardy/buddies extract still linked' || echo 'ok: old package gone'
pnpm --dir shared build
```

## 9. Build the crates (the .node addons)

```bash
cd $R && pnpm addons    # ensure-addons: cache copy when built before, else a cargo build (S12)
# pre-S12 tree (no `addons` script): pnpm --dir crates/unleashd-buddies build && pnpm --dir crates/unleashd-ingest run build
ls -la crates/unleashd-buddies/*.node crates/unleashd-ingest/*.node   # fresh mtimes
pnpm typecheck
```

## 10. Start

```bash
cd $R && pnpm dev 2>&1 | tee $BK/first-start.log
```

## 11. Post-start checks (second terminal)

```bash
BK=~/unleashd-t15-backup-<T>; TOKEN=$(cat ~/.agent-viewer/auth-token); A=http://127.0.0.1:7499
api() { curl -s -H "Authorization: Bearer $TOKEN" "$A$1"; }
grep -n 'Initial load complete\|record\|Buddies database\|recoverRuns\|interrupted' $BK/first-start.log | head
#   load time: seconds from supervisor start to 'Initial load complete' (T23b listing: <0.5 s for 8,180 records)
api /api/buddies/overview | jq 'keys'
api /api/buddies/workspaces/project_c674a684-463d-447e-990d-73160bedd698/channels | jq 'length'   # buddies repo: channels
api /api/buddies/workspaces/project_c674a684-463d-447e-990d-73160bedd698/inbox | jq '.|length'    # DMs
api /api/buddies/buddy_6682c1e0-bafc-4996-8f96-4e743a8a2a7b/docs/long_term | jq '.|length'         # growth-lead memory
api /api/buddies/buddy_6682c1e0-bafc-4996-8f96-4e743a8a2a7b/docs/soul | head -c 300
sqlite3 -readonly ~/.buddies/buddies-v3.sqlite "SELECT status,count(*) FROM run WHERE created_at > '$(date -u +%Y-%m-%d)' GROUP BY 1"
pnpm errors:list --limit=30          # stall monitor: look for 'event-loop' entries; Buddy/record errors
```
Then in the UI: sidebar conversation list complete, #channels shows posts and threads, DMs open,
a Buddy's Memory tab shows notes, one Buddy DM round-trip gets a reply.

## ROLLBACK

v33 and `conversation-config` are never written after step 1, so rollback is code only.
Anything written after the switch (Buddy posts, config changes) lives only in the new files and is lost.
```bash
# stop the backend (step 1), then:
cd $R && git revert --no-edit -m 1 HEAD   # HEAD = the t15 merge commit; reset/--hard is forbidden here
git diff --stat $PRE HEAD | tail -1      # expect no difference in code (only the merge's own conflict edits, if any)
pnpm install --frozen-lockfile --offline
readlink node_modules/@nbardy/buddies  # must be back; if it is an old extract see AGENTS.md (stale vendor tgz)
pnpm --dir shared build && pnpm dev
```
Keep the new files for diagnosis: `mv ~/.buddies/buddies-v3.sqlite* ~/.agent-viewer/conversation-records.sqlite* $BK/`.
**Retry** a failed import: the importers refuse an existing target, so remove it first:
`rm -f ~/.buddies/buddies-v3.sqlite* ~/.agent-viewer/conversation-records.sqlite*`, then from step 2.
