import type { ConversationRow } from '@unleashd/shared';

export type MobilePrimarySection = 'chats' | 'channels' | 'swarms' | 'buddies' | 'search';

const MOBILE_PRIMARY_SECTIONS: readonly MobilePrimarySection[] = [
  'chats',
  'channels',
  'swarms',
  'buddies',
  'search',
];

// Channels live under /buddies/workspaces/:id/channels (one URL on both
// devices); /channels is the tab's entry point that picks a workspace.
const CHANNELS_PATH = /^\/buddies\/workspaces\/[^/]+\/channels\/?$/;

export interface MobileConversationOrigin {
  section: MobilePrimarySection;
  pathname: string;
  search: string;
  hash: string;
}

type RouteLocation = {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInternalPathname(pathname: string): boolean {
  return pathname.startsWith('/') && !pathname.startsWith('//');
}

export function mobilePrimarySectionForPath(pathname: string): MobilePrimarySection {
  if (pathname === '/channels' || CHANNELS_PATH.test(pathname)) return 'channels';
  if (pathname === '/buddies' || pathname.startsWith('/buddies/')) return 'buddies';
  if (pathname === '/workers' || pathname.startsWith('/workers/')) return 'swarms';
  if (pathname === '/search' || pathname.startsWith('/search/')) return 'search';
  return 'chats';
}

export function readMobileConversationOrigin(state: unknown): MobileConversationOrigin | null {
  if (!isRecord(state) || !isRecord(state.mobileConversationOrigin)) return null;
  const origin = state.mobileConversationOrigin;
  if (
    typeof origin.pathname !== 'string' ||
    !isInternalPathname(origin.pathname) ||
    typeof origin.search !== 'string' ||
    typeof origin.hash !== 'string' ||
    !MOBILE_PRIMARY_SECTIONS.includes(origin.section as MobilePrimarySection)
  )
    return null;
  const section = origin.section as MobilePrimarySection;
  if (mobilePrimarySectionForPath(origin.pathname) !== section) return null;
  return {
    section,
    pathname: origin.pathname,
    search: origin.search,
    hash: origin.hash,
  };
}

/**
 * Carries a transient return location into `/chat/:id` without introducing a
 * second persisted active-route authority. Forks keep the original source.
 */
export function mobileConversationRouteState(location: RouteLocation): Record<string, unknown> {
  const currentState = isRecord(location.state) ? location.state : {};
  const inherited = readMobileConversationOrigin(location.state);
  const origin =
    location.pathname.startsWith('/chat/') && inherited
      ? inherited
      : {
          section: mobilePrimarySectionForPath(location.pathname),
          pathname: location.pathname,
          search: location.search ?? '',
          hash: location.hash ?? '',
        };
  return { ...currentState, mobileConversationOrigin: origin };
}

export interface MobileConversationDestination {
  path: string;
  section: MobilePrimarySection;
}

export function fallbackMobileConversationDestination(
  conversation: ConversationRow | null | undefined
): MobileConversationDestination {
  const kind = conversation?.kind ?? { t: 'chat' as const };
  switch (kind.t) {
    case 'builder':
      return { path: '/buddies', section: 'buddies' };
    case 'buddy': {
      const tab = kind.visibility === 'background' ? 'background' : 'conversations';
      return { path: `/buddies/${encodeURIComponent(kind.buddyId)}/${tab}`, section: 'buddies' };
    }
    case 'worker':
      return { path: '/workers', section: 'swarms' };
    case 'chat':
      return { path: '/', section: 'chats' };
  }
}

export function resolveMobileConversationDestination(
  state: unknown,
  conversation: ConversationRow | null | undefined
): MobileConversationDestination {
  const origin = readMobileConversationOrigin(state);
  if (!origin) return fallbackMobileConversationDestination(conversation);
  return {
    path: `${origin.pathname}${origin.search}${origin.hash}`,
    section: origin.section,
  };
}
