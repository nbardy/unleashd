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
import { classifyServerFrame } from '@unleashd/shared';
import type { Atom } from 'jotai';
import { handleMessage } from '../src/atoms/actions';
import {
  buddyBuilderConversationsAtom,
  buddySidebarChannelsAtom,
  buddySidebarCountAtom,
  buddySidebarGroupsAtom,
  sidebarFolderViewAtom,
  sidebarRunningCountByFolderAtom,
} from '../src/atoms/buddy-sidebar';
import {
  allPendingCreationsAtom,
  availableConversationIdSetAtom,
  chatMessageGroupsAtomFamily,
  childConversationsAtomFamily,
  conversationAtomFamily,
  conversationDetailsLoadedAtomFamily,
  detailPatchAtom,
  hasConversationsAtom,
  latestWorkingDirectoryAtom,
  queueAtomFamily,
  recentDirectoriesAtom,
  streamingAtomFamily,
  transcriptPatchAtom,
} from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { lastSeenMessageIndexAtomFamily } from '../src/atoms/ui';
import { runEventBench } from './event-bench-harness';

runEventBench({
  store: jotaiStore,
  handleMessage,
  parseFrame: (raw) => {
    const frame = classifyServerFrame(raw);
    return frame.t === 'message' ? frame.message : null;
  },
  open: (id, detail, messages) => {
    jotaiStore.set(detailPatchAtom, { set: [[id, detail]], remove: [] });
    jotaiStore.set(transcriptPatchAtom, { set: [[id, { epoch: 0, messages }]], remove: [] });
  },
  groups: (openId) => chatMessageGroupsAtomFamily(openId),
  mount: (ids, openId): Atom<unknown>[] => [
    // Sidebar
    sidebarFolderViewAtom,
    recentDirectoriesAtom,
    latestWorkingDirectoryAtom,
    sidebarRunningCountByFolderAtom,
    buddyBuilderConversationsAtom,
    buddySidebarGroupsAtom,
    buddySidebarCountAtom,
    buddySidebarChannelsAtom,
    allPendingCreationsAtom,
    availableConversationIdSetAtom,
    // Sidebar rows (60 visible)
    ...ids
      .slice(0, 60)
      .flatMap((id) => [conversationAtomFamily(id), lastSeenMessageIndexAtomFamily(id)]),
    // Chat
    conversationAtomFamily(openId),
    chatMessageGroupsAtomFamily(openId),
    childConversationsAtomFamily(openId),
    hasConversationsAtom,
    queueAtomFamily(openId),
    streamingAtomFamily(openId),
    conversationDetailsLoadedAtomFamily(openId),
  ],
});
