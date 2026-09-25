import type { Channel, ChannelUnread, Inbox, Post } from '../../src/components/buddies/types';

/** A crate `Post` with every required field; override what the test is about. */
export function postFixture(overrides: Partial<Post> & Pick<Post, 'id'>): Post {
  return {
    channelId: 'ch_a',
    author: { kind: 'owner' },
    body: `Body of ${overrides.id}.`,
    evidence: [],
    request: { state: 'none' },
    createdAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

export function publicChannel(id: string, name: string, workspaceId = 'ws-1'): Channel {
  return {
    id,
    workspaceId,
    kind: { type: 'public', name, purpose: `${name} purpose` },
    createdBy: { kind: 'owner' },
    createdAt: '2026-09-20T00:00:00.000Z',
  };
}

export function inboxFixture(channels: ChannelUnread[], requests: Post[] = []): Inbox {
  return { requests, waitingOn: [], channels };
}
