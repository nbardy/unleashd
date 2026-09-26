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

/**
 * Page loaders; App.tsx wraps each in its own `lazyNamed` route chunk. One view
 * per screen: the route table passes `layout` ('wide' on desktop, 'narrow' on
 * mobile), never the view itself.
 */
export const SWARM_PAGE_LOADERS = {
  dashboard: () => import('./SwarmDashboard').then((m) => m.SwarmDashboard),
  detail: () => import('./SwarmDetail').then((m) => m.SwarmDetail),
  analytics: () => import('./SwarmAnalytics').then((m) => m.SwarmAnalytics),
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

const LazySwarmConvoPrefix = lazyPanel(() =>
  import('./SwarmConvoPrefix').then((m) => m.SwarmConvoPrefix)
);
type PrefixProps = { prefix: string; swarmId: string | null };

/**
 * The one swarm prefix card, bound to each tree's layout here so the core panes
 * (Chat / VirtualizedMessageList wide, mobile ConversationView narrow) keep
 * their call sites. TODO(T20): pass `layout` at those sites once their lanes
 * land, and export the lazy view alone.
 */
export const SwarmConvoPrefix = (props: PrefixProps) =>
  createElement(LazySwarmConvoPrefix, { ...props, layout: 'wide' });
export const MobileSwarmPrefix = (props: PrefixProps) =>
  createElement(LazySwarmConvoPrefix, { ...props, layout: 'narrow' });

export const InlineSwarmRunWidget = lazyPanel(() =>
  import('./InlineSwarmRunWidget').then((m) => m.InlineSwarmRunWidget)
);
