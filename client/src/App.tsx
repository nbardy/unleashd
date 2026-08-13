import { Provider, useAtomValue } from 'jotai';
import { type ComponentType, type ReactElement, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { handleMessage, setSendFn, setWsStatus } from './atoms/actions';
import { allConversationsAtom, conversationsAtom } from './atoms/conversations';
import { jotaiStore } from './atoms/store';
import { savedActiveConversationIdAtom } from './atoms/ui';
import { BuddiesDashboard } from './components/BuddiesDashboard';
import { Chat } from './components/Chat';
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
}

/**
 * DeviceKind-aware restore on load (§5 #1).
 * Desktop: restores "/" → /chat/:id from the saved active conversation id.
 * Mobile: keeps the Chats inbox at "/" — never auto-opens an old conversation.
 * Must be hoisted above AppRoutes so the nav fires once before the shell mounts.
 */
function useRestoreOnLoad(device: DeviceKind) {
  const navigate = useNavigate();
  const location = useLocation();
  const allConversations = useAtomValue(allConversationsAtom);
  const savedActiveId = useAtomValue(savedActiveConversationIdAtom);
  const didRestore = useRef(false);

  useEffect(() => {
    // Mobile keeps the inbox — never auto-redirect to a chat (PLANNING §5 #1).
    if (device === 'mobile') return;
    if (didRestore.current || allConversations.length === 0) return;
    didRestore.current = true;

    if (location.pathname === '/' && savedActiveId) {
      const conversations = jotaiStore.get(conversationsAtom);
      if (conversations.has(savedActiveId)) {
        navigate(`/chat/${savedActiveId}`, { replace: true });
      }
    }
  }, [allConversations.length, navigate, savedActiveId, location.pathname, device]);
}

// =============================================================================
// RouteTable — element FACTORIES, not ComponentType (§3).
// ComponentType silently drops props: `desktop: Gallery` for "/done" compiles
// (filter is optional) and renders the wrong view. Factories make
// "/done" → <Gallery filter="done"/> expressible.
// =============================================================================
type RouteDef = { path: string; desktop: () => ReactElement; mobile: () => ReactElement };

import { BuddiesMobile } from './mobile/buddies/BuddiesMobile';
import { BuddyDetailMobile } from './mobile/buddies/BuddyDetailMobile';
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
  { path: '/chat/:id', desktop: () => <Chat />, mobile: () => <ChatMobile /> },
  { path: '/buddies', desktop: () => <BuddiesDashboard />, mobile: () => <BuddiesMobile /> },
  {
    path: '/buddies/:buddyId',
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
];

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
      <Route element={<Shell />}>
        {ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={pick(r)} />
        ))}
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
