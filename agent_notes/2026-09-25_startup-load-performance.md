# 2026-09-25 — startup/load performance pass

Trigger: after `pnpm dev` the UI took minutes to load ("used to be lightning
fast"). Log showed `Parsed 500 files ... max=114799.8ms`, a backend reload
mid-startup, and the history loading twice.

## Findings

1. **Machine memory is the dominant factor.** Load avg 150-400 on 10 cores,
   24GB RAM full, swap 8.7/10GB, ~295M swap-ins. A 10s CPU profile of the idle
   live backend got 1.2s of samples (all idle): the OS barely scheduled it.
   Same 120MB transcript parsed in 15s under load vs 0.8s later. Check swap
   before hunting a code regression.
2. **No rollback.** Cache + startup barrier unchanged since Jul/Aug. The code
   had costs that grew with history (7,700 sources, 7,800 config records):
   - binding lookup: filename predicate over every source per binding;
   - config records: two full scans per boot (lookup index, then recovery),
     the first one blocking discovery;
   - `mergeSessionMessages` JSON-stringified every row even for one transcript;
   - serial recovery of ~765 transcript-less records, 3+ reads each;
   - chmod of all 13k session-cache records on every boot.
3. **Double load was a watcher bug** (new in 24f7a49): `tsc --watch` truncates
   then rewrites; the runner digested per fs event and saw the empty file.
4. **Recovered conversations were never broadcast**, so a client connected
   during startup missed ~765 app-created threads until reconnect.
5. **Reloads waiting on running turns is by design since 2026-02-25**
   (59c6330). Detach + re-adopt-from-JSONL lived ~3 weeks in Feb. A new
   backend cannot adopt parent-owned provider pipes; restoring
   restart-survival needs a durable per-turn event log. Not started.
6. **First open of a conversation is fast in a fresh browser** (0.3-0.85s for
   800-1,100 messages; server detail 11-424ms; client zod 3-12ms; still
   virtualized). Slowness in the user's tab = swapped tab memory. If a fresh tab
   is fast and the old one slow, look for a client leak next.

## Commits

| Commit | Change |
|---|---|
| dfb1c0b | Watcher judges reloads after writes settle, against a fixed loaded baseline |
| 426cde0 | sessionFileKeys index; single-source merge fast path; non-blocking lookup scan; scope-served list(); 16-wide recovery; hydrate without re-read |
| 5c9aa90 | Broadcast recovered conversations in batches |
| e1752df | Startup cost rules in docs/architecture.md; tripwire tests; drop boot chmod, unused loader options |
| f4a8984 | One-process dev runtime (tools/dev-runtime.mjs): compilers, Vite, backend runner in the supervisor; 18 → ~5 processes; backend/Vite start after first compile |
| f530d3a | Prune session-cache records for deleted sources (after complete discovery only); recovery dispatches only pending first messages |
| e9821bf | A discovery readdir/stat error marks the provider failed instead of reading as empty; a failed poll keeps its baseline (was: full re-parse of that provider next poll) |
| 21f48fe | (subagent) Browser opens once per launch: tests/agent-started servers never open; Vite restarts do not reopen |

Measured on an APFS clone of the real data dir (recipe in memory
`unleashd-profile-startup-on-cloned-data`): barrier 67-102s → 14-20s at
similar load; config record reads 20.5k → ~10k; record updates 1,139 → 303;
session cache 13,375 → 7,475 records (787MB → 487MB). Live heap after GC
~140MB (RSS ~630MB is uncollected parse garbage).

Every change has a test verified to fail with the change reverted, except the
merge fast path (exact, perf-only; comment at the site).

## Open

- f4a8984 is first exercised by the next `pnpm dev` / `dev:replace`
  (interrupts running turns). Components were smoke-tested on spare ports.
  Rollback: `git revert f4a8984`.
- `concurrently` is still a root devDependency; removing it rewrites the
  lockfile (Vite re-optimizes deps next start).
- Worker-thread parsing of cache misses: ~5s on miss-heavy boots; not worth it
  while the machine is oversubscribed.
- Discovery stats every source (~2s idle, 18s under load) before the first
  batch; a persisted discovery snapshot could emit the first batch sooner.
- Restart-survival for turns (see finding 5).
- Stale processes seen: three `wave_sim-*` vinext/workerd dev servers from
  2026-09-23 (one workerd orphaned) and an orphaned agent-browser daemon; not
  killed (user's call).

## History note

c5e4f91 (a concurrent channels commit) reverted f530d3a's five server files,
most likely by committing a stale copy of them. 16145ce ("docs: …") restored
them because they were still staged; after it, those files equal f530d3a
(`git diff f530d3a 16145ce -- <files>` is empty). If a bisect lands on
c5e4f91, that is why the cache prune briefly vanished.
