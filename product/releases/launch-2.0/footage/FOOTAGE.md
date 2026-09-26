# Launch 2.0 footage — raw owner recordings

Raw screen recordings, unedited. Do not overwrite; cuts go in `../edit/`.
Both: 2974×1882, 60 fps, H.264, no audio track needed. Recorded 2026-09-26 ~03:38–03:41
from the running app, #channels-feature thread "new home screen for /"
(post_2352edd0-745a-48ba-8868-78ab12235db5). Code state: commits 6d04860, 89b27ad, c5e0ded.

Action is all in the **thread pane** (right ~28% of the frame). The channel list and
main channel column are static background.

## A — `2026-09-26_design-iteration_A_scroll-request-to-redesign.mov` (12.0 s)

Role: the "before" — scrolling up through the design iteration. Owner: **clip this one**.

| Time | Thread pane shows |
|---|---|
| 0–3 s | Owner asks for icons on most-recent + "do a design pass, grok was sloppy"; Lead replies "On it. Three changes" |
| 3–5 s | "`/` is redesigned" post: Icons for most recent, No conversations sidebar, Design pass list |
| 5–8 s | The three home screenshots (desktop, New workspace form, phone) scroll past |
| 8–12 s | Owner's emblem request ("invert… mostly dark faded background… strong in centre") and the Lead's plan |

Contact sheet (1 frame/s, thread pane only): `A_thread-pane_1fps.png`

## B — `2026-09-26_design-iteration_B_emblem-response-great-work.mov` (19.3 s)

Role: the "after" — the final design lands. Owner: **shows the response**.

| Time | Thread pane shows |
|---|---|
| 0–2 s | Tail of the redesign screenshots |
| 2–6 s | "Workspaces now have their own emblem" post: Dark ground / Strong in the centre / Kernel carries identity |
| 6–9 s | Emblem contact sheet (every workspace at 88/44/32 px) |
| ~9–10 s | Contact sheet opened in the image viewer (full frame) |
| 11–14 s | Home desktop + phone screenshots, "Known rough edges" paragraph |
| 14–17 s | Owner types "Great work!" in the reply box |
| 17–19 s | Reply posted |

Contact sheet: `B_thread-pane_1fps.png`

## Edit intent (owner, 2026-09-26)

- Clip A; B shows the response and the final design.
- While scrolling: blur everything outside the thread pane, gentle zoom into the pane.
- Not started — owner said "don't do the video yet".

## Privacy check before publishing

The left sidebar shows real channel names and Buddy names; the main column shows real
owner messages. Blurred background mostly covers this, but check every frame of the
final cut before anything goes public.

## D — `2026-09-26_design-review_D_post-screenshots-request.mov` (7:22)

Role: the **Design Review** example. The owner asks the Product Development Lead to post
screenshots of every product view; it posts Mobile / iPad / Desktop threads of live captures.
Recorded 2026-09-26 16:16 (Desktop original: `Screen Recording 2026-09-26 at 4.16.28 PM.mov`),
#bugfixes. Same 2974×1882 @ 60 fps layout; the thread pane (x 2156–2974) opens at ~4 s.

| Time | Shows |
|---|---|
| 0.8–2 s | Request appears in the composer: "@Product Development Lead Can you post a set of screenshots for all product views to this channel and do a thread for mobile, ipad and desktop" |
| 3.6 s | Sent; thread pane opens (loading 3.8 s), "Product Development Lead is replying…" |
| 5–393 s | **Dead wait** (~6.5 min, nothing moves) |
| ~393.4 s | "On it. I've captured all 21 views… Now I'm checking them before I post the three threads" lands in the pane |
| 396.1 s | Three announcement posts land in the channel: Mobile (390×844), iPad, Desktop (1440×900) |
| 426.3 s | Owner clicks the iPad "4 replies"; pane loads until ~430 s |
| 430–435.8 s | iPad thread: portrait then landscape screenshots scroll by |
| 436–438.4 s | Back to thread root, Desktop thread loading |
| 438.5–442 s | Desktop thread: screenshots (buddies grid, worker detail, analytics) scroll by |

Cut: `../edit/src/DesignReview.tsx`. The main column shows a localhost URL containing the
workspace id and real owner messages in #bugfixes; the cut crops/blurs most of it, but check
before publishing.

## Native multimedia (2026-09-26 afternoon)

Two sources, both 2974×1882 @ 60 fps. They're gitignored like the other recordings.

- **1** `2026-09-26_native-multimedia_1_owner-asks-for-latest-video.mov` (18.4 s). This is the owner's
  take from 4:08:03 PM (Desktop). There are seven takes from 4:06–4:08 PM; this is the longest. The owner types
  "@Marketing Designer Can you share with me the latest video, and let me know which" and then
  clears it. None of the takes shows a send. The mention menu is open at 1.0–2.5 s, "latest video" is complete at
  9.4 s, and there are pauses at 9.5–11 s and 11.5–13.3 s. The file the owner attached in the channel
  (3:41:00 AM) is the older emblem-thread take, not this one.
- **2** `2026-09-26_native-multimedia_2_reply-plays-video-inline.mp4` (10 s). This is our capture of the
  real thread (post_649c1cdf…), made in the running app at 16:35: the owner's post, the reply,
  and rough assembly 1 playing inline from 2.6 s. Re-shoot:
  `node product/releases/launch-2.0/capture/record-thread.mjs --out /tmp/cap --workspace
  project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c --channel list_032cedcb-55a1-44b2-a625-5ff70fb4e616
  --thread post_649c1cdf-b134-4860-bf34-50db10045f86 --seconds 10`, then
  `ffmpeg -framerate 60 -i /tmp/cap/f%05d.jpg -c:v libx264 -crf 12 -pix_fmt yuv420p <name>.mp4`.

Privacy: for about 0.7 s the cut opens on the full frame, with the sidebar and the mention menu (Task titles) unblurred
while the blur eases in.
