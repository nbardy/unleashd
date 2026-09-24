import { Provider, useAtomValue } from 'jotai';
import { type ComponentType, type ReactElement, useCallback, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { handleMessage, setSendFn, setWsStatus } from './atoms/actions';
import { conversationsAtom, hasConversationsAtom } from './atoms/conversations';
import { startConversationPrefetch } from './atoms/prefetch';
import { jotaiStore } from './atoms/store';
import { savedActiveConversationIdAtom } from './atoms/ui';
import { BuddiesDashboard } from './components/BuddiesDashboard';
import { ChatRoute } from './components/Chat';
import { Gallery } from './components/Gallery';
import { RobotLoader } from './components/RobotLoader';
import { ShellDesktop } from './components/ShellDesktop';
import { SwarmAnalytics } from './components/SwarmAnalytics';
import { SwarmDashboard } from './components/SwarmDashboard';
import { SwarmDetail } from './components/SwarmDetail';
import { useWebSocket } from './hooks/useWebSocket';
import { ShellMobile } from './mobile/components/ShellMobile';
import { type DeviceKind, useDeviceKind } from './mobile/hooks/useDeviceKind';
import { initSettings } from './stores/settingsStore';
import './App.css';
import './components/buddies/BuddyDetail.css';

// =============================================================================
// κ: location.protocol → ws:// | wss://  (exhaustive D3, no silent fallback)
// Verification: http: → ws://, https: → wss://, else throw typed Error.
// Required before any https:// test; otherwise mixed-content blocks (PLANNING §5 #2).
// =============================================================================
function wsUrlForLocation(loc: Location): string {
  const protocol = loc.protocol;
  if (protocol === 'http:') {
    return `ws://${loc.host}/ws`;
  }
  if (protocol === 'https:') {
    return `wss://${loc.host}/ws`;
  }
  throw new Error(`Unsupported protocol for WebSocket: ${protocol}`);
}

/**
 * Connects the useWebSocket hook to the Jotai atom store.
 * Hoisted to App above AppRoutes so there is exactly one socket (§3).
 */
function useWebSocketBridge() {
  const wsUrl = wsUrlForLocation(window.location);
  const { send, status } = useWebSocket(wsUrl, handleMessage);

  useEffect(() => {
    setSendFn(send);
  }, [send]);

  useEffect(() => {
    setWsStatus(status);
  }, [status]);

  // Warm recent chat history once the server reports its load complete, so
  // navigating between conversations reads the local store instead of waiting
  // on a round trip. Lives beside the socket because that is where "the
  // snapshot has landed" is known; the work itself is idle-scheduled.
  useEffect(() => startConversationPrefetch(), []);
}

/**
 * DeviceKind-aware restore on load (§5 #1).
 * Desktop: restores "/" → /chat/:id from the saved active conversation id.
 * Mobile: keeps the Chats inbox at "/" — never auto-opens an old conversation.
 * Must be hoisted above AppRoutes so the nav fires once before the shell mounts.
 *
 * Portable: URL ownership lives here; chat-input persistence + focus lives in
 * useConversationDraft (shared by Chat.tsx desktop and ComposerMobile). This
 * merges the old uiStore-based restore with the new jotai/book via React —
 * desktop reuses the same localStorage `draft:{id}` + HMR flush/focus path as
 * mobile, so typing survives hot reload on both shells without duplicating code.
 *
 * HMR-safe: Vite Fast Refresh patches modules without reloading the page but
 * may remount AppInner — didRestore prevents a second push. URL is owned by
 * BrowserRouter (window.history) so HMR does not reset it; we only guard the
 * case where a soft HMR/full reload lands back on "/" while a conversation
 * was active. Focus is NOT handled here — useConversationDraft owns it.
 */
function useRestoreOnLoad(device: DeviceKind) {
  const navigate = useNavigate();
  const location = useLocation();
  const hasConversations = useAtomValue(hasConversationsAtom);
  const savedActiveId = useAtomValue(savedActiveConversationIdAtom);
  const didRestore = useRef(false);

  const tryRestore = useCallback(() => {
    if (device === 'mobile') return false;
    if (window.location.pathname !== '/') return false;
    if (!savedActiveId) return false;
    if (didRestore.current) return false;
    if (!jotaiStore.get(conversationsAtom).has(savedActiveId)) return false;
    didRestore.current = true;
    navigate(`/chat/${savedActiveId}`, { replace: true });
    return true;
  }, [device, navigate, savedActiveId]);

  // Initial: "/" → /chat/:id once conversations have hydrated.
  useEffect(() => {
    if (!hasConversations) return;
    if (location.pathname !== '/') return;
    tryRestore();
  }, [hasConversations, location.pathname, tryRestore]);

  // HMR/visibility: re-assert URL if a soft reload landed back on "/".
  // Focus is owned by useConversationDraft — no input handling here.
  useEffect(() => {
    if (device === 'mobile') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') tryRestore();
    };
    type ViteHMR = { addEventListener?: (e: string, cb: () => void) => void };
    (import.meta as unknown as { hot?: ViteHMR }).hot?.addEventListener?.(
      'vite:beforeUpdate',
      () => {
        setTimeout(tryRestore, 60);
      }
    );
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [device, tryRestore]);
}

// =============================================================================
// RouteTable — element FACTORIES, not ComponentType (§3).
// ComponentType silently drops props: `desktop: Gallery` for "/done" compiles
// (filter is optional) and renders the wrong view. Factories make
// "/done" → <Gallery filter="done"/> expressible.
// =============================================================================
type RouteDef = { path: string; desktop: () => ReactElement; mobile: () => ReactElement };

import { BuddyWorkspaceActivity } from './components/buddies/BuddyWorkspaceActivity';
import { WorkspaceSlack } from './components/buddies/ChannelBrowser';
import { BuddiesMobile } from './mobile/buddies/BuddiesMobile';
import { BuddyDetailMobile } from './mobile/buddies/BuddyDetailMobile';
import { ChannelsIndex, ChannelsMobile } from './mobile/channels/ChannelsMobile';
import { ChatMobile } from './mobile/conversations/ChatMobile';
import { ConversationListMobile } from './mobile/conversations/ConversationListMobile';
import { SearchMobile } from './mobile/search/SearchMobile';
import { SwarmAnalyticsMobile } from './mobile/swarms/SwarmAnalyticsMobile';
import { SwarmDetailMobile } from './mobile/swarms/SwarmDetailMobile';
import { SwarmsMobile } from './mobile/swarms/SwarmsMobile';

const ROUTES: RouteDef[] = [
  {
    path: '/',
    desktop: () => <Gallery />,
    mobile: () => <ConversationListMobile scope="chats" />,
  },
  { path: '/chat/:id', desktop: () => <ChatRoute />, mobile: () => <ChatMobile /> },
  { path: '/buddies', desktop: () => <BuddiesDashboard />, mobile: () => <BuddiesMobile /> },
  {
    path: '/buddies/workspaces/:workspaceId',
    desktop: () => <BuddyWorkspaceActivity />,
    mobile: () => <BuddyWorkspaceActivity />,
  },
  {
    path: '/buddies/:buddyId',
    desktop: () => <BuddiesDashboard />,
    mobile: () => <BuddyDetailMobile />,
  },
  // Employee sections are pages, not local tab state — see
  // components/buddies/buddy-tabs.ts. `/buddies/:buddyId` canonicalises itself
  // onto this route, so Back out of Automations lands on the previous tab.
  {
    path: '/buddies/:buddyId/:tab',
    desktop: () => <BuddiesDashboard />,
    mobile: () => <BuddyDetailMobile />,
  },
  { path: '/workers', desktop: () => <SwarmDashboard />, mobile: () => <SwarmsMobile /> },
  { path: '/workers/detail', desktop: () => <SwarmDetail />, mobile: () => <SwarmDetailMobile /> },
  {
    path: '/workers/analytics',
    desktop: () => <SwarmAnalytics />,
    mobile: () => <SwarmAnalyticsMobile />,
  },
  {
    path: '/done',
    desktop: () => <Gallery filter="done" />,
    mobile: () => <ConversationListMobile />,
  },
  { path: '/search', desktop: () => <Gallery />, mobile: () => <SearchMobile /> },
  // The Channels tab's entry: redirects to the first workspace's channels.
  { path: '/channels', desktop: () => <ChannelsIndex />, mobile: () => <ChannelsIndex /> },
];

// Channels mount differently per device, at the SAME URL so links travel.
// Desktop: a full-screen surface OUTSIDE the shell — its channel rail replaces
// the conversations sidebar (inside the shell it rendered as a second sidebar
// nested beside the first; owner feedback 2026-09-23).
// Mobile: inside the shell, Slack-style — Home keeps the tab bar, a channel or
// thread is an immersive pane (ShellMobile hides the tab bar there).
const CHANNELS_PATH = '/buddies/workspaces/:workspaceId/channels';
const OUTSIDE_SHELL: Record<DeviceKind, ReactElement | null> = {
  desktop: <Route path={CHANNELS_PATH} element={<WorkspaceSlack />} />,
  mobile: null,
};
const INSIDE_SHELL: Record<DeviceKind, ReactElement | null> = {
  desktop: null,
  mobile: <Route path={CHANNELS_PATH} element={<ChannelsMobile />} />,
};

const SHELLS: Record<DeviceKind, ComponentType> = {
  desktop: ShellDesktop,
  mobile: ShellMobile,
};

function AppRoutes({ device }: { device: DeviceKind }) {
  const Shell = SHELLS[device]; // δ #1 — shell
  const pick = (r: RouteDef) => (device === 'mobile' ? r.mobile() : r.desktop()); // δ #2 — leaf
  return (
    <Routes>
      <Route path="/robot" element={<RobotLoader />} />
      {OUTSIDE_SHELL[device]}
      <Route element={<Shell />}>
        {ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={pick(r)} />
        ))}
        {INSIDE_SHELL[device]}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AppInner() {
  const device = useDeviceKind();
  useWebSocketBridge();
  useRestoreOnLoad(device);

  useEffect(() => {
    initSettings().catch(console.error);
  }, []);

  return <AppRoutes device={device} />;
}

function App() {
  return (
    <Provider store={jotaiStore}>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </Provider>
  );
}

export default App;
