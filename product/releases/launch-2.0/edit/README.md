# Launch 2.0 edit (Remotion)

Timelines as code. Remotion for the cut, ffmpeg underneath. Raw recordings stay in
`../footage/` (the public dir, see `remotion.config.ts`); renders go to `out/` (gitignored).

```bash
pnpm install --ignore-workspace          # standalone: not part of the repo's pnpm workspace
pnpm studio                              # scrubbable preview in the browser
pnpm run render:overload                 # -> out/overload.mp4 (beats 1–5, 18 s, with sound)
pnpm run render:design-iteration         # -> out/design-iteration.mp4 (1920×1080, 60 fps)
pnpm run render:design-review            # -> out/design-review.mp4 (13 s, silent)
pnpm run render:native-multimedia        # -> out/native-multimedia.mp4 (9.4 s, EDM build + drop)
./bank.sh                                # copy finished renders into ../clips/ (the clips bank)
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

Draft 2 (owner, 2026-09-26: "align to ChatGPT and Codex style"): the windows are
modelled on the desktop agent apps (`SKINS` in the source). There's a Claude-style studio
(serif greeting, orange send), a Codex-style workbench (purple-tinted sidebar, repo/Local/branch
chips), a ChatGPT-style assistant with a pill composer, and a CLI. Each has a sidebar of
recents. On send, the greeting clears, the prompt moves to the top and the composer drops to
the bottom. The windows use no product names or logos. Arrival times are the music grid:
when the track lands, move `T` and `GAPS` onto its beats.

### Sound

Sound design only, not music: every sample is synthesized by `../sound/synth.py`
(`uv run --with numpy python product/releases/launch-2.0/sound/synth.py`), so we own it all.
Where a sound plays is `OVERLOAD_CUES` in `src/Overload.tsx`, derived from the same timeline
as the picture: one key tick per revealed character, a send blip, a whoosh on minimize, a
pop per pile window climbing in pitch every 8 arrivals, a riser that ends exactly on the
hard cut (the silence is the drop), an impact on "AI Overload!", a thud on "We're all feeling
it.", then the calm answer: soft marimba (modal synthesis), a rising D arpeggio under the voice
line, G under the title and a rolled D chord on "2.0", over a quiet D-major pad; a sparkle
marks "2.0". Owner pick 2026-09-26 over a synthesized guitar ("trash"), an FM electric piano
and a strings pad; those live in git history (e27982d). Levels: the boom (~-3 dB peak) stays
the loudest moment; the marimba peaks around -6.5 to -8.5 dB. A music bed goes under this
when one is chosen; retime `T`/`GAPS` to its beats.

**Audio sync gotcha:** Remotion's own mp4 (AAC) output plays the sound about 43 ms (2048
samples, the AAC priming) late, measured on 2026-09-26: the impact hit at 12.093 s instead of
12.050 s. Its WAV output is sample-exact. So `render:overload` renders a muted video and a WAV
and muxes them with ffmpeg, which writes the edit list that cancels the priming. Don't
collapse it back into a single `remotion render`. For the same reason, CRF is a per-script
flag, not in `remotion.config.ts`: a global CRF makes `--codec=wav` renders fail.

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

## DesignReview — "Design review" feature example

Source: `src/DesignReview.tsx` (footage D). Same card-over-blur camera as DesignIteration, but
a shot can frame any source region (`x`, `w`, `top`, `scale`), not only the thread pane.
Each hold also drifts in (`zoom` 1.04–1.10, anchored at `ox`/`oy` in the card) toward where the
action is, so no shot sits dead still. Rough cut 2, 2026-09-26: 13.0 s, silent.

| Out (s) | Source | Speed | Shot |
|---|---|---|---|
| 0.0–3.0 | 0.8–5.3 s: request appears, sent, thread opens | 1.5× | full → composer card → pane card |
| 3.0–5.5 | 392.7–395.2 s: "On it… captured all 21 views" lands | 1× | pane card, "6 minutes later" chip |
| 5.5–8.0 | 395.6–398.1 s: Mobile / iPad / Desktop posts land | 1× | main-column card |
| 8.0–9.0 | 425.8–426.8 s: click the iPad thread | 1× | main-column card |
| 9.0–11.3 | 430–435.8 s: iPad screenshots scroll | 2.5× | hard cut to pane card |
| 11.3–13.0 | 438.4–441.8 s: Desktop screenshots scroll | 2× | pane card |

The real wait is ~6.5 minutes; the chip says so rather than implying the reply was instant.

## NativeMultimedia — opens the features section

Source: `src/NativeMultimedia.tsx` (`CUTS`, `CAMERA`, `CARDS`). Rough cut 1, 2026-09-26: 9.375 s
= 5 bars of the EDM cue at 128 BPM. Every cut and card sits on a beat (`BEAT`, `DROP`).

| Out (s) | Source | Shot |
|---|---|---|
| 0–3.28 | footage 1, 0.9–9.4 s at 2.6× | owner types "@Marketing Designer Can you share with me the latest video". Eases from full frame into the composer strip. The pauses after "video," are cut |
| 3.28 | send blip | hard cut on beat 8 to the thread |
| 3.28–9.375 | footage 2, from 1.0 s at 1× | the reply with the launch video playing inline. Pushes into the player (4.7–6.1 s) |
| 5.16 | card | **Native multimedia** |
| 7.5 | the drop | **Code +** / **Design +** / **Marketing!**, one per beat, with a 6% punch on the window |

Music: `../sound/edm-build.wav` from `../sound/edm.py`. It's synthesized, so we own it (128 BPM, D major / B minor
next to the marimba; 4-bar build, gap, drop at exactly 7.500 s, 4 bars of groove to 15 s). The
"echoing voice" is formant-synthesized vowels ("oh-ah", "ay-oh") with a ping-pong echo, not
words. There are stems (`edm-stem-{drums,music,vox}.wav`) for rebalancing. The cut uses bars 1–5; bars 6–8 are
for the flash cards that follow.

Footage 2 is our capture, not a screen recording: `../capture/record-thread.mjs` drives
headless Chrome over CDP and poses every frame. It sets the thread's scroll and the video's
`currentTime`, then takes one screenshot, so it's a true 60 fps at 2974×1882 on any machine. A live CDP
screencast managed 5 fps at that size, and its frames ignore `deviceScaleFactor`. Re-shoot
with the command in `../footage/FOOTAGE.md`.
