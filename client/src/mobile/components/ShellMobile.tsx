import { useAtomValue } from 'jotai';
import { NavLink, Outlet, matchPath, useLocation } from 'react-router-dom';
import { rowFamily } from '../../atoms/conversations';
import { ownerUnreadTotal, useOwnerInboxes } from '../../components/buddies/channel-data';
import {
  type MobilePrimarySection,
  mobilePrimarySectionForPath,
  resolveMobileConversationDestination,
} from '../../utils/conversation-route-state';
import { isImmersiveChannelRoute } from '../channels/channel-route';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import '../styles/mobile.css';
import '../styles/mobile-ui.css';
import '../styles/mobile-controls.css';
import '../styles/mobile-channels.css';

/**
 * ShellMobile — mobile chrome around <Outlet/>.
 * Bottom tab bar = persistent chrome (like ShellDesktop's Sidebar+top-bar).
 * Safe-area bottom inset expands tap target into home-indicator area (§7 #9).
 */

type TabDef = {
  section: MobilePrimarySection;
  label: string;
  to: string;
  end?: boolean;
  icon: string;
  ariaLabel: string;
};

// Tabs map to the RouteTable leaves (§3). Home is the workspace directory at "/";
// the conversation list is at /chats. Search lives at /search.
const TABS: readonly TabDef[] = [
  { section: 'chats', label: 'Home', to: '/', end: true, icon: '◈', ariaLabel: 'Home' },
  { section: 'channels', label: 'Channels', to: '/channels', icon: '#', ariaLabel: 'Channels' },
  {
    section: 'swarms',
    label: 'Swarms',
    to: '/workers',
    icon: '⬡',
    ariaLabel: 'Swarms',
  },
  {
    section: 'buddies',
    label: 'Buddies',
    to: '/buddies',
    icon: '◎',
    ariaLabel: 'Buddies',
  },
  { section: 'search', label: 'Search', to: '/search', icon: '⌕', ariaLabel: 'Search' },
] as const;

export function ShellMobile() {
  const location = useLocation();
  const { pathname } = location;
  const chatId = matchPath('/chat/:id', pathname)?.params.id ?? '';
  const conversation = useAtomValue(rowFamily(chatId));
  // Two layout modes, and they are genuinely different documents:
  //   - list routes scroll as a page (content taller than the shell)
  //   - the conversation route is a fixed-height PANE that scrolls internally,
  //     so its composer can sit pinned at the bottom of the content area.
  // Without this distinction the pane grew to its own message-list height and
  // the composer ended up thousands of pixels below the tab bar. See the layout
  // contract in ConversationView.tsx.
  // A channel or thread (not the channels Home) is Slack's conversation
  // screen: a pane with its composer pinned and no tab bar underneath it.
  const isImmersiveChannel = isImmersiveChannelRoute(pathname, location.search);
  const isPaneRoute = pathname.startsWith('/chat/') || isImmersiveChannel;
  const activeSection = isPaneRoute
    ? resolveMobileConversationDestination(location.state, conversation).section
    : mobilePrimarySectionForPath(pathname);
  // Publishes --mobile-keyboard-inset and tells us when the keyboard is up, so
  // the shell can shrink to the visual viewport and hand that space to the
  // composer instead of leaving it under the keyboard.
  const keyboardOpen = useKeyboardInset();
  const channelsUnread = ownerUnreadTotal(useOwnerInboxes().data, null).unreadChannels > 0;

  return (
    <div
      className={
        keyboardOpen ? 'mobile-shell ui-stack mobile-shell--keyboard' : 'mobile-shell ui-stack'
      }
    >
      <div className={isPaneRoute ? 'mobile-content mobile-content--pane' : 'mobile-content'}>
        <div className="mobile-content__inner">
          <Outlet />
        </div>
      </div>
      {/* Tab bar yields to the keyboard — competing for the same ~50px is what
          made the composer feel cramped and clipped on focus. */}
      <nav
        className="mobile-tab-bar ui-row"
        aria-label="Primary"
        hidden={keyboardOpen || isImmersiveChannel}
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            aria-label={tab.ariaLabel}
            aria-current={activeSection === tab.section ? 'page' : undefined}
            className={
              activeSection === tab.section
                ? 'mobile-tab ui-stack ui-muted mobile-tab--active'
                : 'mobile-tab ui-stack ui-muted'
            }
          >
            <span
              className="mobile-tab__icon"
              aria-hidden="true"
              data-unread={(tab.section === 'channels' && channelsUnread) || undefined}
            >
              {tab.icon}
            </span>
            <span className="mobile-tab__label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
