import type { DiscoveredSession } from '../../src/adapters/disk-adapter';

/** A transcript as discovery hands it to hydration; override what a test is about. */
export function discoveredSession(
  overrides: Partial<DiscoveredSession> & Pick<DiscoveredSession, 'sessionId'>
): DiscoveredSession {
  return {
    messages: [],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    workingDirectory: '/tmp',
    provider: 'codex',
    model: undefined,
    reasoningEffort: undefined,
    observedModel: null,
    subAgents: [],
    parentConversationId: null,
    resumedFromConversationId: null,
    title: undefined,
    swarmDebugPrefix: null,
    discoveredKind: { t: 'chat' },
    ...overrides,
  };
}
