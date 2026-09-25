import { getBuddyContext, getConversationKind, isBuddyKind } from '@unleashd/shared';
import type {
  BuddyContext,
  ClientMessage,
  Conversation,
  ConversationConfig,
  ConversationConfigPatch,
  Message,
  QueuedMessage,
} from '@unleashd/shared';
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import {
  type MessageGroup,
  groupChatMessages,
  regroupChatMessages,
  withStreamingTail,
} from '../utils/chat-message-groups';
import { getProjectRoot } from '../utils/swarmUtils';
import { archivedBuddyIdsAtom } from './buddy-visibility';
import {
  type ConversationIndex,
  type ConversationListEntry,
  EMPTY_CONVERSATION_INDEX,
  directoryFacts,
  updateConversationIndex,
} from './conversation-index';
import {
  atomWithPrevious,
  keyedAtoms,
  sameItems,
  sameMap,
  sameSet,
  stableAtom,
} from './structural';
import { promotedWorkersAtom, savedActiveConversationIdAtom } from './ui';

export type { ConversationListEntry } from './conversation-index';

// =============================================================================
// Primary State Atoms
//
// These are the source-of-truth atoms. Mutations go through actions.ts or
// config-actions.ts (which call jotaiStore.set). React components call actions;
// they never mutate these maps directly.
// =============================================================================

// The authoritative conversations. Components never subscribe to the whole
// map (AGENTS.md); actions read it imperatively and write it through
// `conversationsAtom` (replace everything: init, reconnect, tests) or
// `conversationPatchAtom` (named ids). Each write sets only the per-id record
// atoms it touched and moves the list index in the same step, so an event
// about conversation A does no work for conversation B. Reading the map from
// every per-id atom made all of them recompute on every event (03-app-core
// §6.2 #7).
const conversationIndexAtom = atom<ConversationIndex>(EMPTY_CONVERSATION_INDEX);

const conversationRecords = keyedAtoms<Conversation, null>({
  label: 'conversation',
  absent: null,
  onCommit: (get, set, next, changed) =>
    set(conversationIndexAtom, updateConversationIndex(get(conversationIndexAtom), next, changed)),
});

export const conversationsAtom = conversationRecords.all;
export const conversationPatchAtom = conversationRecords.patch;
const conversationRecordAtomFamily = conversationRecords.byKey;

export const conversationDetailsLoadedAtom = atom<ReadonlySet<string>>(new Set<string>());
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
// at 60Hz during streaming. Keyed per conversation: a frame of text for A
// touches only A's atom (the plain Map form recomputed every mounted reader).
const streamingText = keyedAtoms<string, ''>({ label: 'streaming', absent: '' });
export const streamingContentAtom = streamingText.all;
export const streamingPatchAtom = streamingText.patch;

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
// Each reads its own conversation's record atom, never the whole map, so it
// recomputes only when THAT conversation changes. The debug labels
// (`chatMessageGroups:<id>`) let the render-isolation test find every atom
// scoped to one id (client/test/conversation-event-isolation.test.tsx).
//
// §5 #10 — atomFamily leaks: jotai-family memoizes per-ID atoms forever.
// handleMessage's conversation_deleted handler calls forgetConversationAtoms
// to free them for long-lived (PWA) sessions.
// =============================================================================

function labelled<T extends { debugLabel?: string }>(value: T, label: string): T {
  value.debugLabel = label;
  return value;
}

// Single conversation by ID — use instead of s.conversations.get(id)
export const conversationAtomFamily = atomFamily((id: string) =>
  labelled(
    atom((get) => {
      const conversation = get(conversationRecordAtomFamily(id));
      const buddyId = conversation && getBuddyContext(conversation)?.buddyId;
      return buddyId && get(archivedBuddyIdsAtom).has(buddyId) ? null : conversation;
    }),
    `conversationView:${id}`
  )
);

export const conversationDetailsLoadedAtomFamily = atomFamily((id: string) =>
  labelled(
    atom((get) => get(conversationDetailsLoadedAtom).has(id)),
    `detailsLoaded:${id}`
  )
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
export const streamingAtomFamily = streamingText.byKey;

const EMPTY_MESSAGES: readonly Message[] = [];

// The transcript records alone: the same array while only status, queue or
// other fields change, so grouping does not rerun for those.
const conversationMessagesAtomFamily = atomFamily((id: string) =>
  atom((get) => get(conversationAtomFamily(id))?.messages ?? EMPTY_MESSAGES)
);

// Swarm debug prefix stripped from the first user record (never for Buddies).
const groupPrefixAtomFamily = atomFamily((id: string) =>
  atom((get) => {
    const conversation = get(conversationAtomFamily(id));
    if (!conversation) return null;
    return isBuddyKind(getConversationKind(conversation)) || getBuddyContext(conversation)
      ? null
      : (conversation.swarmDebugPrefix ?? null);
  })
);

interface SettledGroups {
  messages: readonly Message[];
  prefix: string | null;
  groups: MessageGroup[];
}

// Groups of the committed records. A new record (or a grown last response)
// rebuilds only the last group; earlier groups keep their identity.
const settledMessageGroupsAtomFamily = atomFamily((id: string) =>
  atomWithPrevious((get, previous: SettledGroups | undefined): SettledGroups => {
    const messages = get(conversationMessagesAtomFamily(id));
    const prefix = get(groupPrefixAtomFamily(id));
    if (previous && previous.messages === messages && previous.prefix === prefix) return previous;
    const groups =
      previous && previous.prefix === prefix
        ? regroupChatMessages(previous.groups, previous.messages, messages, prefix)
        : groupChatMessages(messages, prefix);
    return { messages, prefix, groups };
  })
);

// Shared response projection; streaming content never enters the durable
// snapshot. While a reply streams (~60 frames a second) only the last group is
// rebuilt: every other group is the settled object, so VirtualizedGroup skips.
export const chatMessageGroupsAtomFamily = atomFamily((id: string) =>
  labelled(
    atom((get) => {
      const settled = get(settledMessageGroupsAtomFamily(id));
      return withStreamingTail(
        settled.groups,
        settled.messages,
        get(streamingAtomFamily(id)),
        settled.prefix
      );
    }),
    `chatMessageGroups:${id}`
  )
);

// Stable empty queue — shared reference avoids new [] on every read
const EMPTY_QUEUE: QueuedMessage[] = [];

// Queue for one conversation — a pure view over Conversation.queue, so mobile
// and desktop share the authoritative server queue. Per-item cancel goes
// through cancelQueuedMessage/clearQueue (atoms/actions).
export const queueAtomFamily = atomFamily((id: string) =>
  labelled(
    atom((get) => get(conversationRecordAtomFamily(id))?.queue ?? EMPTY_QUEUE),
    `queue:${id}`
  )
);

// =============================================================================
// Derived Collection Atoms
//
// All read the list index (atoms/conversation-index.ts): entries holding only
// the fields views filter, group and sort on. The list is a new array only
// when one of those fields changed, so message, queue, sub-agent and
// streaming events recompute none of these. When they do recompute, each
// hands back its previous value if its output is unchanged (`stableAtom`), so
// a subscriber re-renders only when its own view moved.
//
// ADDING A NEW VIEW: read `conversationListAtom` (add a field to
// ConversationListEntry if you need one), return ids or entries, and wrap it
// in `stableAtom`. Rows subscribe per id through `conversationAtomFamily`.
// =============================================================================

/** Every visible conversation (archived Buddies excluded), newest-first. */
export const conversationListAtom = stableAtom((get): readonly ConversationListEntry[] => {
  const { list } = get(conversationIndexAtom);
  const archived = get(archivedBuddyIdsAtom);
  if (archived.size === 0) return list;
  return list.filter((entry) => !entry.buddyId || !archived.has(entry.buddyId));
}, sameItems);

// True once the conversation restore-on-load wants to reopen has hydrated. A
// boolean, so App re-renders once rather than on every conversation event.
// It must track the SAVED id, not "any conversation": startup hydrates in
// batches, and a "has any" flag flips on the first batch and never again, so a
// saved chat arriving in a later batch was never restored (review of 984d00f).
export const savedActiveConversationPresentAtom = atom((get) => {
  const savedId = get(savedActiveConversationIdAtom);
  return savedId !== null && get(conversationRecordAtomFamily(savedId)) !== null;
});

// Stable sorted ID list — a new array only on add/delete/reorder.
// Use with atomFamily for per-item subtree pruning (see CLAUDE.md).
export const allConversationIdsAtom = stableAtom(
  (get) => get(conversationListAtom).map((entry) => entry.id),
  sameItems
);

// "Does the client still hold this conversation?" — the check every
// open-conversation affordance makes before rendering a Link (AGENTS.md). One
// Set for every surface, and the SAME Set until membership changes: a reorder
// used to rebuild it and re-render every subscriber (each BuddyWorkerThreadBadge).
export const availableConversationIdSetAtom = stableAtom<ReadonlySet<string>>(
  (get) => new Set(get(allConversationIdsAtom)),
  sameSet
);

// Distinct real project folders, newest-first. Worktrees are excluded — they
// are worker scratch dirs, never a folder a human would start a new
// conversation in. Feeds every "pick a directory" surface: desktop
// PathAutocomplete and the mobile create sheet.
export const recentDirectoriesAtom = stableAtom((get) => {
  const seen = new Set<string>();
  for (const entry of get(conversationListAtom)) {
    const directory = directoryFacts(entry.workingDirectory);
    if (!directory.isWorktree) seen.add(directory.folder);
  }
  return Array.from(seen);
}, sameItems);

/** Working directory of the most recently active conversation, if any. */
export const latestWorkingDirectoryAtom = atom(
  (get) => get(conversationListAtom)[0]?.workingDirectory ?? null
);

const CHAT_INBOX_LIMIT = 50;

// Swarm workers, provider-native child sessions, worktrees, and temporary
// directories are operational noise rather than chats.
function isUserChat(entry: ConversationListEntry): boolean {
  return (
    entry.placement !== 'background' &&
    !entry.isWorker &&
    !entry.parentConversationId &&
    !directoryFacts(entry.workingDirectory).isScratch
  );
}

export interface ChatConversationInbox {
  /** Recent conversation IDs, already ordered newest-first and capped for rendering. */
  ids: readonly string[];
  /** All user chat conversations before the render cap is applied. */
  total: number;
}

// User-facing chat inbox. Keep both filtering and the render cap in this
// derived view so mobile list components retain per-ID subscriptions and never
// materialize thousands of rows.
export const chatConversationInboxAtom = stableAtom(
  (get): ChatConversationInbox => {
    const ids: string[] = [];
    let total = 0;
    for (const entry of get(conversationListAtom)) {
      if (!isUserChat(entry)) continue;
      total += 1;
      if (ids.length < CHAT_INBOX_LIMIT) ids.push(entry.id);
    }
    return { ids, total };
  },
  (a, b) => a.total === b.total && sameItems(a.ids, b.ids)
);

export const chatConversationIdsAtom = atom((get) => get(chatConversationInboxAtom).ids);

// Desktop gallery: top-level conversations (no child whose parent is listed),
// newest-CREATED first. The gallery used to derive
// this in a component memo with a date parse per comparison.
export const galleryConversationsAtom = stableAtom((get) => {
  const listed = get(availableConversationIdSetAtom);
  return get(conversationListAtom)
    .filter((entry) => !(entry.parentConversationId && listed.has(entry.parentConversationId)))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}, sameItems);

// "Are there any conversations?" — a boolean, so subscribers re-render only
// when it flips, not on every add/delete.
export const hasConversationsAtom = atom((get) => get(conversationIndexAtom).byId.size > 0);

// =============================================================================
// Child sessions (sub-agent panel in Chat) — scoped by parent ID
// =============================================================================

const EMPTY_IDS: readonly string[] = [];

// parent id → child ids, oldest first. Rebuilt only when the list moves; a
// parent whose children did not change keeps the same array.
const childIdsByParentAtom = stableAtom(
  (get) => {
    const children = new Map<string, ConversationListEntry[]>();
    for (const entry of get(conversationIndexAtom).list) {
      const parentId = entry.parentConversationId;
      if (!parentId) continue;
      const siblings = children.get(parentId);
      if (siblings) siblings.push(entry);
      else children.set(parentId, [entry]);
    }
    const ids = new Map<string, readonly string[]>();
    for (const [parentId, siblings] of children) {
      ids.set(
        parentId,
        siblings.sort((a, b) => a.createdAtMs - b.createdAtMs).map((entry) => entry.id)
      );
    }
    return ids;
  },
  (a, b) => sameMap(a, b, sameItems)
);

const childIdsAtomFamily = atomFamily((parentId: string) =>
  stableAtom((get) => get(childIdsByParentAtom).get(parentId) ?? EMPTY_IDS, sameItems)
);

const EMPTY_CONVERSATIONS: readonly Conversation[] = [];

export const childConversationsAtomFamily = atomFamily((parentId: string) =>
  labelled(
    atom((get): readonly Conversation[] => {
      const ids = get(childIdsAtomFamily(parentId));
      if (ids.length === 0) return EMPTY_CONVERSATIONS;
      return ids.flatMap((id) => get(conversationRecordAtomFamily(id)) ?? []);
    }),
    `childConversations:${parentId}`
  )
);

// =============================================================================
// Worker / Swarm Derived Atoms
//
// Worker ids come from the list index; worker records are read per id, so
// swarm views recompute only when a worker conversation changes.
// =============================================================================

const workerIdsAtom = stableAtom(
  (get) =>
    get(conversationIndexAtom)
      .list.filter((entry) => entry.isWorker)
      .map((entry) => entry.id),
  sameItems
);

const EMPTY_WORKERS: readonly Conversation[] = [];

// Swarm workers grouped by PROJECT root (oompa's worktree suffix stripped),
// promoted workers excluded (they live in the main views). Every swarm view,
// desktop and mobile, reads this one grouping; six of them used to re-derive
// it in a component memo from a map keyed by raw working directory.
export const swarmWorkersByProjectAtom = atom((get) => {
  const promoted = new Set(get(promotedWorkersAtom));
  const groups = new Map<string, Conversation[]>();
  for (const id of get(workerIdsAtom)) {
    if (promoted.has(id)) continue;
    const conv = get(conversationRecordAtomFamily(id));
    if (!conv) continue;
    const root = getProjectRoot(conv.workingDirectory);
    const group = groups.get(root);
    if (group) group.push(conv);
    else groups.set(root, [conv]);
  }
  return groups as ReadonlyMap<string, readonly Conversation[]>;
});

/** One project's swarm workers (see `swarmWorkersByProjectAtom`). */
export const swarmWorkersForProjectAtomFamily = atomFamily((projectRoot: string) =>
  atom((get) => get(swarmWorkersByProjectAtom).get(projectRoot) ?? EMPTY_WORKERS)
);

/** Free every per-id atom memoized for a deleted conversation. */
export function forgetConversationAtoms(id: string): void {
  conversationRecords.forget(id);
  streamingText.forget(id);
  conversationAtomFamily.remove(id);
  conversationMessagesAtomFamily.remove(id);
  groupPrefixAtomFamily.remove(id);
  settledMessageGroupsAtomFamily.remove(id);
  chatMessageGroupsAtomFamily.remove(id);
  conversationDetailsLoadedAtomFamily.remove(id);
  pendingCreationAtomFamily.remove(id);
  pendingConfigCommandAtomFamily.remove(id);
  childIdsAtomFamily.remove(id);
  childConversationsAtomFamily.remove(id);
  queueAtomFamily.remove(id);
}
