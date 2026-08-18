import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import '../styles/mobile.css';
import '../styles/mobile-ui.css';
import '../styles/mobile-controls.css';
import '../styles/mobile-buddy.css';
import '../styles/mobile-swarm.css';

/**
 * ShellMobile — mobile chrome around <Outlet/>.
 * Bottom tab bar = persistent chrome (like ShellDesktop's Sidebar+top-bar).
 * Never renders mergeMode (Not in v1 — merge stays desktop-only, see PLANNING §1).
 * Safe-area bottom inset expands tap target into home-indicator area (§7 #9).
 */

type TabDef = {
  label: string;
  to: string;
  end?: boolean;
  icon: string;
  ariaLabel: string;
};

// Tabs map to the RouteTable leaves (§3). Chats is the non-worker inbox at "/".
// Search lives at /search (query param variant is handled inside SearchMobile).
const TABS: readonly TabDef[] = [
  { label: 'Chats', to: '/', end: true, icon: '◈', ariaLabel: 'Chats' },
  { label: 'Swarms', to: '/workers', icon: '⬡', ariaLabel: 'Swarms' },
  { label: 'Buddies', to: '/buddies', icon: '◎', ariaLabel: 'Buddies' },
  { label: 'Search', to: '/search', icon: '⌕', ariaLabel: 'Search' },
] as const;

export function ShellMobile() {
  const { pathname } = useLocation();
  // Two layout modes, and they are genuinely different documents:
  //   - list routes scroll as a page (content taller than the shell)
  //   - the conversation route is a fixed-height PANE that scrolls internally,
  //     so its composer can sit pinned at the bottom of the content area.
  // Without this distinction the pane grew to its own message-list height and
  // the composer ended up thousands of pixels below the tab bar. See the layout
  // contract in ConversationView.tsx.
  const isPaneRoute = pathname.startsWith('/chat/');
  // Publishes --mobile-keyboard-inset and tells us when the keyboard is up, so
  // the shell can shrink to the visual viewport and hand that space to the
  // composer instead of leaving it under the keyboard.
  const keyboardOpen = useKeyboardInset();

  return (
    <div className={keyboardOpen ? 'mobile-shell mobile-shell--keyboard' : 'mobile-shell'}>
      <div className={isPaneRoute ? 'mobile-content mobile-content--pane' : 'mobile-content'}>
        <div className="mobile-content__inner">
          <Outlet />
        </div>
      </div>
      {/* Tab bar yields to the keyboard — competing for the same ~50px is what
          made the composer feel cramped and clipped on focus. */}
      <nav className="mobile-tab-bar" aria-label="Primary" hidden={keyboardOpen}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            aria-label={tab.ariaLabel}
            className={({ isActive }) =>
              isActive ? 'mobile-tab mobile-tab--active' : 'mobile-tab'
            }
          >
            <span className="mobile-tab__icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="mobile-tab__label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
