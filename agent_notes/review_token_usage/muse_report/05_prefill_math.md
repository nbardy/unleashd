# 05 — Prefill math: does cache-busting matter? (2026-09-18)

Question: memory updates bust cache — but how much does prefill really cost
vs output?

## Measured cost split (unleashd Claude, Sep 14–18, 401 assistant msgs)

| Bucket | Tokens | Price/1M | Cost | Share |
|---|---|---|---|---|
| Cache-read (re-read) | 69,231,646 | $0.30 | $20.77 | 49% |
| Cache-write (new prefix) | 3,262,623 | $3.75 | $12.23 | 29% |
| Output | 634,139 | $15.00 | $9.51 | 22% |
| Base input (uncached) | 7,432 | $3.00 | $0.02 | ~0% |

**Prefill (read + write) = 78% of the bill. Output is only 22%.**
Per average turn (~173k context): read $0.052 + write $0.030 + out $0.024
≈ $0.11/turn. The intuition "outputs cost more" is wrong at these context
sizes — $0.30/1M × 69M beats $15/1M × 0.6M.

## Do memory updates bust the cache? No — structurally impossible here

Briefing/memory enters the prompt ONLY on first/refresh turns
(`runtime.ts:609`). Steady-state turns never resend it, so a memory edit
cannot invalidate a running thread's cache. Paranoid upper bound: even
re-sending a 10k-token briefing EVERY turn = 10k × $3.75 ≈ $0.04/turn,
~1/3 of a normal turn. Negligible either way.

## The only bust-like events: 14 turns, all in the hot thread

`~/.claude/projects/-Users-nicholasbardy-git-unleashd/a9c26a65-….jsonl`
holds 14 messages with writes of 27k–318k tokens against only ~10k of
read benefit (i.e. paid full write price, ~zero cache reuse), several with
byte-identical (write, read, out) triplets repeated 3–4× — smells like
compaction boundaries, giant single tool results (~318k tokens ≈ 1.2MB of
text), or duplicate-reported retries. Together ≈ $7.50, ~60% of ALL write
spend, from 3.5% of messages. Everything else (387/401 msgs) is
steady-state: ~8k avg writes under ~173k avg reads.

Even so, all busts combined ($7.50) are dwarfed by cumulative re-read
($20.77). Repetition, not invalidation, is the bill.

## Live-thread warning

Between two measurement runs ~40 min apart, `a9c26a65` grew by 62 msgs /
+20M cache-reads. Something is burning ~$10/hr on that thread RIGHT NOW
(Sep-17 fable: 96 → 158 msgs). If that is an unattended run, stop or
compact it first — it is currently the single biggest line item.
