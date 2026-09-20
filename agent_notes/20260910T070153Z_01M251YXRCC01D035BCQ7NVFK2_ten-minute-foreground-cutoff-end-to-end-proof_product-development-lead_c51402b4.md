---
kind: "evidence"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T07:01:53.036Z
trust: workspace_source
evidence: ["docs/incident-2026-09-10-buddy-chat-timeout.md","output/timeout-e2e-20260910/summary.json","output/timeout-e2e-20260910/buddy-authority.json","output/timeout-e2e-20260910/after-eleven-minutes.png"]
---
Owner correctly required end-to-end verification beyond the configuration and simulated-clock tests. Seven retained owner Buddy attempts across three conversations terminated at 599.870–600.078 seconds, all before corrected backend loaded at 06:26:35 UTC; each was active within 27 seconds of stop. Current conversation's actual attempt 61608db0-e4fc-45f3-8cac-0d27fa846327 started 06:49:19.788 UTC and stayed running through 684.459 seconds across 35 read-only samples: same Codex PID 97872, same server boot, same attempt, running/streaming true, no terminal cause. Six WS events arrived after 600 seconds. Browser showed Running 11m 32s at 07:00:53 UTC. Native get_runs succeeded at 07:00:52.767 with run buddy_run_275a1556-ae8b-42a7-bc39-657555ad5539 still running and deadline September 11 06:49:19.765 UTC. This is real wall-clock proof of the ten-minute regression fix, not a 24h soak. Earlier claim that someone manually stopped it was wrong: inherited foreground 600-second deadline called stop() and mislabeled user_stop.
