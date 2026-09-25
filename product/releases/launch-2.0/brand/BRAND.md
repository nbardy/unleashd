# Unleashd brand assets: launch 2.0

Catalogue of our own marks for the launch video and launch graphics. Third-party logos
(Claude, OpenAI, Cursor, Grok) are catalogued separately in `../logos/SOURCES.md`.

## 3D wordmark: "Unleashd!"

Supplied by the owner on 2026-09-26 (`~/Downloads/Unleashd-Unleashd.png`) for use in the
launch. Owner-provided artwork, so we hold the rights. The exclamation mark is part of the art.

| File | What | Size |
|---|---|---|
| `unleashd-wordmark-3d_original.png` | Byte-for-byte copy of the owner's file. Never edit it; re-derive the others from it. sha256 `238b7bac25e6c2f7e9b2c68e5a249f619173a1599da3d04bc22b458f04032a8e` | 3252×1882, RGBA, transparent background |
| `unleashd-wordmark-3d_trimmed.png` | The same art, trimmed to its bounds with 40 px of transparent padding, for layout. | 3031×1486, RGBA |
| `unleashd-wordmark-3d_on-dark-preview.png` | A readability check on `#002b36` (the slide background) and `#05090b` (near-black). Not for use. | 1920×540 |

Regenerate the trimmed file:
`magick unleashd-wordmark-3d_original.png -trim +repage -bordercolor none -border 40 unleashd-wordmark-3d_trimmed.png`

**Look:** heavy condensed grotesque, set on a rising diagonal of about 15°, with a stepped
extrusion down and to the right. The face has a vertical gradient. Colours were sampled
from the original:

| Role | Hex |
|---|---|
| Face, top | `#FDDB00` (yellow) |
| Face, middle | `#FD8C00` (orange) |
| Face, bottom | `#FC6300` (red-orange) |
| Extrusion | `#802600` (dark brown) |

**Use:**
- Put it on dark grounds. It reads on `#002b36` and on near-black. On black, the brown
  extrusion loses some contrast, but the face still carries it.
- Use it for the title moment ("Introducing Unleashd 2.0", beat 5) and the end card
  ("Try Unleashd Today, Free!", beat 11), where one loud mark has room to land. Keep it
  off the calm product footage in beats 6–8, where the contrast is meant to be quiet.
- Scale it uniformly. Don't recolour, re-angle or crop it. Scale it down for small uses
  (its rendered width shouldn't go below about 400 px, or the extrusion steps turn to mush).
- When a layout needs the wordmark flat or in other colours, ask the owner for the source
  file rather than tracing this PNG.

**In Remotion:** `edit/remotion.config.ts` points the public dir at `../footage`. To use the
wordmark, reference it with a relative import or copy it into the render's public dir at
build time. Don't move the original out of `brand/`.
