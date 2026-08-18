import { useEffect, useState } from 'react';

/**
 * Tracks how much of the layout viewport the on-screen keyboard covers, and
 * publishes it as `--mobile-keyboard-inset` on the document element.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens — it
 * only shrinks the VISUAL viewport and scrolls the page. A composer pinned to
 * the bottom of a `100dvh` shell therefore ends up underneath the keyboard.
 * `window.visualViewport` is the only reliable source for the covered height.
 *
 * Returns whether the keyboard is currently up so the shell can hide the tab
 * bar and give the composer the space instead.
 */

// Below this, the delta is browser chrome (URL bar collapse), not a keyboard.
const KEYBOARD_THRESHOLD_PX = 120;

export function useKeyboardInset(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!viewport) return;

    const update = () => {
      // offsetTop matters: iOS scrolls the visual viewport up rather than
      // resizing, so the covered strip is what is left below it.
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty('--mobile-keyboard-inset', `${Math.round(covered)}px`);
      setKeyboardOpen(covered > KEYBOARD_THRESHOLD_PX);
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--mobile-keyboard-inset');
    };
  }, []);

  return keyboardOpen;
}
