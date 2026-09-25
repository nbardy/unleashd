# Launch 2.0 edit (Remotion)

Timelines as code. Remotion for the cut, ffmpeg underneath. Raw recordings stay in
`../footage/` (the public dir, see `remotion.config.ts`); renders go to `out/` (gitignored).

```bash
pnpm install --ignore-workspace          # standalone: not part of the repo's pnpm workspace
pnpm studio                              # scrubbable preview in the browser
pnpm run render:overload                 # -> out/overload.mp4 (beats 1–5, 18 s)
pnpm run render:design-iteration         # -> out/design-iteration.mp4 (1920×1080, 60 fps)
```

Licence: Remotion is source-available and free for individuals and companies of up to 3
employees; a bigger company needs a paid licence (see `LICENSE.md` in `~/git/remotion`).

## Overload — beats 1–5, the open

Source: `src/Overload.tsx`; type motion shared with beat 9 in `src/blocks.tsx`.
Motion draft 1, 2026-09-26: 18.0 s.

| Out (s) | Shot |
|---|---|
| 0.25–4.2 | One chat window, centre. "Refactor the auth module and add tests" is typed, sent (bubble pops), "Thinking…", then it minimizes to the top-left tray |
| 4.1–6.4 | Second window, faster: "Why is CI failing on main?", then it minimizes too |
| 6.2–11.2 | The ramp: arrivals 2, 4, 8, 16, then 30 a second (`GAPS`), 60 windows, each typing and sending. Camera pushes in, shake from 9.2 s |
| 11.7 | Hard cut to black. "AI Overload!" at 12.05, "We're all feeling it." at 12.65 |
| ~13.4–15.0 | Room for the voice line, "Don't worry, we've got you covered." |
| 15.0–18.0 | Plate fades to `#002b36`: "Introducing", the 3D wordmark, a "2.0" sticker |

The chat windows are generic on purpose: six made-up skins, no real app UI or marks, so the
first thing that looks like Unleashd is the title. Arrival times are the music grid: when
the track lands, move `T` and `GAPS` onto its beats.

## DesignIteration — beat 6, "screenshots of the app being developed"

Source: `src/DesignIteration.tsx`. Cuts and camera are the `CUTS` and `CAMERA` tables.
Rough cut 1, 2026-09-26: 15.35 s.

| Out (s) | Source | Speed | Shot |
|---|---|---|---|
| 0.0–2.0 | A 0–3 s: owner asks for icons + a design pass | 1.5× | full frame, then eases into the pane card (0.5–1.7 s) |
| 2.0–5.0 | A 3–12 s: redesign post, screenshots, emblem request | 3× | pane card |
| 5.0–8.45 | B 2–8.9 s: emblem post, contact sheet in the pane | 2× | pane card |
| 8.45–10.1 | B 9.1–10.75 s: contact sheet full frame in the image viewer | 1× | hard cut to full frame |
| 10.1–11.15 | B 10.85–14 s: home screenshots, rough-edges note | 3× | hard cut back to card, pans down to the composer |
| 11.15–15.35 | B 14–18.2 s: owner types "Great work!" and posts | 1× | card, composer at the bottom edge |

Pane card: the thread pane (source x 2156–2974) is lifted out at 0.8× and centred. The
rest of the frame is blurred (28 px) and dimmed, so the sidebar's channel and Buddy
names can't be read. Before anything is published, check every frame against the
privacy note in `../footage/FOOTAGE.md`.
