import { Provider, useAtomValue } from 'jotai';
import {
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { handleMessage, setSendFn, setWsStatus } from './atoms/actions';
import { conversationsAtom, savedActiveConversationPresentAtom } from './atoms/conversations';
import { startConversationPrefetch } from './atoms/prefetch';
import { jotaiStore } from './atoms/store';
import { savedActiveConversationIdAtom } from './atoms/ui';
import { useOwnerUnreadTitle } from './components/buddies/channel-data';
import { useWebSocket } from './hooks/useWebSocket';
import { type DeviceKind, useDeviceKind } from './mobile/hooks/useDeviceKind';
import { initSettings } from './stores/settingsStore';
import { SWARM_PAGE_LOADERS } from './swarm';
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
  const savedActivePresent = useAtomValue(savedActiveConversationPresentAtom);
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
    if (!savedActivePresent) return;
    if (location.pathname !== '/') return;
    tryRestore();
  }, [savedActivePresent, location.pathname, tryRestore]);

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
// Code splitting. Every shell and route is its own chunk, loaded on first use,
// so the entry chunk holds only the store, the socket and this table. It used
// to import every route statically: one 1.12 MB chunk carried both device
// trees, of which a session ever renders one.
// =============================================================================

// biome-ignore lint/suspicious/noExplicitAny: React's own bound for lazy() components.
type AnyComponent = ComponentType<any>;

/** A named export loaded on first render; `preload` fetches it without rendering. */
function lazyNamed<C extends AnyComponent>(
  load: () => Promise<C>
): LazyExoticComponent<C> & { preload: () => Promise<C> } {
  return Object.assign(
    lazy(async () => ({ default: await load() })),
    { preload: load }
  );
}

// Desktop tree
const ShellDesktop = lazyNamed(() =>
  import('./components/ShellDesktop').then((m) => m.ShellDesktop)
);
const Gallery = lazyNamed(() => import('./components/Gallery').then((m) => m.Gallery));
const ChatRoute = lazyNamed(() => import('./components/Chat').then((m) => m.ChatRoute));
const BuddiesDashboard = lazyNamed(() =>
  import('./components/BuddiesDashboard').then((m) => m.BuddiesDashboard)
);
const SwarmDashboard = lazyNamed(SWARM_PAGE_LOADERS.dashboard);
const SwarmDetail = lazyNamed(SWARM_PAGE_LOADERS.detail);
const SwarmAnalytics = lazyNamed(SWARM_PAGE_LOADERS.analytics);
const WorkspaceSlack = lazyNamed(() =>
  import('./components/buddies/ChannelBrowser').then((m) => m.WorkspaceSlack)
);

// Shared by both trees (components/buddies is the one desktop folder mobile may use)
const BuddyWorkspaceActivity = lazyNamed(() =>
  import('./components/buddies/BuddyWorkspaceActivity').then((m) => m.BuddyWorkspaceActivity)
);
const ChannelsIndex = lazyNamed(() =>
  import('./mobile/channels/ChannelsIndex').then((m) => m.ChannelsIndex)
);

// Mobile tree
const ShellMobile = lazyNamed(() =>
  import('./mobile/components/ShellMobile').then((m) => m.ShellMobile)
);
const ConversationListMobile = lazyNamed(() =>
  import('./mobile/conversations/ConversationListMobile').then((m) => m.ConversationListMobile)
);
const ChatMobile = lazyNamed(() =>
  import('./mobile/conversations/ChatMobile').then((m) => m.ChatMobile)
);
const BuddiesMobile = lazyNamed(() =>
  import('./mobile/buddies/BuddiesMobile').then((m) => m.BuddiesMobile)
);
const BuddyDetailMobile = lazyNamed(() =>
  import('./mobile/buddies/BuddyDetailMobile').then((m) => m.BuddyDetailMobile)
);
const SwarmsMobile = lazyNamed(SWARM_PAGE_LOADERS.dashboardMobile);
const SwarmDetailMobile = lazyNamed(SWARM_PAGE_LOADERS.detailMobile);
const SwarmAnalyticsMobile = lazyNamed(SWARM_PAGE_LOADERS.analyticsMobile);
const SearchMobile = lazyNamed(() =>
  import('./mobile/search/SearchMobile').then((m) => m.SearchMobile)
);
const ChannelsMobile = lazyNamed(() =>
  import('./mobile/channels/ChannelsMobile').then((m) => m.ChannelsMobile)
);

/** Each device's chunks, fetched when the browser is idle after first render,
 *  so a later navigation does not wait on the network. */
const DEVICE_CHUNKS: Record<DeviceKind, ReadonlyArray<{ preload: () => Promise<unknown> }>> = {
  desktop: [
    Gallery,
    ChatRoute,
    BuddiesDashboard,
    SwarmDashboard,
    SwarmDetail,
    SwarmAnalytics,
    WorkspaceSlack,
    BuddyWorkspaceActivity,
    ChannelsIndex,
  ],
  mobile: [
    ConversationListMobile,
    ChatMobile,
    BuddiesMobile,
    BuddyDetailMobile,
    SwarmsMobile,
    SwarmDetailMobile,
    SwarmAnalyticsMobile,
    SearchMobile,
    ChannelsMobile,
    BuddyWorkspaceActivity,
    ChannelsIndex,
  ],
};

function usePreloadDeviceChunks(device: DeviceKind): void {
  useEffect(() => {
    const preload = () => {
      for (const chunk of DEVICE_CHUNKS[device]) void chunk.preload().catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preload, { timeout: 3_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(preload, 1_000);
    return () => window.clearTimeout(handle);
  }, [device]);
}

// =============================================================================
// RouteTable — element FACTORIES, not ComponentType (§3).
// ComponentType silently drops props: `desktop: Gallery` for "/done" compiles
// (filter is optional) and renders the wrong view. Factories make
// "/done" → <Gallery filter="done"/> expressible.
// =============================================================================
type RouteDef = { path: string; desktop: () => ReactElement; mobile: () => ReactElement };

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
  mobile: (
    <Route
      path={CHANNELS_PATH}
      element={
        <Suspense fallback={null}>
          <ChannelsMobile />
        </Suspense>
      }
    />
  ),
};

const SHELLS: Record<DeviceKind, ComponentType> = {
  desktop: ShellDesktop,
  mobile: ShellMobile,
};

// Nothing to show while a chunk loads (a local server answers in milliseconds,
// and idle preloading usually has the chunk already). The route-level boundary
// sits inside the shell, so navigating never blanks the sidebar or tab bar.
function AppRoutes({ device }: { device: DeviceKind }) {
  const Shell = SHELLS[device]; // δ #1 — shell
  const pick = (r: RouteDef) => (device === 'mobile' ? r.mobile() : r.desktop()); // δ #2 — leaf
  return (
    <Suspense fallback={null}>
      <Routes>
        {OUTSIDE_SHELL[device]}
        <Route element={<Shell />}>
          {ROUTES.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={<Suspense fallback={null}>{pick(r)}</Suspense>}
            />
          ))}
          {INSIDE_SHELL[device]}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function AppInner() {
  const device = useDeviceKind();
  useWebSocketBridge();
  useRestoreOnLoad(device);
  useOwnerUnreadTitle();
  usePreloadDeviceChunks(device);

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
