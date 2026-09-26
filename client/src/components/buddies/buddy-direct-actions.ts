/**
 * client/src/components/buddies/buddy-direct-actions.ts
 *
 * DM and Wake for one Buddy, shared by the desktop channel rail, the desktop
 * sidebar and the mobile channels home. No JSX, no CSS (mobile-safe).
 * Server: server/src/buddies/buddy-direct.ts.
 *   DM   — POST /api/buddies/:id/direct → the one ongoing owner chat (history kept)
 *   Wake — POST /api/buddies/:id/wake   → catch-up instruction queued in that chat
 */
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import {
  type DirectChain,
  DIRECT_CHAINS_URL,
  chainForConversation,
  directChainsAtom,
} from '../../atoms/dm-chain';
import { loadConversationDetails, setConversationDone } from '../../atoms/actions';
import { buddyBuilderConversationsAtom } from '../../atoms/buddy-sidebar';
import { conversationAtomFamily } from '../../atoms/conversations';
import { invalidateResources } from '../../atoms/resources';
import { buddyApi } from './api';
import { createBuddyViaBuilder } from './create-buddy-builder';
import type { OpenDm } from './ChannelAuthor';

export type DirectAction =
  | { kind: 'idle' }
  | { kind: 'pending'; action: 'dm' | 'wake' }
  | { kind: 'failed'; message: string };

// Each wake gets a fresh attempt number so its status view remounts clean.
export type WakeAttempt = { conversationId: string; attempt: number };

/** Start Buddy Builder and open it in the channels DM pane (same spine as sidebar +). */
export function useChannelNewBuddy(openDm: OpenDm) {
  const builders = useAtomValue(buddyBuilderConversationsAtom);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    if (pending) return;
    for (const entry of builders) {
      if (!entry.done) setConversationDone(entry.id, true);
    }
    setPending(true);
    setError(null);
    void createBuddyViaBuilder()
      .then((conversationId) => openDm(conversationId))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setPending(false));
  };
  return { pending, error, start };
}

export function useBuddyDirectActions(buddyId: string, workspaceId: string) {
  const [action, setAction] = useState<DirectAction>({ kind: 'idle' });
  const [woken, setWoken] = useState<WakeAttempt | null>(null);
  const request = (path: 'direct' | 'wake') =>
    buddyApi<{ conversationId: string }>(`/api/buddies/${encodeURIComponent(buddyId)}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
  const fail = (cause: unknown) =>
    setAction({ kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
  return {
    action,
    woken,
    /** Resolve the DM, then hand its id to the caller's navigation. */
    openDm(open: (conversationId: string) => void) {
      setAction({ kind: 'pending', action: 'dm' });
      request('direct')
        .then(({ conversationId }) => {
          setAction({ kind: 'idle' });
          open(conversationId);
        })
        .catch(fail);
    },
    wake() {
      setAction({ kind: 'pending', action: 'wake' });
      request('wake')
        .then(({ conversationId }) => {
          setWoken((current) => ({ conversationId, attempt: (current?.attempt ?? 0) + 1 }));
          setAction({ kind: 'idle' });
        })
        .catch(fail);
    },
  };
}

// Wake progress, read from the DM's own run state. The queued message may
// reach the client a beat after the HTTP reply, so 'waiting' holds until the
// DM is first seen busy; only a busy → idle edge means the check finished.
export type WakePhase =
  | { kind: 'waiting' }
  | { kind: 'running' }
  | { kind: 'done'; available: boolean };

export type DmSplit =
  | { role: 'none' }
  | { role: 'current'; chain: DirectChain; priorIds: string[] }
  | { role: 'prior'; currentId: string };

export function useDmSplit(conversationId: string): DmSplit & {
  pending: boolean;
  error: string | null;
  startNewChat: () => Promise<string | null>;
} {
  const chains = useAtomValue(directChainsAtom);
  const chain = chainForConversation(chains, conversationId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const split: DmSplit = !chain
    ? { role: 'none' }
    : chain.currentId === conversationId
      ? {
          role: 'current',
          chain,
          priorIds: chain.generations
            .map((generation) => generation.conversationId)
            .filter((id) => id !== chain.currentId),
        }
      : { role: 'prior', currentId: chain.currentId };
  const priorKey = split.role === 'current' ? split.priorIds.join(',') : '';
  useEffect(() => {
    if (!priorKey) return;
    for (const id of priorKey.split(',')) {
      void loadConversationDetails(id).catch(() => undefined);
    }
  }, [priorKey]);
  const startNewChat = (): Promise<string | null> => {
    if (split.role !== 'current' || pending) return Promise.resolve(null);
    const { buddyId, workspaceId } = split.chain;
    setPending(true);
    setError(null);
    return buddyApi<{ conversationId: string }>(
      `/api/buddies/${encodeURIComponent(buddyId)}/direct/new-chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      }
    )
      .then(({ conversationId }) => {
        invalidateResources((key) => key === DIRECT_CHAINS_URL);
        setPending(false);
        return conversationId;
      })
      .catch((cause: unknown) => {
        setPending(false);
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      });
  };
  return { ...split, pending, error, startNewChat };
}

export function useWakePhase(conversationId: string): WakePhase {
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const busy = conversation !== null && (conversation.isRunning || conversation.queue.length > 0);
  const [seen, setSeen] = useState<'waiting' | 'running' | 'done'>('waiting');
  useEffect(() => {
    if (busy) setSeen('running');
    else setSeen((current) => (current === 'running' ? 'done' : current));
  }, [busy]);
  switch (seen) {
    case 'waiting':
      return { kind: 'waiting' };
    case 'running':
      return { kind: 'running' };
    case 'done':
      // Availability-checked: the atom is null once the client no longer holds it.
      return { kind: 'done', available: conversation !== null };
  }
}
