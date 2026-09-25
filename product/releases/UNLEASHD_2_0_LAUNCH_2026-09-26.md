# Unleashd 2.0 launch — script notes

Status: kickoff draft, 2026-09-26. Owner beats are preserved. Timing is a working guess for a ~45–60s spot. Claude edits tomorrow; this file is the script and the shot list, not the edit.

Working title: **Introducing Unleashd 2.0**
End card: **Try Unleashd Today, Free!**

## Script

### Open — overload (about 0:00–0:18)

1. A single chat bubble appears. Someone types into it and hits enter. It pops.
2. That bubble fades and minimizes upward. A second conversation starts the same way.
3. The pace ramps. Many different agent conversations pop in until the frame is overloaded.
4. Overlay: **AI Overload! We're all feeling it.**
5. Voice: "Don't worry, we've got you covered." Title fades in: **Introducing Unleashd 2.0**.

### Product (about 0:18–0:38)

6. Real use, recorded by the owner: someone types a message in a channel, someone replies, and we see screenshots of the app being developed.
7. Flash cards over that footage: **Multiagent swarms**. **Memory!** **Familiar UI**. **Mobile Friendly!**
8. Then the ones that matter most: **Free!** **Private!** **Open Source!**

### Close (about 0:38–0:55)

9. Bring your own harness. Fork it to add the features you want. Run it on your own computer.
10. Inspired by Vim: we need open source agent software for the future.
11. End card: **Try Unleashd Today, Free!**

## Voice and type

- One voice line only, on the title: "Don't worry, we've got you covered."
- Everything else is on-screen type. No second voiceover unless the edit needs it.
- Keep the owner's wording on the cards. Do not soften "AI Overload" or drop "Free / Private / Open Source."

## What to record

Motion for beats 1–3 can be built in the edit (bubbles, pops, a ramp). Beats 6–9 need product pictures. Record each clip clean, with no overlay text; the cards go on in the edit.

| Clip | What the frame shows | Used on |
|---|---|---|
| Channel send | Desktop channel. Type a message and send it. Cursor and the send are visible. | Beat 6 |
| Channel reply | The reply landing in that thread, from the other side. | Beat 6 |
| App in progress | The channel (or a chat) showing screenshots of an app being built. Owner records this. | Beat 6 |
| Swarm | A multi-agent swarm actually running: the board or a live run, not a settings page. | "Multiagent swarms" |
| Memory | A Buddy memory surface with real notes, so "Memory!" is a picture of memory. | "Memory!" |
| Familiar chat | The ordinary desktop conversation view, one thread, no extra chrome. | "Familiar UI" |
| Phone | The same channel on a phone-width screen: list, channel, and a thread. | "Mobile Friendly!" |
| Harness | The provider / harness picker with more than one harness available. | Beat 9 |
| On your machine | The app open on localhost, on this computer. No account wall. | Beat 9, and the proof under "Private!" |
| End card plate | A still of the product mark on a quiet frame, for "Try Unleashd Today, Free!" | Beat 11 |

Optional stills if a clip is hard to shoot: mention menu, task filter, and one mobile buddy page. Use them only as cutaways under the flash cards.

## Edit handoff (tomorrow)

- Assembly order is the beat list above. Do not reorder Free / Private / Open Source ahead of the product footage.
- Cards 7 and 8 are flashes, not scenes. Each card holds long enough to read once.
- Owner records beat 6. The open (beats 1–5) and the end card can be built from type and the recorded clips.
- Deliverable: one video file plus this script with any line changes marked.

## Software release, separate from the video

The video announces the Channels release. Cutting that release (what commit ships, tests, package) is its own task on the Unleashd 2.0 project. Do not treat a finished video as the release.

## Editor notes (Claude, 2026-09-26)

Suggestions for the edit, not changes to the owner's beats.

- **Contrast is the story.** Build the overload bubbles (beats 1–3) as generic chat windows from many apps and tabs. The first thing that looks like Unleashd is the title. The calm channel in beat 6 then reads as the answer to the chaos.
- **Ramp shape.** Pops at 1, then 2, then 4, then too many to count, over about 6s, each pop on a beat. End on a hard cut to black and near silence, then "AI Overload! We're all feeling it." The silence is what makes the line land.
- **Reading budget.** Viewers read about 3 words a second. Beat 9 is about 18 words, which is 6s of screen. Split it across three cuts: "Bring your own harness" over the picker, "Fork it" over code, "Run it on your computer" over localhost.
- **Flash cards.** Beat 7 gets about 0.8s per card over moving footage. Beat 8 is the emphasis beat: stack Free / Private / Open Source one per musical hit and hold the full stack for a second.
- **Beat 10.** Keep "Inspired by Vim." Pair it with a plain reason, e.g. "Vim is open source and it's still here decades later. Agent software should be too." Otherwise, people outside Vim culture can miss the point.
- **Recording spec.** 1920×1080 browser window at 2× (retina), 60fps, cursor visible, notifications off. Use a demo workspace: the real sidebar shows private project names and conversation titles.
- **Aspect.** Master in 16:9. Keep beats 6–8 framed so a 9:16 crop still works for a vertical cut, and record the phone clip natively at phone size.

Needed before the edit, beyond the clips:
1. The voice line. Owner recording or TTS? One take of "Don't worry, we've got you covered."
2. A music track with a build, a drop into silence, and a lift at the title. The license must allow the upload.
3. A product mark or logo file for the title and end card.
4. Target length (45s or 60s) and where it's posted (X, YouTube, README). This sets the aspect and the pacing.

## Beat 9 additions (owner, 2026-09-25; Marketing Designer draft)

Owner asked for two slides in the close. Rough frames: `product/releases/launch-2.0/drafts/` (`frames.html`, `beat9-harness.png`, `beat9-subs.png`).

- **Multi harness.** Claude, Codex, Cursor/Grok and Muse marks drop in one per musical hit and fan into an overlapping stack, about 2s. Then cut to the real harness picker clip, so the claim is proven in the product. The drafts use wordmarks as placeholders. Swap in official marks from each brand kit, following each brand's guidelines.
- **Bring your own subscriptions.** Line: "Unleashd is free. Your existing plans do the work." Show only plans the app actually drives through each CLI's own login.
- Stack is locked to four marks (owner, 2026-09-25): Claude, Codex, Cursor/Grok, Muse Spark. Muse Spark is an integrated, usable harness. Leave Gemini out for now. OpenCode stays out until its MCP support works properly.
- Motion version (v2, 2026-09-26): `product/releases/launch-2.0/beat9/`. `beat9.html` animates both slides with block motion (a colour slab wipes in, the word rises out of it, then the slab punches). The font is Bricolage Grotesque ExtraBold condensed, OFL, stored in `launch-2.0/fonts/`. Real logo marks are in `launch-2.0/logos/`, with sources in `SOURCES.md`. Re-render with `node product/releases/launch-2.0/beat9/render.mjs`; it writes `beat9.mp4` (7s, 60fps) and two stills. Timings live in each element's `data-in`.
- New beat 9 order: Multi harness → picker clip → Bring your own subscriptions → Fork it → Run it on your computer. About 8 to 10s total.
