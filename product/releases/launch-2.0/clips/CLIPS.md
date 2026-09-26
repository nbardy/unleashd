# Launch 2.0 clips bank

Finished, cut clips ready to drop into the assembly: one `.mp4` per clip, plus a `.jpg`
poster frame. The renders are regenerable and gitignored; this index is the committed record.
Refill the bank with `edit/bank.sh`, after re-rendering whatever changed with
`pnpm run render:<clip>` in `edit/`.

The number prefix is the clip's place in the launch script
(`product/releases/UNLEASHD_2_0_LAUNCH_2026-09-26.md`), so a sorted folder reads in running order.

## In the bank

| Clip | Length | Beat | Shows | Built from | Status |
|---|---|---|---|---|---|
| `01_overload-open` | 18.0 s | 1–5 | Chat windows pile up, hard cut to "AI Overload!", then the calm "Introducing… 2.0", with sound | motion graphic, `edit/src/Overload.tsx` | Draft 2 + sound, marimba locked |
| `02_design-iteration` | 15.35 s | 6 | Workspace-home redesign, then emblems, then the owner types "Great work!" | footage A + B, `edit/src/DesignIteration.tsx` | Rough cut 1, silent |
| `03_design-review` | 13.0 s | 6–7 | The owner asks for screenshots of every view; ~6 min later the Lead posts Mobile, iPad and Desktop threads; three screenshots held (iPad Buddies, iPad channel, Desktop Buddies) | footage D, `edit/src/DesignReview.tsx` | Rough cut 3 (holds instead of long scroll), silent |
| `09_beat9-harness-and-close` | 7.0 s | 9 | "Multi harness", logos, "Bring your own subscriptions" slides | `beat9/beat9.html` | Motion v2 |

## Being cut elsewhere

| Clip | Beat | Where |
|---|---|---|
| Native multimedia ("Code + Design + Marketing!"), with the EDM bed | 6–7 | `edit/src/NativeMultimedia.tsx` + `sound/edm.py`, in the #unleashd-2 thread about the 3:41 AM recording |
| Multi harness, picking harnesses in the composer (4:26:44 PM upload) | 9 | not started |

## Raw takes, 2026-09-26 (owner's Desktop unless noted)

Renamed copies of the used takes live in `../footage/`, with their timecodes in `../footage/FOOTAGE.md`.

| Take | Length | What it is | Used as |
|---|---|---|---|
| 3.38.07 AM | 12.0 s | #channels-feature: scrolls the redesign request to the emblem request | footage **A**, clip 02 |
| 3.41.00 AM | 21.1 s | #channels-feature: emblem thread, contact sheet, image viewer (a longer take of B) | spare for clip 02 |
| 3.41.29 AM | 19.3 s | Emblem response, then "Great work!" | footage **B**, clip 02 |
| 4.06.39–4.08.52 PM (7 takes) | 4.5–18.4 s | "@Marketing Designer can you share the latest video…", typed; none shows the send | native multimedia, footage 1 (4.08.03) |
| 4.14.27 PM | 19.4 s | Request typing that opens the **per-mention harness / model / thinking picker** (Claude, Codex, Cursor…) around 7–12 s | unused, **good for beat 9 (multi harness)** |
| 4.15.21 PM | 6.7 s | Mention autocomplete (Task list), then a false start | unused |
| 4.15.32 PM | 12.0 s | False start ("Can you post a full s…"), cleared | unused |
| 4.15.51 PM | 27.9 s | The full screenshots request typed, not sent (rehearsal for D) | spare for clip 03 |
| 4.16.28 PM | 7:22 | Screenshots request, sent; ~6.5 min wait; Mobile, iPad and Desktop threads land and are opened | footage **D**, clip 03 |
| 4.26.44 PM (channel upload) | — | Selecting harnesses at the bottom of the composer ("multi harness") | not cut yet |

## Privacy before publishing

Real channel names, Buddy names, owner messages and a localhost URL containing the workspace
id appear in the raw frames. The cuts blur most of this, but check every frame of a clip
before it goes public.
