# Token cost follow-ups (filed 2026-09-25)

Direction: Channels replace long-running threads with many short, Slack-style
conversations. The cost to cut is now (a) cold start per conversation,
(b) re-discovery (re-reading the same files), and (c) duplicate context sent
to resumed conversations. Resume wherever there is continuity; send only
deltas; start warm.

## Done

- 5c081f5: a Buddy briefing is re-sent only when the memory generation changes
  (every turn re-sent ~20k chars since 5c0cec4).
- d49d2f5: Codex cached input is priced as cached; one Codex totals parser.
  Makes the UsagePanel usable for measuring everything below.
- Thread-delta commit: a resumed channel seat is sent only the posts since its last
  turn, minus its own replies (was: root + last 10 every turn).

## Next, in order

1. **Measure the before/after.** After the backend reload, compare tokens per
   channel reply and per Buddy turn against the Sep 20–24 sessions (e.g.
   `~/.claude/projects/-Users-nicholasbardy-git-basketball-model/94d99e8d-….jsonl`).
   Record: cold-start tokens per new seat, per-reply tokens on a resumed seat,
   cache-hit rate.
2. **Reset seats/threads bloated before 5c081f5.** Their transcripts still carry
   every duplicate briefing and re-read them per step until compacted or reset.
   Rank by `grep -c 'unleashd:buddy-context-v2 '` per session file.
3. **Cheap reply gate.** `channel-reply-gate.ts` asks each participant on the
   seat's model at the seat's effort, once per Buddy per post, for a yes/no.
   Options: lowest effort on the same harness (provider-bespoke effort values,
   pass-through rules apply), or one gate call per post that answers "who
   should reply?" for all participants. Measure gate share first.
4. **Warm start by forking a base session.** Keep one base session per
   (Buddy, memory generation, config) holding the briefing and a short repo
   orientation; fork it for each new thread seat instead of a cold start.
   Pieces exist: `providerSupportsFork`, the generation-match rule for native
   forks in `runtime.ts`. Claude forks natively, Codex emulates by rollout copy.
   The benefit depends on cache TTL (5 min–1 h), so it pays most when threads arrive in bursts.
5. **Resume workers by default.** A new work send for the same Task and Buddy
   continues the last completed worker thread (`continueFrom` exists but is
   model opt-in) unless config or memory generation differ or fresh is asked.
   Also: the interruption report (`run-executor.ts`, `history.slice(-60000)` of
   `JSON.stringify(messages)`) should resume the interrupted provider session
   instead of pasting up to 60KB of JSON.
6. **Seat rollover.** Seats now live as long as their thread. When a seat's
   context passes a threshold, open the next seat generation seeded with a
   summary (generations already exist for provider switches).
7. **Shared orientation notes.** A per-workspace repo map (via `remember_note`
   or a workspace doc) that warm starts include, so each conversation does not
   re-read the same files to orient.

## Smaller items

- `seenThrough` (channel-responder.ts) is in memory; after a restart each seat
  gets the full thread once. Persist it if restarts turn out to be frequent.
- Briefing JSON sections (relationships, owned work, activity) are
  pretty-printed; compact JSON is free.
- The 40k whole-briefing throw can still fail a send (section caps sum to ~39k
  plus unbounded published-doc refs). See REVIEW_2026-09-24.md.
- `estimateCost` applies Sonnet-class Claude rates to every Claude model.

## Deprioritized

SoL-Pi / Pi harness adoption and the `scope/` harness-internal mechanisms:
they target long single sessions, which is the model being moved away from.
Pi also has no documented MCP support, which Buddy tools require.
