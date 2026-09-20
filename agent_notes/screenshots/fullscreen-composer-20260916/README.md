# Fullscreen mobile composer — 16 September 2026

Owner's four iPhone screenshots demonstrate that pane expansion left the header,
sub-agent panel and attachment chips in the editing layout, and allowed oversized
root scrolling. The earlier zero-offset viewport simulation did not cover this.

## Implementation

- `FullscreenComposer.tsx` keeps the textarea mounted, enters explicit editing
  mode on focus, and follows the visual viewport's position and dimensions.
- The frame covers the app header and panels. Body/root scrolling is locked;
  background branches become inert. Previous styles, inert state and page scroll
  are restored when leaving editing. The draft and attachment lifecycle remain
  owned by the existing shared hooks.
- The textarea is the bounded flex scrollport. Actions cannot shrink. Safe areas
  account for panning; bottom safe padding disappears with a shrunken keyboard
  viewport. No height animation competes with the browser keyboard animation.
- Done, Escape, native blur and successful sending contract the editor. Toolbar
  pointer intent handles Safari buttons that do not receive focus, preventing
  their textarea blur from collapsing the editor before click. Palette opening
  leaves the editor first; tool selection closes the + menu.
- `ComposerAttachments.tsx` replaces filename/removal chips with a single row of
  48px thumbnails. Tapping reveals that attachment in a horizontally swipeable,
  bounded gallery; filenames and Remove live in the expanded view. Gallery closes
  when the final attachment is removed.

## Research and rationale

[Chrome viewport/keyboard behavior](https://developer.chrome.com/blog/viewport-resize-behavior)
explains why keyboard display can resize only the visual viewport, leaving fixed
positions and viewport units tied to a larger layout viewport. Changing a `dvh`
height or adding `interactive-widget` alone is not a cross-browser solution.

[Visual Viewport API](https://developer.chrome.com/blog/visual-viewport-api/)
documents height plus offsets and resize/scroll events. The component follows
these directly, rather than inferring its height by subtracting an estimated
keyboard inset. Keep pinch zoom available; input text remains at least 16px.

[WebKit issue 292603](https://bugs.webkit.org/show_bug.cgi?id=292603)
reports extra root-scrollable space with the keyboard and safe-area insets.
This is evidence for testing root scroll independently of inner editor height,
not proof that every Safari version has the same issue. We lock the background,
keep scrolling inside the textarea/gallery, and still require a physical check.

## Verification

- Client `tsc -b`: passed.
- All six client invariant gates: passed.
- Ten existing focused queue and CSS-token tests: passed.
- Live authenticated browser, 390×844 layout with simulated visual viewport
  height 420 / offsetTop 84: frame top 84, bottom 504, height 420; header inert,
  body fixed. This deliberately tests panning as well as resizing.
- 390×440 with four uploaded screenshots and 120-line draft: frame height 440,
  action bottom 432, textarea height 309 / scrollHeight 2888, root scrollY 0 after
  attempted window scrolling.
- 320×360: action bottom 352, textarea scrollTop 2659; no horizontal overflow.
- Last thumbnail revealed the selected preview; gallery swiped and all four
  attachments were removed through UI controls.
- Done restored body styles/background interaction and preserved the 3611-character
  draft. Native-style blur contracted; simulated Safari button pointerdown followed
  by blur kept editing open. Assertions allowed React's next render to commit.
- Visual QA caught a Chromium paint discrepancy with the preview open: actions
  were geometrically correct and hit-testable but absent from the screenshot.
  A separate composited editor layer (`translateZ(0)`) restored painting; final
  gallery screenshot was inspected after the fix.
- Test drafts and pending attachments were cleared without sending a message;
  isolated browser sessions were closed.

## Screenshots

- [Focused editor with thumbnails](attachments.png)
- [Expanded attachment preview](gallery.png)
- [Narrow screen with a long draft](narrow-long-draft.png)
- [Offset viewport geometry simulation](focused.png): the desktop screenshot shows
  content outside the simulated visible rectangle; on the phone only the rectangle
  from y=84 to y=504 would be visible.

Physical iPhone Safari/PWA keyboard animation, dictation, interactive dismissal,
rotation and repeated reopen still need device verification. These browser checks
are not represented as native keyboard validation. Changes are uncommitted in the
existing shared working tree.
