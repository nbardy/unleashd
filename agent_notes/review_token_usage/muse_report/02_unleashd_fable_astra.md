# 02 — Unleashd Fable/Astra numbers (Sep 14–17, UTC)

Models: Fable = `claude-fable-5-1` (`server/src/providers/claude.ts:6`);
Astra = `gpt-6-astra` (`server/src/providers/codex.ts:12`).

## Claude, project `-Users-nicholasbardy-git-unleashd`

Source: `~/.claude/projects/-Users-nicholasbardy-git-unleashd/*.jsonl`,
`type=assistant` + `message.usage` lines with `timestamp >= 2026-09-14`.
Pricing 3/15/0.30/3.75 per 1M (same as `GET /api/usage`).

| Day | Model | Msgs | In | Out | Cache-read | Cache-write | Est $ |
|---|---|---|---|---|---|---|---|
| Sep 16 | fable | 87 | 2,424 | 72,976 | 6,231,916 | 279,625 | $4.02 |
| Sep 17 | fable | 96 | 2,832 | 230,660 | 23,945,901 | 1,032,780 | $14.53 |
| Sep 16 | opus-5 (context) | 156 | 312 | 139,208 | 18,503,334 | 411,394 | $9.18 |

Fable total: 183 msgs, ~30.2M cache-read, **~$18.55**. No unleashd Claude
activity Sep 14–15. All-unleashd-Claude total: $27.73.

Top conversation files (>= Sep 14, by cache-read+in+out):

- `~/.claude/projects/-Users-nicholasbardy-git-unleashd/a9c26a65-be2f-4f1d-854b-b6ee01de6b73.jsonl`
  (42.8M, mixed opus-5 + fable-5-1 — the biggest unleashd thread in window)
- `~/.claude/projects/-Users-nicholasbardy-git-unleashd/6a72850a-b80c-43d8-ab6a-51782f780fd1.jsonl`
  (6.3M, pure fable-5-1)

## Codex, `session_meta.cwd` contains `unleashd`

Source: `~/.codex/sessions/2026/09/*/*.jsonl` with mtime >= Sep 14;
usage = last cumulative `event_msg`/`token_count` per file (same rule as
`server/src/http/usage-routes.ts:376-384`); day = filename date.
Pricing 2.50/10 per 1M, no cache discount.

| Day | Model | Sessions | Input | Output | o/w cached | Est $ |
|---|---|---|---|---|---|---|
| Sep 14 | astra | 9 | 61,699,370 | 133,523 | 60,297,728 | $155.58 |
| Sep 15 | astra | 20 | 49,706,715 | 260,230 | 46,650,240 | $126.87 |
| Sep 16 | astra | 5 | 17,639,313 | 69,348 | 16,992,768 | $44.79 |
| Sep 14 | sol-5.6 | 2 | 8,940,682 | 29,040 | 8,634,368 | $22.64 |
| Sep 15 | sol-5.6 | 4 | 30,637,763 | 99,944 | 29,507,712 | $77.59 |
| Sep 16 | sol-5.6 | 18 | 163,108,729 | 517,974 | 158,902,912 | $412.95 |
| Sep 16 | luna-5.6 | 1 | 3,769,793 | 21,577 | 3,564,800 | $9.64 |

Astra total Sep 14–16: 34 sessions, ~129M input, ~463k output, **~$327**.
All unleashd-codex: 60 sessions, 344M in / 1.17M out, **~$873** (includes one
Sep-13-dated file with in-window mtime, 1 astra session / $22.62). Zero
unleashd-cwd Codex sessions Sep 17 so far. Window-wide Codex session-model
histogram (all cwds): astra 256, sol 70, luna 32, auto-review 15.

Top conversation files (unleashd cwd, by input+output):

- `~/.codex/sessions/2026/09/16/rollout-2026-09-16T11-10-36-01a0a831-e0e1-71c1-bf29-f72ab71302b8.jsonl`
  (40.0M in, 115k out, cwd `/Users/nicholasbardy/git/unleashd`)
- `~/.codex/sessions/2026/09/16/rollout-2026-09-16T11-10-36-01a0a831-e0f4-7de1-abed-080bf648729a.jsonl`
  (23.2M in, 70k out)
- `~/.codex/sessions/2026/09/14/rollout-2026-09-14T12-28-07-01a09e2c-213e-7781-b8e4-ee69f603091f.jsonl`
  (19.6M in, 31k out)
- 7 more in the 11–17M range — see session log for full list
  (16th 11:12 x2, 14th 18:10, 15th 22:46, 16th 13:48, 15th 22:01, 15th 21:29).

## Reading

- Codex/Astra (~$327/34 sessions) outweighs Claude/Fable (~$19) on unleashd
  in-window; Sep-16 Codex sol ($413/18 sessions) is the single biggest chunk.
- The pattern matches driver #1: inputs are ~97% cached re-read, outputs
  small — burn = long threads re-priced every turn, not giant fresh prompts.
- Existing surfaces: `client/src/components/UsagePanel.tsx` (7/30/90d views),
  `GET /api/usage` (`server/src/http/usage-routes.ts`, 571 lines). Neither
  attributes per-buddy/per-MCP — see 03.
