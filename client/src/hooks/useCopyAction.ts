import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * The three things a copy attempt can be. `failed` is a real state, not an
 * absence: `copyText` returns false over a non-secure context where even the
 * execCommand fallback is refused (see utils/clipboard.ts), and a button that
 * silently stays on "Copy" reads as an unresponsive button.
 */
export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * One copy-to-clipboard interaction: attempt, transient result, auto-reset.
 *
 * Shared by the desktop code-block button, the desktop message hover action,
 * and the mobile message action — mobile cannot import `components/*` (gate
 * G3), so the shared piece has to live in `hooks/`.
 */
export function useCopyAction(text: string, resetMs = 2000): {
  state: CopyState;
  copy: () => void;
} {
  const [state, setState] = useState<CopyState>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    // copyText never throws and never leaves the promise pending; it reports
    // whether the text actually landed.
    void copyText(text).then((ok) => {
      setState(ok ? 'copied' : 'failed');
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setState('idle'), resetMs);
    });
  }, [text, resetMs]);

  return { state, copy };
}

/** Button text / accessible name per state. Exhaustive by construction. */
export const COPY_LABEL: Record<CopyState, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Copy failed',
};
