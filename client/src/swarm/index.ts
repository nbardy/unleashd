/**
 * The swarm/oompa viewer's ONE entry point on the client. Core files (App,
 * Chat, VirtualizedMessageList, mobile ConversationView) import swarm code only
 * from here, and everything here is lazy: importing this module pulls no swarm
 * component, parser or stylesheet into a core chunk. Deleting swarm support is:
 * delete client/src/swarm/, then the call sites of these exports (listed in the
 * lean-rewrite T10 report). Owner decision 2026-09-25 (DESIGN.md §C.5).
 * Pattern: quarantine (docs/patterns.md#quarantine)
 * Guard: client/test/swarm-quarantine.test.ts
 */
import { type ComponentProps, type ComponentType, Suspense, createElement, lazy } from 'react';

/** Page loaders; App.tsx wraps each in its own `lazyNamed` route chunk. */
export const SWARM_PAGE_LOADERS = {
  dashboard: () => import('./SwarmDashboard').then((m) => m.SwarmDashboard),
  detail: () => import('./SwarmDetail').then((m) => m.SwarmDetail),
  analytics: () => import('./SwarmAnalytics').then((m) => m.SwarmAnalytics),
  dashboardMobile: () => import('./mobile/SwarmsMobile').then((m) => m.SwarmsMobile),
  detailMobile: () => import('./mobile/SwarmDetailMobile').then((m) => m.SwarmDetailMobile),
  analyticsMobile: () =>
    import('./mobile/SwarmAnalyticsMobile').then((m) => m.SwarmAnalyticsMobile),
};

/**
 * An inline swarm panel inside a core view. Its own Suspense boundary renders
 * nothing while the chunk loads, so the transcript around it never suspends.
 */
// biome-ignore lint/suspicious/noExplicitAny: React's own bound for lazy() components.
function lazyPanel<C extends ComponentType<any>>(load: () => Promise<C>) {
  const Lazy = lazy(async () => ({ default: await load() }));
  return (props: ComponentProps<C>) =>
    createElement(Suspense, { fallback: null }, createElement(Lazy, props));
}

export const SwarmConvoPrefix = lazyPanel(() =>
  import('./SwarmConvoPrefix').then((m) => m.SwarmConvoPrefix)
);
export const InlineSwarmRunWidget = lazyPanel(() =>
  import('./InlineSwarmRunWidget').then((m) => m.InlineSwarmRunWidget)
);
export const MobileSwarmPrefix = lazyPanel(() =>
  import('./mobile/MobileSwarmPrefix').then((m) => m.MobileSwarmPrefix)
);
