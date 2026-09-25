import { useState } from 'react';
import { errorText } from './api';

/** One owner write in flight at a time per panel: D = Idle ⊕ Busy(key) ⊕ Failed(message). */
export type BuddyActionState =
  | { kind: 'idle' }
  | { kind: 'busy'; key: string }
  | { kind: 'failed'; message: string };

/**
 * Run an owner write, then `refresh` the panel's read. The server's
 * `buddies_changed` push refreshes every mounted Buddy key too; awaiting the
 * panel's own read here is what makes the result visible before the button
 * re-enables. Resolves true when the write succeeded.
 */
export function useBuddyAction(refresh: () => Promise<void>) {
  const [state, setState] = useState<BuddyActionState>({ kind: 'idle' });
  const run = async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
    setState({ kind: 'busy', key });
    try {
      await action();
      await refresh();
      setState({ kind: 'idle' });
      return true;
    } catch (cause) {
      setState({ kind: 'failed', message: errorText(cause) });
      return false;
    }
  };
  return { state, run, busy: state.kind === 'busy' };
}

export function ActionError({ state }: { state: BuddyActionState }) {
  return state.kind === 'failed' ? (
    <p className="buddy-panel__error" role="alert">
      {state.message}
    </p>
  ) : null;
}
