# Mobile UI system

Mobile and desktop share the semantic color tokens in `client/src/index.css`, but
they intentionally have separate view trees. Reuse visual primitives inside the
mobile tree instead of importing desktop TSX or desktop feature CSS.

## Layers

1. `index.css` — palette and semantic tokens shared by every device.
2. `mobile/styles/mobile.css` — shell, safe areas, tab bar, and legacy detail views.
3. `mobile/styles/mobile-ui.css` — reusable mobile page and surface grammar.
4. Feature CSS — only layout or states unique to that feature.

## Primitives

Import from `mobile/components/MobileUI.tsx`:

- `MobilePage` for route title, subtitle, width containment, and page spacing.
- `MobileHeaderAction` for the page's primary action, passed as `headerAside`
  (the "+ New" button on Chats, Swarms, and Buddies). 44px min tap target.
- `MobileSection` for a labeled group inside a page.
- `MobileCardButton` for tappable cards with consistent focus and press feedback.
- `MobileSurface` for a non-interactive card.
- `MobileBadge` for compact status labels.
- `MobilePath` for a safe, truncated working-directory label.
- `MobileEmptyPanel` for an empty result inside an otherwise populated page.

Use the `mobile-ui-stack` class for one-column card lists. Keep data fetching,
domain copy, feature state, and feature-specific inner layouts in the feature.

```tsx
<MobilePage title="Swarms" subtitle="4 projects">
  <div className="mobile-ui-stack">
    <MobileCardButton onClick={openProject}>
      <strong>{project.name}</strong>
      <MobilePath>{project.path}</MobilePath>
    </MobileCardButton>
  </div>
</MobilePage>
```

## Restraint

Do not add a primitive for a one-off arrangement. Extract only a contract used
by at least two routes, and keep the API semantic rather than exposing dozens of
spacing or color props. New primitives must remain mobile-only and use existing
semantic tokens rather than introducing a second palette.

## Keep the page shell constant across states

`BuddiesMobile` used to `return` a bare `<div className="mobile-hub">` for its
loading, error, and empty states, so those states rendered no `MobilePage` and
therefore no header — which is where the create action lives. The empty state is
exactly when a user needs "+ New", and it was the one state that hid it.

Build the shell once and vary only the body:

```tsx
const shell = (body: ReactNode, subtitle: string) => (
  <MobilePage title="Buddies" subtitle={subtitle} headerAside={<MobileHeaderAction …/>}>
    {body}
  </MobilePage>
);
if (loading) return shell(<Spinner/>, 'Loading…');
if (error) return shell(<EmptyState …/>, 'Unavailable');
```

## Undefined CSS custom properties fail silently

`--accent` was referenced by ~15 mobile rules (focus rings, the unread "New"
badge, the "+ New" button) but was never defined — `index.css` defines
`--accent-primary`, `--accent-user`, and friends, but no bare `--accent`. CSS
resolves an undefined custom property to unset rather than erroring, so those
rules rendered transparent-on-dark: an invisible button, with no console warning,
no type error, and no lint failure. It is now defined in `index.css` as an alias
of `--accent-primary`.

`client/test/css-tokens.test.ts` guards the class: every bare `var(--x)` in
`client/src/**/*.css` must resolve. `var(--x, fallback)` is deliberately
defensive and is skipped. The mobile tree is held to zero debt; the desktop tree
carries a `KNOWN_UNDEFINED` ratchet of 11 pre-existing Solarized-era token names
(`--theme-base0`, `--theme-violet`, …) that still render unset — fix one, delete
its entry.
