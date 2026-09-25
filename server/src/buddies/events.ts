import type { Channel, Post } from '@unleashd/buddies-core';

/**
 * The in-process change bus. Every Buddy write (MCP tool, owner route, runner, responder) now
 * runs in this process, so a listener here sees all of them. B2: the old buses fired inside the
 * per-turn MCP helper process, where nothing listened, so a Buddy's MCP post never pushed
 * `channel_changed` or woke the follow-up gate. Guard: `buddies-v2.test.ts` "an MCP write fires
 * the change bus".
 */
export type BuddyEvent = { kind: 'changed' } | { kind: 'posted'; post: Post; channel: Channel };

export type BuddyEvents = ReturnType<typeof createBuddyEvents>;

export function createBuddyEvents() {
  const listeners = new Set<(event: BuddyEvent) => void>();
  return {
    emit(event: BuddyEvent): void {
      for (const listener of [...listeners]) listener(event);
    },
    on(listener: (event: BuddyEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
