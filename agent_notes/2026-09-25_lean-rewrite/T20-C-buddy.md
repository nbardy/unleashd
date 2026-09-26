# T20 slice C — Buddy page, one view tree

Branch `refactor/t20-buddy-tabs` (worktree `.claude/worktrees/lane-t20-buddy`).

## Starting state (finding)

The brief's premise (automations ×2, profile editor ×2, work tab ×2, 4 mobile tab
files, 666 lines) is already stale on this branch: 897f95c ("Buddy UI on the v2
routes") deleted the mobile tab files; every tab body already renders through the
shared `components/buddies/BuddyTabContent.tsx` on both trees. What was still
duplicated: the Buddy page frame (load/fail states, hero, section nav) in
`BuddiesDashboard.BuddyPage` vs `mobile/buddies/BuddyDetailMobile.tsx`, and a
boolean `compact` prop on `BuddySectionNav`.

## What changed (commit 6eae9f0)

- New `client/src/components/buddies/BuddyPage.tsx`: the ONE Buddy page view
  (archived redirect, `/buddies/:id` → tab canonicalisation, load / fail /
  stale states, hero, `BuddySectionNav`, `BuddyTabContent`). Variant prop
  `layout: 'wide' | 'narrow'` chosen by the caller; no `useDeviceKind` inside.
  `BuddyRelations`, `BuddyPageActions` moved here from BuddyTabContent (the
  hero is their only consumer); `RefreshNotice` moved here from
  BuddiesDashboard (the desktop directory imports it).
- `BuddiesDashboard.tsx` desktop mount is 5 lines; `BuddyDetailMobile.tsx` is
  a 28-line mount whose only job is threading mobile route state into
  `openConversation`. Mobile now keys the page by `buddyId` like desktop, so
  hero action state resets when you follow a report/manager link.
- `BuddySectionNav`: boolean `compact?` → required `layout: BuddyPageLayout`
  (a `Record<layout, labels>` table, no branch).
- CSS: desktop hero rules (BuddiesDashboard.css) and all of
  `mobile/styles/mobile-buddy.css` (deleted) → prefixed `.buddy-page*` rules
  in `components/buddies/BuddyDetail.css` (entry sheet, already shared).
  `CSS_LINE_CEILING` 14704 → 14639.
- Tests: the two rendered-HTML assertions follow the new markup
  (`<h1>Ada</h1>`, `layout="wide"`). No new test: the shared view has no
  logic beyond what `failed-refresh-keeps-page` already exercises on the
  phone route.
- `docs/client-state.md` notes the single view.

## Line counts (before → after)

| File | Before | After |
|---|---|---|
| components/BuddiesDashboard.tsx | 142 | 62 |
| mobile/buddies/BuddyDetailMobile.tsx | 119 | 28 |
| components/buddies/BuddyTabContent.tsx | 175 | 86 |
| components/buddies/BuddySectionNav.tsx | 39 | 46 |
| components/buddies/BuddyPage.tsx | — | 219 |
| **TSX total** | **475** | **441** (−34) |
| components/BuddiesDashboard.css | 525 | 437 |
| mobile/styles/mobile-buddy.css | 140 | deleted |
| components/buddies/BuddyDetail.css | 348 | 511 |
| **CSS total** | **1,013** | **948** (−65; client total 14,704 → 14,639) |

## Feature differences found (all kept; the union now renders on both trees)

- Status badge (`active` etc.) next to the name: desktop only → both.
- Avatar: desktop shows it; mobile hid it by CSS → still hidden on `narrow`.
- Back: desktop was a `←` button calling `navigate`, mobile a `← Buddies`
  Link → a `<Link>` "← Buddies" on both (small visual change on desktop).
- Failure screen: mobile had "Could not load buddy" + Back to Buddies;
  desktop showed the bare error centred → both show title, message, Back link.
- Failure precedence: mobile checked `detail` then `overview` failure in one
  step; desktop the same in two → one expression.
- "About this buddy" (mobile) vs "About this Buddy" (desktop) → the latter.
  Mobile's `+`/`−` summary marker was dropped; the summary keeps 44px touch
  height on `narrow`.
- More-menu summary label: mobile short labels (DMs, Chats, Tasks), desktop
  full → kept per layout.
- Unchanged and still two-tree: the Buddies DIRECTORY (`/buddies`). Desktop
  `BuddyDirectory` is a card grid with a Create card, status, workspace and
  open/blocked counts; mobile `BuddiesMobile` is a list grouped by workspace
  (`mobileBuddyDirectoryAtom`) inside `MobilePage` with a header "+ New" and
  a zero-buddies empty state. Search, archived filtering and the builder call
  are already shared helpers (`directoryEntries`, `filterDirectoryEntries`,
  `createBuddyViaBuilder`); what remains differs in presentation, so a merge
  would be a variant switch around two bodies for little saving. Not done in
  this slice; candidate for a later `ui/` ListRow pass.
- Stale comment outside this lane: `client/src/swarm/mobile/mobile-swarm.css`
  line 4 refers to the now-deleted `mobile-buddy.css` (swarm is another lane).

## Checks (at 6eae9f0, tree clean)

`pnpm run bootstrap` (needed `git submodule update --init vendor/agent-cli-tool`
first in this worktree), `pnpm typecheck` pass, `pnpm test:client` 167/167,
`bash tools/check-client-invariants.sh` all 8 gates (G8 14639/14639).
No screenshots taken (no server started, per brief).
