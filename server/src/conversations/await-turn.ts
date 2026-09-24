import type { ConversationRuntime } from './runtime';

/**
 * A Buddy turn's final assistant text. The runtime's turn events carry no turn
 * identity, so the caller must only `send` when its turn is the next to finish:
 * on a new conversation, or on an idle one whose turns it serializes.
 */
export function awaitTurn(
  conversation: Pick<ConversationRuntime, 'once' | 'off'>,
  send: () => void,
  failure: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      conversation.off('buddy-turn-complete', onComplete);
      conversation.off('buddy-turn-failed', onFailure);
    };
    const onComplete = (output: string) => {
      cleanup();
      resolve(output);
    };
    const onFailure = (reason: string) => {
      cleanup();
      reject(new Error(reason || failure));
    };
    conversation.once('buddy-turn-complete', onComplete);
    conversation.once('buddy-turn-failed', onFailure);
    send();
  });
}
