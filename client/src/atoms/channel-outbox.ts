import type { Post } from '@unleashd/buddies-core';
import { atom } from 'jotai';
import { jotaiStore } from './store';

// =============================================================================
// Channel outbox — owner posts shown before the server has them.
//
// Sending used to wait for the POST and then a feed refetch before the message
// appeared. Under load (2026-09-25: load average 232, owner-reported "slow
// delay") each of those took seconds, so Send felt broken. Now the composer
// files the post here the moment Send is pressed and the feed renders it
// straight away; the server copy replaces it when a refetch returns it.
//
//   Sending — the POST is in flight; rendered from the draft.
//   Sent    — the POST returned this post; rendered until a refetch includes
//             it. Dropping it on the POST response instead would blink the
//             message out until the refetch landed.
// A failed POST removes the entry and the composer gets its text back.
// =============================================================================

export type OutboxEntry =
  | {
      kind: 'sending';
      key: string;
      channelId: string;
      rootId: string | null;
      body: string;
      createdAt: string;
    }
  | { kind: 'sent'; key: string; post: Post };

export const channelOutboxAtom = atom<readonly OutboxEntry[]>([]);

export function outboxSending(entry: Extract<OutboxEntry, { kind: 'sending' }>): void {
  jotaiStore.set(channelOutboxAtom, [...jotaiStore.get(channelOutboxAtom), entry]);
}

export function outboxSent(key: string, post: Post): void {
  jotaiStore.set(
    channelOutboxAtom,
    jotaiStore
      .get(channelOutboxAtom)
      .map((entry) => (entry.key === key ? { kind: 'sent', key, post } : entry))
  );
}

export function outboxDrop(keys: ReadonlySet<string>): void {
  jotaiStore.set(
    channelOutboxAtom,
    jotaiStore.get(channelOutboxAtom).filter((entry) => !keys.has(entry.key))
  );
}
