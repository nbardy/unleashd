# Launch 2.0 edit (Remotion)

Timelines as code. Remotion for the cut, ffmpeg underneath. Raw recordings stay in
`../footage/` (the public dir, see `remotion.config.ts`); renders go to `out/` (gitignored).

```bash
pnpm install --ignore-workspace          # standalone: not part of the repo's pnpm workspace
pnpm studio                              # scrubbable preview in the browser
pnpm run render:design-iteration         # -> out/design-iteration.mp4 (1920×1080, 60 fps)
```

Licence: Remotion is source-available and free for individuals and companies of up to 3
employees; a bigger company needs a paid licence (see `LICENSE.md` in `~/git/remotion`).

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
