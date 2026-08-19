import { useCallback, useEffect, useRef } from 'react';
import { DRAFT_KEY_PREFIX } from '../atoms/ui';

const DRAFT_SAVE_DELAY_MS = 500;

/**
 * Portable draft persistence + focus — merging desktop Chat.tsx and mobile
 * ComposerMobile.tsx into one clean path.
 *
 * Both trees previously drove `localStorage` key `draft:{conversationId}`
 * independently:
 *  - Desktop (Chat.tsx): uncontrolled textarea via ref callback, `draftValueRef`,
 *    `saveDraft` reading refs, `textarea.focus()` in attach callback.
 *  - Mobile (ComposerMobile): controlled `draft` state + `draftRef`/`draftKeyRef`
 *    + debounced `writeDraft`, flush on `useEffect` cleanup.
 *
 * Mobile documented the subtle stale-closure bug: an effect keyed on
 * `[conversationId, draft]` closes over the *previous* draft (`''`) and its
 * cleanup deletes the key the load just read — silently eating forked drafts.
 * Fix: `writeDraft` reads refs, never state.
 *
 * This hook is the canonical implementation:
 *  - Storage reads/writes go through refs (never state closure).
 *  - Debounced write (500ms) + flush on `pagehide`, `visibilitychange`, and
 *    effect cleanup (conversation switch / HMR unmount).
 *  - Applies draft to textarea and auto-heights, then restores focus without
 *    stealing focus from another input. HMR-safe: uses `useLayoutEffect`-ish
 *    timing via `requestAnimationFrame` so Vite Fast Refresh patching Chat.tsx
 *    without a DOM unmount still re-focuses.
 *
 * Portable: both Chat.tsx (desktop, maxHeight 300) and ComposerMobile
 * (mobile, maxHeight 120) consume this. `controlled` mode drives React state;
 * `uncontrolled` mode writes directly to `textarea.value` (desktop).
 */
export interface UseConversationDraftOptions {
  conversationId: string | null | undefined;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Max auto-height in px (300 desktop, 120 mobile). */
  maxHeight?: number;
  /** When false, skip the mount-time focus (mobile keeps inbox unfocused). */
  autoFocus?: boolean;
  /** Called when draft is loaded or external storage changes. */
  onDraftLoaded?: (draft: string) => void;
  /** Controlled mode: notify owner of draft changes (so owner can setState). */
  onDraftChange?: (draft: string) => void;
  /** When true, hook does not write textarea.value directly — React state owns it. */
  controlled?: boolean;
}

export interface UseConversationDraftReturn {
  flush: () => void;
  clear: () => void;
  setDraft: (value: string) => void;
  getDraft: () => string;
}

export function useConversationDraft(
  options: UseConversationDraftOptions
): UseConversationDraftReturn {
  const { conversationId, textareaRef, maxHeight = 300, autoFocus = true, onDraftLoaded, onDraftChange, controlled = false } = options;

  const draftRef = useRef('');
  const keyRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDraftLoadedRef = useRef(onDraftLoaded);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftLoadedRef.current = onDraftLoaded;
  onDraftChangeRef.current = onDraftChange;

  const writeDraft = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    try {
      if (draftRef.current) localStorage.setItem(key, draftRef.current);
      else localStorage.removeItem(key);
    } catch {
      // quota / private-mode — never take down caller
    }
  }, []);

  const applyToTextarea = useCallback(
    (value: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (!controlled) {
        if (ta.value !== value) ta.value = value;
      }
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    },
    [textareaRef, maxHeight, controlled]
  );

  const focusIfNeeded = useCallback(() => {
    if (!autoFocus) return;
    const ta = textareaRef.current;
    if (!ta) return;
    // Don't steal focus from another input/textarea
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      if (active !== ta) return;
    }
    // requestAnimationFrame so HMR-patched DOM is committed before focus
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const stillActive = document.activeElement;
      if (stillActive instanceof HTMLInputElement || stillActive instanceof HTMLTextAreaElement) {
        if (stillActive !== el) return;
      }
      el.focus();
      try {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      } catch {
        // setSelectionRange can throw on hidden elements
      }
    });
  }, [autoFocus, textareaRef]);

  const setDraft = useCallback(
    (value: string) => {
      draftRef.current = value;
      onDraftChangeRef.current?.(value);
      applyToTextarea(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(writeDraft, DRAFT_SAVE_DELAY_MS);
    },
    [applyToTextarea, writeDraft]
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    writeDraft();
  }, [writeDraft]);

  const clear = useCallback(() => {
    draftRef.current = '';
    onDraftChangeRef.current?.('');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const key = keyRef.current;
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    const ta = textareaRef.current;
    if (ta) {
      ta.value = '';
      ta.style.height = 'auto';
    }
  }, [textareaRef]);

  const getDraft = useCallback(() => draftRef.current, []);

  // Load on conversationId change. Flush previous draft on cleanup so
  // back-navigation and HMR unmount keep the draft.
  useEffect(() => {
    if (!conversationId) {
      keyRef.current = '';
      draftRef.current = '';
      return;
    }
    const key = `${DRAFT_KEY_PREFIX}${conversationId}`;
    let saved = '';
    try {
      saved = localStorage.getItem(key) ?? '';
    } catch {
      saved = '';
    }
    keyRef.current = key;
    draftRef.current = saved;
    onDraftLoadedRef.current?.(saved);
    // Apply to textarea on next frame — element may not be mounted yet when
    // this effect runs (e.g. Chat mounts textarea after this). We also try
    // immediately and again rAF for HMR case where element persists.
    applyToTextarea(saved);
    requestAnimationFrame(() => {
      applyToTextarea(saved);
      focusIfNeeded();
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // writeDraft reads keyRef/draftRef — never stale state
      writeDraft();
    };
  }, [conversationId, applyToTextarea, focusIfNeeded, writeDraft]);

  // Also flush on pagehide / visibility hidden — before HMR reload or tab close
  useEffect(() => {
    const handler = () => flush();
    window.addEventListener('pagehide', handler);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    // Vite HMR: beforeUpdate fires before patching
    type ViteHMR = { addEventListener?: (e: string, cb: () => void) => void };
    const viteHmr = (import.meta as unknown as { hot?: ViteHMR }).hot;
    if (viteHmr?.addEventListener) {
      viteHmr.addEventListener('vite:beforeUpdate', handler);
    }
    return () => {
      window.removeEventListener('pagehide', handler);
    };
  }, [flush]);

  // Public imperative handle for container to call on send
  return { flush, clear, setDraft, getDraft };
}
