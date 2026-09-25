/**
 * Cost of ONE incoming conversation event with 1,200 conversations held and a
 * desktop session mounted (sidebar with its visible rows + an open Chat).
 *
 *   pnpm exec tsx --tsconfig client/tsconfig.app.json client/bench/conversation-event.bench.ts
 *
 * "Mounted" means every atom those components read is subscribed, so jotai
 * recomputes exactly what the live UI would. Each timing covers handleMessage
 * through the last synchronous recompute. `changed` counts subscribed atoms
 * whose value changed — each is a component that would re-render.
 *
 * The before-numbers in T05-client-perf.md came from the same script run
 * against the lean/integration tree, with its subscriptions (allConversationsAtom
 * + the Sidebar useMemo chain that re-ran whenever that array changed).
 */
import type { Atom } from 'jotai';
import { handleMessage } from '../src/atoms/actions';
import { buddySidebarAtom } from '../src/atoms/buddy-sidebar';
import {
  childRowsFamily,
  commandFor,
  commandsAtom,
  connectionAtom,
  groupsFamily,
  listField,
  rowFamily,
  streamFamily,
  transcriptFamily,
  transcriptStore,
  unreadFamily,
} from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { prefsAtom } from '../src/atoms/ui';
import { parseServerFrame } from '../src/hooks/useWebSocket';
import { runEventBench } from './event-bench-harness';

runEventBench({
  store: jotaiStore,
  handleMessage,
  // The client's real boundary: chunks get the light tag check (T19).
  parseFrame: (raw) => {
    const frame = parseServerFrame(raw);
    return frame.t === 'message' ? frame.message : null;
  },
  open: (id, detail, messages) => {
    jotaiStore.set(transcriptStore.patch, {
      set: [[id, { tag: 'loaded', epoch: 0, messages, detail }]],
      remove: [],
    });
  },
  groups: (openId) => groupsFamily(openId),
  mount: (ids, openId): Atom<unknown>[] => [
    // Sidebar
    listField('folders'),
    listField('recentDirs'),
    listField('latestCwd'),
    listField('runningByFolder'),
    listField('builders'),
    buddySidebarAtom,
    commandsAtom,
    connectionAtom,
    prefsAtom,
    // Sidebar rows (60 visible)
    ...ids.slice(0, 60).flatMap((id) => [rowFamily(id), unreadFamily(id)]),
    // Chat
    rowFamily(openId),
    transcriptFamily(openId),
    groupsFamily(openId),
    childRowsFamily(openId),
    listField('idSet'),
    commandFor(openId),
    streamFamily(openId),
  ],
});
