# Logo sources: "works with" slide

All files fetched 2026-09-26. Every file except the two Grok files is a byte-for-byte copy from the
company's official brand kit, with no edits. Slide background: `#002b36` (dark).

## Claude (Anthropic): official

Source: Anthropic press kit zip, https://www.anthropic.com/press-kit (the "Media assets" link in the
Anthropic Newsroom). Brand-guideline URL: none published; the kit has no guidelines document.
Usage: the kit ships separate Slate (for light backgrounds) and Ivory (for dark backgrounds) versions.
Use a provided version as-is rather than recolouring one.

| File | Kit path | Colour |
|---|---|---|
| `claude.svg` | `Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg` | Colour: Clay `#D97757` spark only. Readable on dark. |
| `claude-logo-ivory.svg` | `Claude logos/1 Claude logo/SVG/Claude logo - Ivory.svg` | Colour: Clay spark + Ivory `#faf9f5` "Claude" wordmark. This is the dark-background version. |

## OpenAI (Codex): official

Source: https://cdn.openai.com/brand/openai-logos.zip, linked from https://openai.com/brand/.
Brand guidelines: https://openai.com/brand/
Usage: don't alter or stretch the marks and don't add colours to the Blossom; give the Blossom its
prescribed clear space and never place it over a busy image; don't use the Blossom as primary branding;
don't feature OpenAI marks more prominently than your own. If you are not an official partner, don't
say "worked with", "partnered with" or "collaborated with" in any form.

| File | Kit path | Colour |
|---|---|---|
| `openai.svg` | `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_White.svg` | Mono white. This is the dark-background version. |
| `openai-black.svg` | `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_Black.svg` | Mono black. Disappears on `#002b36`. |
| `openai-wordmark.svg` | `OpenAI-logos/SVGs/OAI_OpenAI_Wordmark_White.svg` | Mono white "OpenAI" wordmark. OpenAI treats the wordmark as its primary mark and says it must not be combined with the Blossom. |

**No `codex.svg`:** OpenAI's brand kit has no Codex mark, and neither does the openai/codex GitHub
repo (it contains only a CLI splash screenshot). The Codex SVGs on icon sites (LobeHub, theSVG) are
third-party recreations, so none was downloaded.

## Cursor (Anysphere): official

Source: https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip,
linked from https://cursor.com/brand.
Brand guidelines: https://cursor.com/brand
Usage: call it "Cursor", never "Cursor AI" or "Cursor Code". The 2D logo is the default and 2.5D is for
larger uses. The horizontal lockup is the preferred form.

| File | Kit path | Colour |
|---|---|---|
| `cursor.svg` | `General Logos/Cube/SVG/CUBE_2D_DARK.svg` | Mono off-white `#edecec` cube. This is the dark-background version. |
| `cursor-light-bg.svg` | `General Logos/Cube/SVG/CUBE_2D_LIGHT.svg` | Mono near-black `#26251e`. Too dark to read on `#002b36`. |
| `cursor-lockup.svg` | `General Logos/Lockup Horizontal/SVG/LOCKUP_HORIZONTAL_2D_DARK.svg` | Mono `#edecec` cube + "CURSOR" wordmark. This is the dark-background version. |

## Grok (xAI / SpaceXAI): official artwork from the official site, not from the kit

Official kit: https://data.x.ai/logos/SpaceXAI_Grok_Assets.zip, linked from
https://x.ai/legal/brand-guidelines. **It could not be downloaded**: Cloudflare returned an
"Attention Required" block page to both curl and a real browser.
Actual source: the inline logo SVG in the header of https://grok.com/ (the `a[aria-label="Home page"]`
element), copied from the live page DOM.

- `grok-lockup.svg`: the header SVG with the Tailwind `class` attribute removed and an XML prolog
  added. The path data and fills are unchanged.
- `grok.svg`: only the two `id="mark"` paths from that header SVG, unchanged, placed in a tight
  `0 0 34 33` viewBox so the symbol can be used without the wordmark.

Both are **mono and use `fill="currentColor"`**. A browser `<img>` draws them black, so they disappear on
`#002b36` unless the SVG is inlined with CSS `color: #fff` (grok.com does this in dark mode).
**ImageMagick draws currentColor as nothing**, so `magick` renders these files as blank images. They
were checked visually in Chrome instead. Replace them with the kit files if the zip ever becomes
reachable.
Brand guidelines: https://x.ai/legal/brand-guidelines
Usage: use logos "exactly as provided ... without any alteration or adjustment"; don't imply endorsement
or sponsorship; don't put anything close to the marks that creates the impression of a new mark; contact
legal@x.ai before mentioning xAI in press materials.

## Muse Spark (Meta Superintelligence Labs): not found, no file

Muse Spark is Meta's model, built by Meta Superintelligence Labs. It was announced in April 2026 and
Muse Spark 1.1 shipped on 2026-07-09. Pages checked:
https://about.fb.com/news/2026/04/introducing-muse-spark-meta-superintelligence-labs/,
https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/, and
https://en.wikipedia.org/wiki/Muse_Spark (its infobox has no logo). None of them shows a separate Muse
Spark mark. Meta presents the model with the Meta AI petal-ring mark plus plain text: the announcement's
share image is the Meta AI logo, and the 1.1 blog hero is plain "Muse Spark 1.1" type. No mark was
created. The closest official mark is the Meta AI logo, which was not downloaded.
