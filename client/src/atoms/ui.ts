import { UIStateSchema, type UIState } from '@unleashd/shared';
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { SyncStorage } from 'jotai/vanilla/utils/atomWithStorage';
import { jotaiStore } from './store';

// =============================================================================
// UI state — jotai fold of the former zustand uiStore (PLANNING_MOBILE.md §4).
//
// Partition (unchanged semantics; partitionUiState was the migration map):
//   shared (4) — cross-device, debounced POST /api/ui-state:
//     doneConversations, promotedWorkers, lastSeenMessageIndex, lastWorkingDirectory
//   local (7) — per-device, atomWithStorage under 'unleashd-ui-local'
//     (same key + blob shape as the zustand version — existing data loads as-is):
//     activeConversationId, galleryExpandedProjects, galleryCollapsedProjects,
//     showTempSessions, showDoneConversations, showWorkerConversations, sidebarViewMode
//
// Rationale: two concurrent clients (phone + desktop) race on local fields;
// partitioning prevents last-writer-wins cross-device churn.
//
// NEW badge: lastSeenMessageIndex tracks the last viewed message index per
// conversation; see docs/new_badge_feature.md.
//
// Subscribe via the per-field derived atoms below (jotai skips notification
// when the derived value is Object.is-equal, so per-field granularity is
// preserved). Mutate ONLY via the exported action functions — jotaiStore.set
// lives inside atoms/ (gate G1).
// =============================================================================

export const LOCAL_STORAGE_KEY = 'unleashd-ui-local';

export type SharedSlice = Pick<
  UIState,
  'doneConversations' | 'promotedWorkers' | 'lastSeenMessageIndex' | 'lastWorkingDirectory'
>;

export type LocalSlice = Pick<
  UIState,
  | 'activeConversationId'
  | 'galleryExpandedProjects'
  | 'galleryCollapsedProjects'
  | 'showTempSessions'
  | 'showDoneConversations'
  | 'showWorkerConversations'
  | 'sidebarViewMode'
>;

const LOCAL_DEFAULTS: LocalSlice = {
  activeConversationId: null,
  galleryExpandedProjects: [],
  galleryCollapsedProjects: [],
  showTempSessions: false,
  showDoneConversations: false,
  showWorkerConversations: false,
  sidebarViewMode: 'grouped',
};

const SHARED_DEFAULTS: SharedSlice = {
  doneConversations: [],
  promotedWorkers: [],
  lastSeenMessageIndex: {},
  lastWorkingDirectory: null,
};

// ---------------------------------------------------------------------------
// External Keys (raw localStorage, outside any store — documented here)
//
// draft:{conversationId}   — Written from uncontrolled textarea via refs in
//                            Chat.tsx. Must bypass React render cycle.
// pendingConversations     — Read/written inside actions.ts during
//                            WebSocket init (non-React context).
// pendingFiles:{conversationId} — Serialized array of files awaiting send
//                            (images only, previewUrl omitted — object URL).
// ---------------------------------------------------------------------------
export const DRAFT_KEY_PREFIX = 'draft:';
export const PENDING_CONVERSATIONS_KEY = 'pendingConversations';
export const PENDING_FILES_KEY_PREFIX = 'pendingFiles:';

// ---------------------------------------------------------------------------
// Local slice — atomWithStorage with Zod-validated reads.
// Invalid blob → discard whole blob, fall back to defaults (no half-merge).
// ---------------------------------------------------------------------------

function pickLocal(data: Partial<UIState>): Partial<LocalSlice> {
  const local: Partial<LocalSlice> = {};
  if ('activeConversationId' in data) local.activeConversationId = data.activeConversationId ?? null;
  if (data.galleryExpandedProjects !== undefined) local.galleryExpandedProjects = data.galleryExpandedProjects;
  if (data.galleryCollapsedProjects !== undefined) local.galleryCollapsedProjects = data.galleryCollapsedProjects;
  if (data.showTempSessions !== undefined) local.showTempSessions = data.showTempSessions;
  if (data.showDoneConversations !== undefined) local.showDoneConversations = data.showDoneConversations;
  if (data.showWorkerConversations !== undefined) local.showWorkerConversations = data.showWorkerConversations;
  if (data.sidebarViewMode !== undefined) local.sidebarViewMode = data.sidebarViewMode;
  return local;
}

const validatedLocalStorage: SyncStorage<LocalSlice> = {
  getItem: (key, initialValue) => {
    try {
      if (typeof localStorage === 'undefined') return initialValue;
      const raw = localStorage.getItem(key);
      if (!raw) return initialValue;
      const result = UIStateSchema.partial().safeParse(JSON.parse(raw));
      if (!result.success) {
        localStorage.removeItem(key);
        return initialValue;
      }
      return { ...initialValue, ...pickLocal(result.data) };
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

// getOnInit — read synchronously at first get so App.tsx restore-on-load sees
// the persisted activeConversationId on its initial render.
const uiLocalAtom = atomWithStorage<LocalSlice>(LOCAL_STORAGE_KEY, LOCAL_DEFAULTS, validatedLocalStorage, {
  getOnInit: true,
});

const uiSharedAtom = atom<SharedSlice>(SHARED_DEFAULTS);

// ---------------------------------------------------------------------------
// Per-field read atoms — subscribe to these, never the slice atoms.
// ---------------------------------------------------------------------------

/** Persisted last-active conversation (device-local). Distinct from the
 *  ephemeral routing atom `activeConversationIdAtom` in conversations.ts —
 *  the "dual-active-id" design (this one survives reload). */
export const savedActiveConversationIdAtom = atom((get) => get(uiLocalAtom).activeConversationId);
export const galleryExpandedProjectsAtom = atom((get) => get(uiLocalAtom).galleryExpandedProjects);
export const galleryCollapsedProjectsAtom = atom((get) => get(uiLocalAtom).galleryCollapsedProjects);
export const showTempSessionsAtom = atom((get) => get(uiLocalAtom).showTempSessions);
export const showDoneConversationsAtom = atom((get) => get(uiLocalAtom).showDoneConversations);
export const showWorkerConversationsAtom = atom((get) => get(uiLocalAtom).showWorkerConversations);
export const sidebarViewModeAtom = atom((get) => get(uiLocalAtom).sidebarViewMode);

export const doneConversationsAtom = atom((get) => get(uiSharedAtom).doneConversations);
export const promotedWorkersAtom = atom((get) => get(uiSharedAtom).promotedWorkers);
export const lastSeenMessageIndexAtom = atom((get) => get(uiSharedAtom).lastSeenMessageIndex);
export const lastWorkingDirectoryAtom = atom((get) => get(uiSharedAtom).lastWorkingDirectory);

// ---------------------------------------------------------------------------
// Shared-slice server sync — debounced POST, gated until hydration.
//
// Guard: don't sync default (empty) state before hydration. Without this,
// Chat's mount-time mutations fire before the WS init delivers authoritative
// server state and overwrite persisted doneConversations/lastSeenMessageIndex
// with empty defaults.
// ---------------------------------------------------------------------------

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

function scheduleSharedSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (!hydrated) return;
    fetch('/api/ui-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jotaiStore.get(uiSharedAtom)),
    })
      .then((res) => {
        if (!res.ok) console.warn(`[UI State] Sync failed: ${res.status} ${res.statusText}`);
      })
      .catch((err) => console.warn('[UI State] Sync error:', err));
  }, 500);
}

function setLocal(patch: Partial<LocalSlice>): void {
  jotaiStore.set(uiLocalAtom, { ...jotaiStore.get(uiLocalAtom), ...patch });
}

function setShared(recipe: (s: SharedSlice) => Partial<SharedSlice>): void {
  const current = jotaiStore.get(uiSharedAtom);
  jotaiStore.set(uiSharedAtom, { ...current, ...recipe(current) });
  scheduleSharedSync();
}

/**
 * Apply server state. Merges ONLY the shared slice — local fields are
 * device-owned and never overwritten by another client's values. Called on
 * WS init. Syncs back afterward so pre-hydration mutations aren't lost if
 * the server restarts before the next user-initiated mutation.
 */
export function hydrateUiFromServer(serverState: UIState): void {
  jotaiStore.set(uiSharedAtom, {
    doneConversations: serverState.doneConversations,
    promotedWorkers: serverState.promotedWorkers,
    lastSeenMessageIndex: serverState.lastSeenMessageIndex,
    lastWorkingDirectory: serverState.lastWorkingDirectory,
  });
  hydrated = true;
  scheduleSharedSync();
}

// ---------------------------------------------------------------------------
// Actions — the only mutation surface.
// ---------------------------------------------------------------------------

export function setSavedActiveConversationId(id: string | null): void {
  setLocal({ activeConversationId: id });
}

export function setLastWorkingDirectory(dir: string): void {
  setShared(() => ({ lastWorkingDirectory: dir }));
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function toggleGalleryExpanded(dir: string): void {
  setLocal({ galleryExpandedProjects: toggleInList(jotaiStore.get(uiLocalAtom).galleryExpandedProjects, dir) });
}

export function toggleGalleryCollapsed(dir: string): void {
  setLocal({ galleryCollapsedProjects: toggleInList(jotaiStore.get(uiLocalAtom).galleryCollapsedProjects, dir) });
}

export function setShowTempSessions(show: boolean): void {
  setLocal({ showTempSessions: show });
}

export function setShowDoneConversations(show: boolean): void {
  setLocal({ showDoneConversations: show });
}

export function setShowWorkerConversations(show: boolean): void {
  setLocal({ showWorkerConversations: show });
}

export function setSidebarViewMode(mode: 'grouped' | 'list'): void {
  setLocal({ sidebarViewMode: mode });
}

export function markDone(conversationId: string): void {
  setShared((s) =>
    s.doneConversations.includes(conversationId)
      ? {}
      : { doneConversations: [...s.doneConversations, conversationId] },
  );
}

export function unmarkDone(conversationId: string): void {
  setShared((s) => ({ doneConversations: s.doneConversations.filter((id) => id !== conversationId) }));
}

export function promoteWorker(conversationId: string): void {
  setShared((s) =>
    s.promotedWorkers.includes(conversationId) ? {} : { promotedWorkers: [...s.promotedWorkers, conversationId] },
  );
}

export function demoteToWorker(conversationId: string): void {
  setShared((s) => ({ promotedWorkers: s.promotedWorkers.filter((id) => id !== conversationId) }));
}

export function markMessagesSeen(conversationId: string, messageIndex: number): void {
  setShared((s) => ({
    lastSeenMessageIndex: { ...s.lastSeenMessageIndex, [conversationId]: messageIndex },
  }));
}

/** Bulk-seen after external JSONL edits — conservative: better to miss a badge
 *  than show a wrong one. */
export function markConversationsSeenBulk(updates: Record<string, number>): void {
  setShared((s) => ({ lastSeenMessageIndex: { ...s.lastSeenMessageIndex, ...updates } }));
}

/** Drop the seen-index entry for a deleted conversation. */
export function removeSeenIndex(conversationId: string): void {
  setShared((s) => {
    const { [conversationId]: _removed, ...rest } = s.lastSeenMessageIndex;
    return { lastSeenMessageIndex: rest };
  });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function hasUnseenMessages(
  lastSeenMessageIndex: Record<string, number>,
  conversationId: string,
  totalMessages: number,
): boolean {
  if (totalMessages === 0) return false;
  const lastSeen = lastSeenMessageIndex[conversationId];
  if (lastSeen === undefined) return false;
  return lastSeen < totalMessages - 1;
}

/** Non-React read of the persisted active id (actions.ts, WS handlers). */
export function getSavedActiveConversationId(): string | null {
  return jotaiStore.get(uiLocalAtom).activeConversationId;
}
