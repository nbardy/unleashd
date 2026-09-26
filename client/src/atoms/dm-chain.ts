import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { MessageGroup } from '../utils/chat-message-groups';
import { chatMessageGroupsAtomFamily, conversationAtomFamily } from './conversations';
import { type ResourceEntry, resourceAtomFamily } from './resources';

export const DIRECT_CHAINS_URL = '/api/buddies/direct/chains';

export interface DirectGeneration {
  generation: number;
  conversationId: string;
}

export interface DirectChain {
  buddyId: string;
  workspaceId: string;
  currentId: string;
  generations: DirectGeneration[];
}

export interface DirectChains {
  chains: DirectChain[];
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

function chainsOf(entry: ResourceEntry<unknown>): DirectChain[] | null {
  if (entry.kind !== 'ready' && entry.kind !== 'stale') return null;
  const value = entry.value as DirectChains;
  return Array.isArray(value?.chains) ? value.chains : null;
}

export const directChainsAtom = atom((get): readonly DirectChain[] | null =>
  chainsOf(get(resourceAtomFamily(DIRECT_CHAINS_URL)))
);

/** DM generations that are not the latest. Sidebar rows skip these. */
export const priorDirectConversationIdsAtom = atom((get): ReadonlySet<string> => {
  const chains = get(directChainsAtom);
  if (!chains) return EMPTY_IDS;
  const ids = new Set<string>();
  for (const chain of chains) {
    for (const generation of chain.generations) {
      if (generation.conversationId !== chain.currentId) ids.add(generation.conversationId);
    }
  }
  return ids.size === 0 ? EMPTY_IDS : ids;
});

export function chainForConversation(
  chains: readonly DirectChain[] | null,
  conversationId: string
): DirectChain | null {
  if (!chains) return null;
  return (
    chains.find((chain) =>
      chain.generations.some((generation) => generation.conversationId === conversationId)
    ) ?? null
  );
}

function shifted(group: MessageGroup, offset: number): MessageGroup {
  return { ...group, firstMessageIndex: offset + group.firstMessageIndex };
}

/** Earlier DM generations, then a divider, then the live generation. */
export function stitchDmTranscript(
  priorGroupLists: readonly (readonly MessageGroup[])[],
  current: readonly MessageGroup[],
  harness: string | null
): MessageGroup[] {
  if (priorGroupLists.length === 0) return current as MessageGroup[];
  const out: MessageGroup[] = [];
  let offset = 0;
  for (const groups of priorGroupLists) {
    for (const group of groups) {
      if (group.type === 'dm_divider') continue;
      out.push(shifted(group, offset));
    }
    const span = groups.reduce((max, group) => {
      if (group.type === 'dm_divider') return max;
      return Math.max(max, group.firstMessageIndex + group.messages.length);
    }, 0);
    offset += span;
  }
  out.push({ type: 'dm_divider', firstMessageIndex: offset, harness });
  offset += 1;
  for (const group of current) out.push(shifted(group, offset));
  return out;
}

export const dmTranscriptGroupsAtomFamily = atomFamily((conversationId: string) =>
  atom((get): readonly MessageGroup[] => {
    const current = get(chatMessageGroupsAtomFamily(conversationId));
    const chain = chainForConversation(get(directChainsAtom), conversationId);
    if (!chain || chain.currentId !== conversationId) return current;
    const priors = chain.generations.filter(
      (generation) => generation.conversationId !== chain.currentId
    );
    if (priors.length === 0) return current;
    return stitchDmTranscript(
      priors.map((generation) => get(chatMessageGroupsAtomFamily(generation.conversationId))),
      current,
      get(conversationAtomFamily(conversationId))?.provider ?? null
    );
  })
);
