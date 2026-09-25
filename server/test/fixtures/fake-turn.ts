import type { ExecuteCommandRequest, UnifiedAgentEvent, executeCommand } from '@nbardy/agent-cli';

/**
 * The part of an agent-cli turn handle the conversation runtime reads. Tests
 * script this instead of spawning a provider; the type keeps every fake turn
 * honest about the fields the runtime actually uses.
 */
export interface FakeTurn {
  child: {
    exitCode: number | null;
    once?(event: 'close', listener: () => void): unknown;
  };
  events: AsyncIterable<UnifiedAgentEvent>;
  completed: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    sessionId: string;
    reason: 'success' | 'out_of_tokens' | 'error' | 'killed';
  }>;
  stop(signal?: NodeJS.Signals): void;
}

/** A scripted provider boundary for `ConversationRuntimeDependencies.executeTurn`. */
export function fakeExecuteTurn(
  run: (request: ExecuteCommandRequest) => FakeTurn
): typeof executeCommand {
  // The child is a stand-in and `spec`/`sessionId` are never read by the runtime.
  return run as unknown as typeof executeCommand;
}
