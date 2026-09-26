/**
 * useConversationDraft — canonical draft lifecycle shared by desktop Chat.tsx
 * and mobile ComposerMobile.tsx. Do not duplicate inline draft state elsewhere.
 *
 * Owns the refs-only + debounce (500ms) + flush (pagehide / visibilitychange /
 * HMR via vite:beforeUpdate) contract for `draft:{conversationId}` in
 * localStorage, so future readers don't reintroduce stale-closure or focus-steal
 * bugs. Pair with usePendingAttachments.ts (revokeObjectURL on remove/clear).
 */
import { useCallback, useEffect, useRef } from 'react';
import { DRAFT_KEY_PREFIX } from '../atoms/ui';

const DRAFT_SAVE_DELAY_MS = 500;

/**
 * Write a draft to the conversation it belongs to. Addressed by id, never by
 * "whichever conversation the hook is bound to right now" — see
 * useComposerSubmission.ts for the reconnect case that distinction fixes.
 */
function readDraftFor(conversationId: string): string {
  try {
    return localStorage.getItem(`${DRAFT_KEY_PREFIX}${conversationId}`) ?? '';
  } catch {
    // quota / private-mode — caller keeps its in-memory draft
    return '';
  }
}

function writeDraftFor(conversationId: string, value: string): void {
  try {
    const key = `${DRAFT_KEY_PREFIX}${conversationId}`;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // quota / private-mode — never take down caller
  }
}

/**
 * The one draft path for both composers (`draft:<id>`). Storage goes through refs, never state
 * closures, or a switch-cleanup deletes the forked draft it just loaded. See docs/client-
 * rationale.md#conversation-draft.
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
  /** Addressed restore — see useComposerSubmission.ts. */
  restoreDraft: (conversationId: string, value: string) => void;
}

export function useConversationDraft(
  options: UseConversationDraftOptions
): UseConversationDraftReturn {
  const {
    conversationId,
    textareaRef,
    maxHeight = 300,
    autoFocus = true,
    onDraftLoaded,
    onDraftChange,
    controlled = false,
  } = options;

  const draftRef = useRef('');
  const conversationIdRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDraftLoadedRef = useRef(onDraftLoaded);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftLoadedRef.current = onDraftLoaded;
  onDraftChangeRef.current = onDraftChange;

  const writeDraft = useCallback(() => {
    if (conversationIdRef.current) writeDraftFor(conversationIdRef.current, draftRef.current);
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
    if (conversationIdRef.current) writeDraftFor(conversationIdRef.current, '');
    const ta = textareaRef.current;
    if (ta) {
      ta.value = '';
      ta.style.height = 'auto';
    }
  }, [textareaRef]);

  // Authoritative read. Uncontrolled (desktop) keeps the text in the DOM, so the
  // textarea wins there; controlled (mobile) keeps it in the ref. Callers never
  // re-implement this fallback.
  const getDraft = useCallback(
    () => (controlled ? draftRef.current : (textareaRef.current?.value ?? draftRef.current)),
    [controlled, textareaRef]
  );

  /** Put `value` back on `conversationId`'s draft, and onto the textarea only if that is what is showing. */
  const restoreDraft = useCallback(
    (conversationId: string, value: string) => {
      writeDraftFor(conversationId, value);
      if (conversationId === conversationIdRef.current) setDraft(value);
    },
    [setDraft]
  );

  // Single helper — read persisted draft, push to refs + textarea + owner,
  // then rAF re-apply + focus. Used by mount, HMR, and visibility-visible.
  const syncFromStorage = useCallback(() => {
    const saved = conversationIdRef.current
      ? readDraftFor(conversationIdRef.current)
      : draftRef.current;
    draftRef.current = saved;
    applyToTextarea(saved);
    onDraftLoadedRef.current?.(saved);
    requestAnimationFrame(() => {
      applyToTextarea(saved);
      focusIfNeeded();
    });
  }, [applyToTextarea, focusIfNeeded]);

  // Load on conversationId change. Flush previous draft on cleanup so
  // back-navigation and HMR unmount keep the draft.
  useEffect(() => {
    if (!conversationId) {
      conversationIdRef.current = '';
      draftRef.current = '';
      return;
    }
    const saved = readDraftFor(conversationId);
    conversationIdRef.current = conversationId;
    draftRef.current = saved;
    onDraftLoadedRef.current?.(saved);
    applyToTextarea(saved);
    requestAnimationFrame(() => {
      applyToTextarea(saved);
      focusIfNeeded();
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      writeDraft();
    };
  }, [conversationId, applyToTextarea, focusIfNeeded, writeDraft]);

  // Flush on pagehide/hidden/beforeunload, re-sync on visible and after HMR — portable
  // for desktop (autoFocus:true) and mobile (autoFocus:false → no steal).
  // beforeunload is the reliable hook for a hard refresh/cmd-R — pagehide
  // alone is not fired in all browsers until after the new document starts
  // loading, so the 500ms debounce would be lost without this.
  useEffect(() => {
    const onPageHide = () => flush();
    const onBeforeUnload = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (document.visibilityState === 'visible') syncFromStorage();
    };
    const onHmr = () => {
      flush();
      setTimeout(syncFromStorage, 50);
    };

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('unload', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    type ViteHMR = { addEventListener?: (e: string, cb: () => void) => void };
    (import.meta as unknown as { hot?: ViteHMR }).hot?.addEventListener?.(
      'vite:beforeUpdate',
      onHmr
    );
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('unload', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush, syncFromStorage]);

  // Public imperative handle for container to call on send
  return { flush, clear, setDraft, getDraft, restoreDraft };
}
