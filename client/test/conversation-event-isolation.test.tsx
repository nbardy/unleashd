import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { type ServerMessage, encodeRows } from '@unleashd/shared';
import { type Atom, Provider } from 'jotai';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { handleMessage } from '../src/atoms/actions';
import { buddySidebarProjectsAtom, sidebarFolderViewAtom } from '../src/atoms/buddy-sidebar';
import {
  allConversationIdsAtom,
  availableConversationIdSetAtom,
  chatConversationInboxAtom,
  conversationListAtom,
  detailPatchAtom,
  galleryConversationsAtom,
  recentDirectoriesAtom,
  transcriptPatchAtom,
} from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import {
  syntheticConversation,
  syntheticConversations,
  syntheticDetail,
  syntheticId,
  syntheticMessages,
} from './fixtures/synthetic-conversations';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { Chat } = await import('../src/components/Chat');

/**
 * Regression guard for 03-app-core §6.2: every conversation event — a status
 * flip, a queue change, one 5 s poller batch — re-ran ~10 full-list passes
 * and re-rendered Chat for whatever conversation was open, because per-id
 * atoms read the whole map and list views rebuilt fresh arrays and Sets.
 *
 * This drives real events for conversation A through the WS spine and checks
 * that conversation B pays nothing:
 *   - every atom Chat(B) reads keeps the same value (so React does not
 *     re-render it), found by recording the store reads of a real render
 *     rather than listing them here;
 *   - every atom scoped to B (debug label `…:<B>`) is not even recomputed;
 *   - events that change no list field (stream, queue, sub-agent) recompute
 *     no collection view at all.
 */

const A = syntheticId(1_000_001);
const B = syntheticId(1_000_002);

type Recorded = Map<Atom<unknown>, unknown>;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

// requestAnimationFrame drives the chunk flush; node has none.
const frames: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = (callback) => {
  frames.push(callback);
  return frames.length;
};
function flushFrames(): void {
  for (const frame of frames.splice(0)) frame(0);
}

function seed(): void {
  const rows = [
    ...syntheticConversations(300),
    syntheticConversation(1_000_001, { id: A, cwd: '/Users/dev/git/alpha' }),
    syntheticConversation(1_000_002, { id: B, cwd: '/Users/dev/git/beta' }),
  ];
  handleMessage({
    type: 'hello',
    protocol: { version: 3 },
    defaultCwd: '/',
    loading: false,
    archivedBuddyIds: [],
    ...encodeRows(rows),
  } as unknown as ServerMessage);
  // Both chats are open: detail and bodies loaded (as useConversationBodies would).
  jotaiStore.set(detailPatchAtom, {
    set: [
      [A, syntheticDetail(A)],
      [B, syntheticDetail(B)],
    ],
    remove: [],
  });
  jotaiStore.set(transcriptPatchAtom, {
    set: [
      [A, { epoch: 0, messages: syntheticMessages(1_000_001) }],
      [B, { epoch: 0, messages: syntheticMessages(1_000_002) }],
    ],
    remove: [],
  });
}

/** Render Chat for `id` and return every atom it read, with the value read. */
function renderChatRecordingReads(id: string): Recorded {
  const reads: Recorded = new Map();
  const recording = new Proxy(jotaiStore, {
    get(target, property, receiver) {
      if (property === 'get') {
        return (atom: Atom<unknown>) => {
          const value = target.get(atom);
          reads.set(atom, value);
          return value;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  renderToStaticMarkup(
    <Provider store={recording}>
      <MemoryRouter>
        <Chat id={id} />
      </MemoryRouter>
    </Provider>
  );
  return reads;
}

/** Count recomputations of `atom` from now on (wraps its read function). */
function countRecomputes(atom: Atom<unknown>): () => number {
  let count = 0;
  const target = atom as { read: Atom<unknown>['read'] };
  const read = target.read;
  target.read = function countedRead(this: unknown, ...args: Parameters<typeof read>) {
    count += 1;
    return read.apply(this, args);
  };
  return () => count;
}

function labelOf(atom: Atom<unknown>): string {
  return atom.debugLabel ?? atom.toString();
}

const COLLECTION_VIEWS = {
  conversationListAtom,
  allConversationIdsAtom,
  availableConversationIdSetAtom,
  recentDirectoriesAtom,
  chatConversationInboxAtom,
  galleryConversationsAtom,
  sidebarFolderViewAtom,
  buddySidebarProjectsAtom,
} satisfies Record<string, Atom<unknown>>;

function mountCollectionViews(): Record<string, () => number> {
  const counters: Record<string, () => number> = {};
  for (const [name, atom] of Object.entries(COLLECTION_VIEWS)) {
    jotaiStore.sub(atom, () => {});
    counters[name] = countRecomputes(atom);
  }
  return counters;
}

function eventsForA(kind: 'content' | 'list'): Array<() => void> {
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  if (kind === 'content') {
    return [
      () =>
        handleMessage({
          type: 'patch',
          id: A,
          patch: {
            t: 'queue',
            queue: [{ id: 'q1', content: 'next', status: 'pending', queuedAt: new Date(now) }],
          },
        }),
      () =>
        handleMessage({
          type: 'patch',
          id: A,
          patch: {
            t: 'subagent',
            subAgent: {
              id: 'agent-1',
              description: 'look around',
              status: 'running',
              toolUses: 0,
              tokens: 0,
              startedAt: new Date(now),
            },
          },
        }),
      () => {
        // A's last record is an assistant reply, so chunks stream into it.
        handleMessage({ type: 'chunk', conversationId: A, text: 'streaming…' });
        flushFrames();
        handleMessage({ type: 'chunk', conversationId: A, text: ' more' });
        flushFrames();
      },
    ];
  }
  return [
    // A new record moves A's last activity, so it re-sorts the list.
    () => {
      handleMessage({ type: 'message', conversationId: A, role: 'user', content: 'hi' });
      handleMessage({
        type: 'patch',
        id: A,
        patch: { t: 'activity', activityAt: now, messageCount: 3 },
      });
    },
    () => handleMessage({ type: 'patch', id: A, patch: { t: 'run', run: 'streaming' } }),
    () =>
      handleMessage({
        type: 'rows',
        ...encodeRows([
          syntheticConversation(1_000_001, {
            id: A,
            cwd: '/Users/dev/git/alpha',
            activityAt: now + 1,
            messageCount: 9,
          }),
        ]),
      } as unknown as ServerMessage),
    () => handleMessage({ type: 'patch', id: A, patch: { t: 'run', run: 'idle' } }),
  ];
}

function assertBUntouched(kind: 'content' | 'list'): Record<string, number> {
  seed();
  const collections = mountCollectionViews();
  const chatReads = renderChatRecordingReads(B);
  const scopedToB = [...chatReads.keys()].filter((atom) => labelOf(atom).endsWith(`:${B}`));
  assert.ok(scopedToB.length >= 4, `Chat(B) reads its per-id atoms: ${scopedToB.map(labelOf)}`);
  for (const atom of chatReads.keys()) jotaiStore.sub(atom, () => {});
  const recomputes = new Map(scopedToB.map((atom) => [atom, countRecomputes(atom)]));

  for (const event of eventsForA(kind)) event();

  for (const [atom, before] of chatReads) {
    assert.equal(
      jotaiStore.get(atom),
      before,
      `an event for A changed ${labelOf(atom)}, which re-renders Chat for B`
    );
  }
  for (const [atom, count] of recomputes) {
    assert.equal(count(), 0, `an event for A recomputed ${labelOf(atom)}`);
  }
  return Object.fromEntries(Object.entries(collections).map(([name, count]) => [name, count()]));
}

test('stream, queue and sub-agent events for A leave B and every list view alone', () => {
  const collectionRecomputes = assertBUntouched('content');
  for (const [name, count] of Object.entries(collectionRecomputes)) {
    assert.equal(count, 0, `${name} recomputed for an event that changes no list field`);
  }
});

test('message, status and poller events for A re-sort the list but leave Chat and rows for B alone', () => {
  const collectionRecomputes = assertBUntouched('list');
  // The control: these events do move A in the list, so the views ran.
  assert.ok(collectionRecomputes.conversationListAtom > 0);
});

test('the same events for B do reach Chat(B) (the guard is not vacuous)', () => {
  seed();
  const chatReads = renderChatRecordingReads(B);
  for (const atom of chatReads.keys()) jotaiStore.sub(atom, () => {});
  handleMessage({ type: 'message', conversationId: B, role: 'user', content: 'for B' });
  const changed = [...chatReads].filter(([atom, before]) => jotaiStore.get(atom) !== before);
  assert.ok(
    changed.some(([atom]) => labelOf(atom) === `chatMessageGroups:${B}`),
    `expected B's message groups to change, changed: ${changed.map(([atom]) => labelOf(atom))}`
  );
});
