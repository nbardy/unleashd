# Buddy Handoff — auto_youtube video pipeline (Sep 8, 2026)

Source: Nicholas's `auto_youtube` repo + Muse threads Aug 28 – Sep 7.
Full knowledge: `/Users/nicholasbardy/git/auto_youtube/LEARNINGS.md` (committed `cf19ae0`).
Day-to-day memory: `/Users/nicholasbardy/git/auto_youtube/AGENTS.md`.

## Buddy mission

Be the persistent video-baking partner for the RippleJack YouTube Shorts project.
Own the shot pipeline end-to-end: keyframe direction → fal.ai bakes → verification
(frames + audio levels) → ffmpeg assembly → cost tracking. Work in the
`animal_fights_v2/` tree; never touch `~/git/magic_genie` or other projects.

## Identity canon (do not break)

- **RippleJack** (hero, giant otter): LEFT eye ONLY violet seer (slit pupil, faint glow),
  right eye dark brown. Wink = right eye only. Anchor:
  `animal_fights_v2/characters/ripplejack/anchors/reference_headshot.png`
- **Grift** (villain, mangy raccoon): patchy mange, black mask, yellowed canines,
  28lb of dragged weight (never weightless). Anchor:
  `animal_fights_v2/characters/grift/anchors/reference_fullbody.png`
- Tone: UFC-style hero/villain announcements ("IN THE BLUE/RED CORNER") as arena-style
  homage — never clone a real announcer's voice.

## Where things stand

- `fights/ripplejack_hero_title/` is the active scene (s01 wink+title, s02 swim,
  s03 prey/leap, s04 Grift red corner). `realized/short_v1.mp4` (23.6s) is cut.
- `fights/ripplejack_intro/` (concept/actual/realized three-layer format) holds the
  older grapple work + reusable `h3_one_take.mp4` fight insert.
- Shared libs: `tools/prompt_lib.mjs` (HF_HIGH, CINEMA, AUDIO_DOC, CHARACTER_DOC,
  `buildFightPrompt`), `tools/load_concept.mjs`, generic baker
  `tools/h3_hero_bake.mjs <shotId> <start> <end> [heroes]`.
- Keyframes in `fights/ripplejack_hero_title/keyframes/` (user-supplied via Downloads).

## Key learnings (distilled)

1. H3 Max: 480P/768P only (always bake 768P), 5–15s ints, $0.04/s promo,
   `prompt_expansion_mode: disabled` always. No negative prompt, no quality dial.
2. Sharpness is geometric, not adjectival: subject large + locked camera = sharp;
   zoom-outs melt by 7s. **Every bake interpolates TWO keyframes** (enforced in
   baker); cuts only at clip joints.
3. In-model titles work ("RippleJack" spelled right twice). "BBC Planet Earth"
   tokens render a BBC logo — CINEMA block carries a no-logos line; keep it.
4. H3 renders REAL audio (AAC, −16dB mean). But models voice the on-screen subject,
   not the script: SFX/bed in-model, all announcer VO dubbed in post (no ElevenLabs
   key; use phone recording or `say` timing test).
5. Howl → soft rumbling quip (head level, never moon-howl). Text overlay post (ffmpeg)
   unless proven in-model per shot.
6. Pasted/dragged chat images = pixels only, no path. Get frames onto disk via
   `~/Downloads` timestamp-hunt (ask user to rename first), verify visually.

## Open items (in order)

1. User listen-test: does s01/s04 audio contain announcer VO or just bed? (Can't verify
   without ears — ask.)
2. Bake s03 prey dread (5s, locked, gong) — concept `s03_gong_pop` exists, unbaked.
3. Bake leap→grapple bridge; splice `h3_one_take` fight + prey into v2 assembly (~36s).
4. Missing keyframes: Grift water-pop (anchor is on mud), kick-off/win frame, portrait
   snarl end card (`intro_snarl_end` is landscape — center-crop).
5. Optional upgrades: Seedance (fal early-access gated — user must request), Veo 3.1,
   standard H3 2K.

## Working agreements with Nicholas

- Costs: confirm before any bake over ~$0.60; report $/bake after each.
- Verify every bake: first/mid/last frames viewed + `volumedetect` levels, before reporting.
- Keep AGENTS.md current (paths, prices, gotchas); LEARNINGS.md for durable findings.
- Short answers, full paths when he needs to open files. Fire bakes only on explicit "go".
- Never `muse resume` session `1b16740e…` (corrupt non-monotonic log) — history lives in
  LEARNINGS.md now.
