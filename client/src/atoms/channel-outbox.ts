import type { Post } from '@unleashd/buddies-core';
import { atom } from 'jotai';
import { jotaiStore } from './store';

// Owner posts shown before the server has them: `Sending` while the POST is in flight, `Sent` until
// a refetch includes it; a failed POST gives the composer its text back. See docs/client-
// rationale.md#channel-outbox.

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
