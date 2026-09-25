import type { ConversationRow, RowKind } from '@unleashd/shared';
import {
  folderGroupKey,
  isWorktreeDirectory,
  normalizeFolderDirectory,
} from '../utils/directories';

// =============================================================================
// Conversation list index
// Pattern: one-store-one-index (docs/patterns.md#one-store-one-index)
//
// Every collection view (sidebar groups, gallery, inbox, buddy sidebar, running
// counts, swarm workers, child sessions) filters, groups and sorts on a handful
// of fields. They used to read `Conversation` objects straight out of the map,
// so each of ~10 views re-ran a full pass on EVERY conversation event — message,
// queue, sub-agent and every 5 s poller batch — at n ≈ 1,200 (03-app-core §6.2).
//
// The index keeps one `ConversationListEntry` per conversation holding only
// those fields, and one list of entries sorted newest-first. It is updated
// incrementally from the ids a write touched:
//   - an entry is rebuilt only for a touched conversation, and replaced only
//     when one of ITS list fields changed (otherwise the old entry is kept);
//   - the list is a new array only when some entry was replaced, and a
//     replaced entry is moved by binary search, not by re-sorting.
// So an event that changes no list field (messages, queue, sub-agents, session
// binding, streaming) leaves the list reference untouched and no view
// recomputes. Views that do recompute go through `stableAtom`, so their
// subscribers only re-render when the view's own output changed.
// =============================================================================

/** Facts about a working directory that views filter or group on. Computed
 *  once per distinct directory string and cached (regexes are not free at
 *  1,200 rows), so a view pays one map lookup per row. */
export interface DirectoryFacts {
  readonly raw: string;
  /** `normalizeFolderDirectory` — "which directory did the user mean". */
  readonly folder: string;
  /** `folderGroupKey` — the project a conversation groups under. */
  readonly groupKey: string;
  readonly isWorktree: boolean;
  /** Worktrees, oompa iteration dirs and temp dirs: never a user chat. */
  readonly isScratch: boolean;
}

export interface ConversationListEntry {
  readonly id: string;
  readonly activityMs: number;
  readonly createdAtMs: number;
  /** Raw working directory; `directoryFacts(workingDirectory)` for derived facts. */
  readonly workingDirectory: string;
  readonly kind: RowKind['t'];
  readonly buddyId: string | null;
  readonly buddyWorkspaceId: string | null;
  /** A background Buddy run (automation, delegation): not an owner chat. */
  readonly background: boolean;
  readonly isRunning: boolean;
  readonly done: boolean;
  readonly isWorker: boolean;
  readonly parentConversationId: string | null;
}

export interface ConversationIndex {
  readonly byId: ReadonlyMap<string, ConversationListEntry>;
  /** Newest-first by `activityMs`. Ties keep arrival order. */
  readonly list: readonly ConversationListEntry[];
}

export const EMPTY_CONVERSATION_INDEX: ConversationIndex = { byId: new Map(), list: [] };

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

// Bounded by the number of distinct working directories, which is small
// compared with the conversation count (many chats per folder).
const directoryFactsCache = new Map<string, DirectoryFacts>();

export function directoryFacts(raw: string): DirectoryFacts {
  const cached = directoryFactsCache.get(raw);
  if (cached) return cached;
  const folder = normalizeFolderDirectory(raw);
  const facts: DirectoryFacts = {
    raw,
    folder,
    groupKey: folderGroupKey(raw),
    isWorktree: isWorktreeDirectory(folder),
    isScratch: isNestedWorktreeDirectory(raw) || isTemporaryDirectory(raw),
  };
  directoryFactsCache.set(raw, facts);
  return facts;
}

function buildEntry(row: ConversationRow): ConversationListEntry {
  const buddy = row.kind.t === 'buddy' ? row.kind : null;
  return {
    id: row.id,
    activityMs: row.activityAt,
    createdAtMs: row.createdAt,
    workingDirectory: row.cwd,
    kind: row.kind.t,
    buddyId: buddy?.buddyId ?? null,
    buddyWorkspaceId: buddy?.workspaceId ?? null,
    background: buddy?.visibility === 'background',
    isRunning: row.run === 'running' || row.run === 'streaming',
    done: row.done,
    isWorker: row.kind.t === 'worker',
    parentConversationId: row.parent,
  };
}

function sameEntry(a: ConversationListEntry, b: ConversationListEntry): boolean {
  return (
    a.activityMs === b.activityMs &&
    a.createdAtMs === b.createdAtMs &&
    a.workingDirectory === b.workingDirectory &&
    a.kind === b.kind &&
    a.buddyId === b.buddyId &&
    a.buddyWorkspaceId === b.buddyWorkspaceId &&
    a.background === b.background &&
    a.isRunning === b.isRunning &&
    a.done === b.done &&
    a.isWorker === b.isWorker &&
    a.parentConversationId === b.parentConversationId
  );
}

/** First index whose entry is strictly older than `activityMs`. */
function insertionIndex(list: readonly ConversationListEntry[], activityMs: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid].activityMs >= activityMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Position of `entry` (by identity) in the sorted list. */
function indexOfEntry(
  list: readonly ConversationListEntry[],
  entry: ConversationListEntry
): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid].activityMs > entry.activityMs) low = mid + 1;
    else high = mid;
  }
  for (let i = low; i < list.length && list[i].activityMs === entry.activityMs; i++) {
    if (list[i] === entry) return i;
  }
  throw new Error(`conversation index out of sync for ${entry.id}`);
}

// Past this many replaced entries, one sort beats that many splices (init,
// reconnect and load-complete replace everything at once).
const REBUILD_THRESHOLD = 64;

function sortedList(byId: ReadonlyMap<string, ConversationListEntry>): ConversationListEntry[] {
  return Array.from(byId.values()).sort((a, b) => b.activityMs - a.activityMs);
}

/**
 * Apply the conversations a write touched. `changed` lists every id whose
 * record in `conversations` may differ from the one the index last saw
 * (including removed ids). Untouched ids are never visited.
 */
export function updateConversationIndex(
  index: ConversationIndex,
  conversations: ReadonlyMap<string, ConversationRow>,
  changed: Iterable<string>
): ConversationIndex {
  const replaced: Array<{
    previous: ConversationListEntry | undefined;
    next: ConversationListEntry | undefined;
  }> = [];
  for (const id of new Set(changed)) {
    const previous = index.byId.get(id);
    const conversation = conversations.get(id);
    const built = conversation ? buildEntry(conversation) : undefined;
    const next = previous && built && sameEntry(previous, built) ? previous : built;
    if (next !== previous) replaced.push({ previous, next });
  }
  if (replaced.length === 0) return index;

  const byId = new Map(index.byId);
  for (const { previous, next } of replaced) {
    if (next) byId.set(next.id, next);
    else if (previous) byId.delete(previous.id);
  }
  if (replaced.length > REBUILD_THRESHOLD) return { byId, list: sortedList(byId) };

  const list = index.list.slice();
  for (const { previous, next } of replaced) {
    if (previous) list.splice(indexOfEntry(list, previous), 1);
    if (next) list.splice(insertionIndex(list, next.activityMs), 0, next);
  }
  return { byId, list };
}
