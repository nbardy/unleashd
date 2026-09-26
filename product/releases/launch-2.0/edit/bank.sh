#!/bin/sh
# Collect finished renders into the clips bank (../clips/), one file per clip plus a poster
# frame. Render first (pnpm run render:<clip>); a missing render fails loudly rather than
# leaving a stale clip in the bank. Index and status: ../clips/CLIPS.md.
set -eu
cd "$(dirname "$0")"
BANK=../clips
mkdir -p "$BANK"

# id  render  poster-second
while read -r id render poster; do
  cp "$render" "$BANK/$id.mp4"
  # -nostdin: ffmpeg otherwise eats the heredoc this loop reads (it swallowed the "0" of
  # "02_design-iteration" on the second run and banked it as "2_design-iteration").
  ffmpeg -nostdin -v error -y -ss "$poster" -i "$render" -frames:v 1 -vf scale=960:-1 "$BANK/$id.jpg"
  printf '%-28s %6.2fs\n' "$id" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$render")"
done <<'CLIPS'
01_overload-open                  out/overload.mp4           12.2
02_design-iteration               out/design-iteration.mp4   6.5
03_design-review                  out/design-review.mp4      6.5
09_beat9-harness-and-close        ../beat9/beat9.mp4         3.0
CLIPS
