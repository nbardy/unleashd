import { type DeviceUiPrefs, DeviceUiPrefsSchema, SeenMessageIndexSchema } from '@unleashd/shared';
import { atomWithStorage } from 'jotai/utils';
import type { SyncStorage } from 'jotai/vanilla/utils/atomWithStorage';
import { jotaiStore } from './store';

// =============================================================================
// Device UI state — browser localStorage only, never synced to the server.
//
//   prefs ('unleashd-ui-local') — view state: last conversation (restore only;
//     the route owns the active id), gallery
//     expansion, list toggles, view mode, last directory, promoted workers.
//   seen ('unleashd-seen-message-index') — NEW badge: last viewed message
//     index per conversation. Its own key because
//     it changes on every viewed message; the prefs blob should not be
//     rewritten at that rate.
//
// Done (hidden) is NOT here: it is a fact about the conversation, stored on
// the server's conversation record and read as `conversation.done`. It used to
// live in a server-synced blob keyed by `sessionId ?? id`; the server rotates
// sessionId, and the blob's debounced snapshot POST lost writes on refresh
// and reconnect — hidden conversations kept reappearing (2026-09-23).
//
// Mutate ONLY via the exported action functions — jotaiStore.set lives inside
// atoms/ (gate G1).
// =============================================================================

export const LOCAL_STORAGE_KEY = 'unleashd-ui-local';
const SEEN_STORAGE_KEY = 'unleashd-seen-message-index';

const PREFS_DEFAULTS: DeviceUiPrefs = {
  activeConversationId: null,
  galleryExpandedProjects: [],
  galleryCollapsedProjects: [],
  showTempSessions: false,
  showDoneConversations: false,
  showWorkerConversations: false,
  sidebarViewMode: 'grouped',
  lastWorkingDirectory: null,
  promotedWorkers: [],
};

// ---------------------------------------------------------------------------
// External Keys (raw localStorage, outside any store — documented here)
//
// draft:{conversationId}   — Written from uncontrolled textarea via refs in
//                            Chat.tsx. Must bypass React render cycle.
// pendingFiles:{conversationId} — Serialized array of files awaiting send
//                            (images only, previewUrl omitted — object URL).
// restartRecovery:{conversationId} — Last server queue mirror retained across
//                            restart so interrupted work can be optionally replayed.
// ---------------------------------------------------------------------------
export const DRAFT_KEY_PREFIX = 'draft:';
export const PENDING_FILES_KEY_PREFIX = 'pendingFiles:';

// ---------------------------------------------------------------------------
// Validated storage. An invalid blob is discarded whole and defaults are used
// (no half-merge).
// ---------------------------------------------------------------------------

function validatedStorage<T>(parse: (raw: unknown, initialValue: T) => T | null): SyncStorage<T> {
  return {
    getItem: (key, initialValue) => {
      try {
        if (typeof localStorage === 'undefined') return initialValue;
        const raw = localStorage.getItem(key);
        if (!raw) return initialValue;
        const parsed = parse(JSON.parse(raw), initialValue);
        if (parsed === null) {
          localStorage.removeItem(key);
          return initialValue;
        }
        return parsed;
      } catch {
        return initialValue;
      }
    },
    setItem: (key, value) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // quota / private-mode failure — in-memory state still updates
      }
    },
    removeItem: (key) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

// Partial parse over defaults so a blob written before a field existed still
// loads; zod strips keys that are no longer prefs.
const prefsStorage = validatedStorage<DeviceUiPrefs>((raw, initialValue) => {
  const result = DeviceUiPrefsSchema.partial().safeParse(raw);
  return result.success ? { ...initialValue, ...result.data } : null;
});

const seenStorage = validatedStorage<Record<string, number>>((raw) => {
  const result = SeenMessageIndexSchema.safeParse(raw);
  return result.success ? result.data : null;
});

// getOnInit — read synchronously at first get so App.tsx restore-on-load sees
// the persisted activeConversationId on its initial render.
// Read with `useAtomValue(prefsAtom).field`: prefs change only on a user
// action, so one atom replaces the nine per-field ones it had until T19.
export const prefsAtom = atomWithStorage<DeviceUiPrefs>(
  LOCAL_STORAGE_KEY,
  PREFS_DEFAULTS,
  prefsStorage,
  { getOnInit: true }
);

/** Last seen message index per conversation; rows read it through `unreadFamily`. */
export const seenAtom = atomWithStorage<Record<string, number>>(SEEN_STORAGE_KEY, {}, seenStorage, {
  getOnInit: true,
});

// ---------------------------------------------------------------------------
// Actions — the only mutation surface.
// ---------------------------------------------------------------------------

function setPrefs(patch: Partial<DeviceUiPrefs>): void {
  jotaiStore.set(prefsAtom, { ...jotaiStore.get(prefsAtom), ...patch });
}

export function setSavedActiveConversationId(id: string | null): void {
  setPrefs({ activeConversationId: id });
}

export function setLastWorkingDirectory(dir: string): void {
  setPrefs({ lastWorkingDirectory: dir });
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function toggleGalleryExpanded(dir: string): void {
  setPrefs({
    galleryExpandedProjects: toggleInList(jotaiStore.get(prefsAtom).galleryExpandedProjects, dir),
  });
}

export function toggleGalleryCollapsed(dir: string): void {
  setPrefs({
    galleryCollapsedProjects: toggleInList(jotaiStore.get(prefsAtom).galleryCollapsedProjects, dir),
  });
}

export function setShowTempSessions(show: boolean): void {
  setPrefs({ showTempSessions: show });
}

export function setShowDoneConversations(show: boolean): void {
  setPrefs({ showDoneConversations: show });
}

export function setShowWorkerConversations(show: boolean): void {
  setPrefs({ showWorkerConversations: show });
}

export function promoteWorker(conversationId: string): void {
  const promoted = jotaiStore.get(prefsAtom).promotedWorkers;
  if (!promoted.includes(conversationId)) {
    setPrefs({ promotedWorkers: [...promoted, conversationId] });
  }
}

// No bulk "mark seen" on row updates: it ran on every poller batch and hid
// NEW for exactly the external updates the badge exists to show (03 §6.2 #9).
export function markMessagesSeen(conversationId: string, messageIndex: number): void {
  const current = jotaiStore.get(seenAtom);
  if (current[conversationId] === messageIndex) return;
  jotaiStore.set(seenAtom, { ...current, [conversationId]: messageIndex });
}

/** Drop the seen-index entry for a deleted conversation. */
export function removeSeenIndex(conversationId: string): void {
  const current = jotaiStore.get(seenAtom);
  if (!(conversationId in current)) return;
  const { [conversationId]: _removed, ...rest } = current;
  jotaiStore.set(seenAtom, rest);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** NEW badge: messages past the last one this device saw. No index means
 *  never opened here, which is not "unseen". */
export function hasUnseenAfter(lastSeen: number | undefined, totalMessages: number): boolean {
  if (totalMessages === 0 || lastSeen === undefined) return false;
  return lastSeen < totalMessages - 1;
}

