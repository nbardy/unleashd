import type {
  BuddyContext,
  ClientMessage,
  Conversation,
  ConversationConfig,
  ConversationConfigPatch,
  QueuedMessage,
} from '@unleashd/shared';
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { normalizeFolderDirectory } from '../utils/directories';
import { isWorktreeDirectory } from '../utils/swarmUtils';
import { getConversationLastActivity } from '../utils/time';

// =============================================================================
// Primary State Atoms
//
// These are the source-of-truth atoms. Mutations go through actions.ts or
// config-actions.ts (which call jotaiStore.set). React components call actions;
// they never mutate these maps directly.
// =============================================================================

export const conversationsAtom = atom(new Map<string, Conversation>());
export const conversationDetailsLoadedAtom = atom(new Set<string>());
export const conversationLoadCompleteAtom = atom(false);

export interface PendingConversationCreation {
  kind: 'create_conversation';
  commandId: string;
  conversationId: string;
  workingDirectory: string;
  config: ConversationConfig;
  buddyContext?: BuddyContext;
  createdAt: Date;
  error?: string;
  errorCode?: string;
}

export interface PendingConfigCommand {
  kind: 'set_conversation_config';
  commandId: string;
  conversationId: string;
  baseRevision: number;
  patch: ConversationConfigPatch;
  error?: string;
}

// Client-owned command state is intentionally separate from authoritative
// server Conversation snapshots. A pending create is not a partial Conversation.
export const pendingCreationsAtom = atom(new Map<string, PendingConversationCreation>());
export const pendingConfigCommandsAtom = atom(new Map<string, PendingConfigCommand>());

export const allPendingCreationsAtom = atom((get) =>
  Array.from(get(pendingCreationsAtom).values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )
);

// Streaming text — kept separate from conversations so Sidebar never re-renders
// at 60Hz during streaming. Flushed into conversations on stream end.
export const streamingContentAtom = atom(new Map<string, string>());

export const activeConversationIdAtom = atom<string | null>(null);
export const wsStatusAtom = atom<'connecting' | 'connected' | 'disconnected'>('connecting');
export const defaultCwdAtom = atom<string>('');

// The WebSocket send function — set by useWebSocketBridge once the socket connects.
// Stored as an atom so actions.ts can always call the current send fn without stale closures.
export const sendFnAtom = atom<{ send: (msg: ClientMessage) => void }>({
  send: () => {},
});

// =============================================================================
// Per-Item Derived Atoms (atomFamily)
//
// atomFamily memoizes one atom per ID. Components subscribing via
// useAtomValue(conversationAtomFamily(id)) only re-render when THAT conversation
// changes — not when unrelated conversations update. This is the Jotai equivalent
// of the Zustand per-ID selector pattern and is more principled: the dependency
// graph is explicit and tracked automatically.
//
// §5 #10 — atomFamily leaks: jotai-family memoizes per-ID atoms forever.
// handleMessage's conversation_deleted handler calls .remove(id) on every
// family below to free the memoized atom for long-lived (PWA) sessions.
// =============================================================================

// Single conversation by ID — use instead of s.conversations.get(id)
export const conversationAtomFamily = atomFamily((id: string) =>
  atom((get) => get(conversationsAtom).get(id) ?? null)
);

export const conversationDetailsLoadedAtomFamily = atomFamily((id: string) =>
  atom((get) => get(conversationDetailsLoadedAtom).has(id))
);

export const pendingCreationAtomFamily = atomFamily((id: string) =>
  atom((get) => get(pendingCreationsAtom).get(id) ?? null)
);

export const pendingConfigCommandAtomFamily = atomFamily((conversationId: string) =>
  atom(
    (get) =>
      Array.from(get(pendingConfigCommandsAtom).values()).find(
        (command) => command.conversationId === conversationId
      ) ?? null
  )
);

// Live streaming text for one conversation — use for Chat.tsx merge display
export const streamingAtomFamily = atomFamily((id: string) =>
  atom((get) => get(streamingContentAtom).get(id) ?? '')
);

// Child sessions for sub-agent panel (Chat.tsx) — scoped by parent ID
export const childConversationsAtomFamily = atomFamily((parentId: string) =>
  atom((get) => {
    const all = get(conversationsAtom);
    const children: Conversation[] = [];
    for (const conv of all.values()) {
      if (conv.parentConversationId === parentId) children.push(conv);
    }
    return children.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  })
);

// Stable empty queue — shared reference avoids new [] on every read
const EMPTY_QUEUE: QueuedMessage[] = [];

// Queue for one conversation — derived from conversationsAtom so mobile and
// desktop share the same authoritative server queue. No new state; this is a
// pure view over Conversation.queue. Components subscribe via
// useAtomValue(queueAtomFamily(id)) and get per-item cancel via
// cancelQueuedMessage/clearQueue (atoms/actions).
export const queueAtomFamily = atomFamily((id: string) =>
  atom((get) => get(conversationsAtom).get(id)?.queue ?? EMPTY_QUEUE)
);

// =============================================================================
// Derived Collection Atoms  (replaces derivedStore.ts entirely)
//
// Pure computed views — no subscribe(), no recompute(), no seed call.
// Jotai recomputes lazily when conversationsAtom changes. Never fires during
// streaming (streamingContentAtom changes don't affect these).
//
// ADDING A NEW VIEW: add one atom below. Components subscribe via
// useAtomValue(yourNewAtom). No other plumbing needed.
// =============================================================================

// All conversations sorted newest-first by last activity:
// last message timestamp when present, otherwise conversation creation time.
export const allConversationsAtom = atom((get) => {
  const map = get(conversationsAtom);
  return Array.from(map.values()).sort((a, b) => {
    const aTime = getConversationLastActivity(a).getTime();
    const bTime = getConversationLastActivity(b).getTime();
    return bTime - aTime;
  });
});

// Stable sorted ID list — only changes on add/delete/reorder.
// Use with atomFamily for per-item subtree pruning (see CLAUDE.md).
export const allConversationIdsAtom = atom((get) => get(allConversationsAtom).map((c) => c.id));

// Distinct real project folders, newest-first (allConversationsAtom is sorted).
// Worktrees are excluded — they are worker scratch dirs, never a folder a human
// would start a new conversation in. Feeds every "pick a directory" surface:
// desktop PathAutocomplete and the mobile create sheet.
export const recentDirectoriesAtom = atom((get) => {
  const seen = new Set<string>();
  for (const conv of get(allConversationsAtom)) {
    const dir = normalizeFolderDirectory(conv.workingDirectory);
    if (!isWorktreeDirectory(dir)) seen.add(dir);
  }
  return Array.from(seen);
});

const CHAT_INBOX_LIMIT = 50;

function isTemporaryDirectory(workingDirectory: string): boolean {
  const directory = workingDirectory.toLowerCase();
  return (
    directory === '/tmp' ||
    directory.startsWith('/tmp/') ||
    directory === '/private/tmp' ||
    directory.startsWith('/private/tmp/') ||
    directory === '/var/tmp' ||
    directory.startsWith('/var/tmp/') ||
    directory.includes('/private/var/folders/') ||
    directory.includes('/var/folders/') ||
    directory.includes('/temporaryitems/') ||
    directory.includes('/temp/')
  );
}

function isNestedWorktreeDirectory(workingDirectory: string): boolean {
  return (
    isWorktreeDirectory(workingDirectory) ||
    /\/\.w[^/]+-i\d+(?:\/|$)/.test(workingDirectory) ||
    /\/\.workers\/worker-\d+(?:\/|$)/.test(workingDirectory) ||
    workingDirectory.includes('/.claude/worktrees/')
  );
}

function isUserChatConversation(conversation: Conversation): boolean {
  return (
    !conversation.isWorker &&
    !conversation.parentConversationId &&
    !isNestedWorktreeDirectory(conversation.workingDirectory) &&
    !isTemporaryDirectory(conversation.workingDirectory)
  );
}

export interface ChatConversationInbox {
  /** Recent conversation IDs, already ordered newest-first and capped for rendering. */
  ids: string[];
  /** All user chat conversations before the render cap is applied. */
  total: number;
}

// User-facing chat inbox. Swarm workers, provider-native child sessions,
// worktrees, and temporary directories are operational noise rather than chats.
// Keep both filtering and the render cap in this derived view so mobile list
// components retain per-ID subscriptions and never materialize thousands of rows.
export const chatConversationInboxAtom = atom((get): ChatConversationInbox => {
  const conversations = get(allConversationsAtom).filter(isUserChatConversation);
  return {
    ids: conversations.slice(0, CHAT_INBOX_LIMIT).map((conversation) => conversation.id),
    total: conversations.length,
  };
});

export const chatConversationIdsAtom = atom((get) => get(chatConversationInboxAtom).ids);

// Total count — cheaper than subscribing to allConversationsAtom for existence checks
export const conversationCountAtom = atom((get) => get(conversationsAtom).size);

// =============================================================================
// Worker / Swarm Derived Atoms
//
// These atoms only read worker conversations from conversationsAtom. Because the
// Map uses structural sharing (non-worker updates don't change worker entries),
// these atoms produce the same result when only non-worker conversations change,
// so swarm components skip re-render on unrelated conversation events.
// =============================================================================

// Workers grouped by project directory (workingDirectory stripped to project root).
// Used by SwarmDashboard and SwarmAnalytics to build per-project views without
// subscribing to allConversationsAtom (which sorts ALL conversations on every change).
export const workersByProjectAtom = atom((get) => {
  const convs = get(conversationsAtom);
  const groups = new Map<string, Conversation[]>();
  for (const conv of convs.values()) {
    if (!conv.isWorker) continue;
    const root = conv.workingDirectory ?? 'unknown';
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(conv);
  }
  return groups;
});
