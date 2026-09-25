import {
  type Conversation,
  ConversationSchema,
  type Message,
  createDefaultConversationConfig,
} from '@unleashd/shared';

/**
 * Schema-valid conversations shaped like a real store: many chats per folder,
 * oompa workers in worktrees, Buddy threads, provider child sessions and a
 * few background tasks. Shared by the render-isolation test and the
 * per-event benchmark (client/bench/conversation-event.bench.ts).
 */

const EPOCH = Date.parse('2026-09-01T00:00:00.000Z');
const FOLDERS = 30;

export function syntheticId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

export function syntheticMessage(role: Message['role'], content: string, timestamp: Date): Message {
  return { role, content, timestamp };
}

export function syntheticConversation(
  index: number,
  overrides: Partial<Conversation> = {}
): Conversation {
  const folder = `/Users/dev/git/project-${index % FOLDERS}`;
  const worker = index % 5 === 4;
  const buddy = index % 10 === 3;
  const child = index % 33 === 7 && index > 0;
  const activity = new Date(EPOCH + index * 60_000);
  return ConversationSchema.parse({
    id: syntheticId(index),
    messages: [
      syntheticMessage('user', `Question ${index}`, new Date(activity.getTime() - 30_000)),
      syntheticMessage('assistant', `Answer ${index}`, activity),
    ],
    messageCount: 2,
    isRunning: false,
    done: index % 17 === 0,
    createdAt: new Date(EPOCH + index * 1_000),
    workingDirectory: worker ? `${folder}/.ws${index % 3}-w1-i${index % 7}` : folder,
    config: createDefaultConversationConfig('claude'),
    configRevision: 0,
    configResolution: {
      status: 'resolved',
      catalogRevision: 'synthetic',
      value: { provider: 'claude', modelId: 'claude-default' },
    },
    isWorker: worker,
    swarmId: worker ? `swarm-${index % 3}` : null,
    parentConversationId: child ? syntheticId(index - 7) : null,
    kind: buddy
      ? { kind: 'buddy', buddyId: `buddy-${index % 4}`, workspaceId: 'workspace-1' }
      : { kind: 'general' },
    placement: buddy && index % 20 === 13 ? 'background' : undefined,
    ...overrides,
  });
}

export function syntheticConversations(count: number): Conversation[] {
  return Array.from({ length: count }, (_, index) => syntheticConversation(index));
}
