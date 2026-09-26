import type { QueuedMessage } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endConversation, interruptAndSend, queueMessage } from '../../atoms/actions';
import { queueOf, streamFamily, transcriptFamily } from '../../atoms/conversations';
import { useComposerSubmission } from '../../hooks/useComposerSubmission';
import { useConversationDraft } from '../../hooks/useConversationDraft';
import { usePendingAttachments } from '../../hooks/usePendingAttachments';
import { useRestartRecovery } from '../../hooks/useRestartRecovery';
import { useSavedPrompts } from '../../hooks/useSavedPrompts';
import { useTurnDiagnostics } from '../../hooks/useTurnDiagnostics';
import { RestartRecoveryPrompt } from '../../restart/RestartRecoveryPrompt';
import {
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
} from '../../utils/turn-diagnostics';
import { FullscreenComposer } from './FullscreenComposer';
import { ComposerAttachments } from './ComposerAttachments';
import { PromptPaletteMobile } from './PromptPaletteMobile';
import { TurnStatusMobile } from './TurnStatusMobile';

export function ComposerMobile({
  conversationId,
  isRunning,
  isStreaming,
  queue,
  disabledReason,
  onOpenPalette,
  paletteSelectedContent,
  onSavePrompt,
}: {
  conversationId: string;
  isRunning: boolean;
  isStreaming: boolean;
  /** Full queue list — per-item cancel via cancelQueuedMessage. */
  queue?: readonly QueuedMessage[];
  /** Set to render the composer inert with an explanation (e.g. unconfirmed). */
  disabledReason?: string;
  /** Optional: called when the palette button is pressed (parent owns palette). */
  onOpenPalette?: () => void;
  /** Optional: content selected from a parent-owned palette to insert. */
  paletteSelectedContent?: string | null;
  /** Optional: parent-owned savePrompt (single hook source). Falls back to own hook. */
  onSavePrompt?: (content: string) => void;
}) {
  // Queue — shared atom family with desktop (no new state). Accepts prop
  // queue list when parent (ConversationView) passes it; falls back to atom
  // read so standalone use still shows queue. Hook before any early return.
  const queueFromAtom = queueOf(useAtomValue(transcriptFamily(conversationId ?? '')));
  const resolvedQueue: readonly QueuedMessage[] = queue ?? queueFromAtom ?? [];

  const [expanded, setExpanded] = useState(false);
  const closeEditor = useCallback(() => {
    textareaRef.current?.blur();
    setExpanded(false);
  }, []);
  // Mirrors the draft hook for rendering only. The send path reads the hook's
  // own authoritative getDraft(), never this lagging copy.
  const [draft, setDraft] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolbarPointerRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prompt palette — thin wrapper over shared hook (logic in hooks/, UI here).
  // Mirrors desktop Chat.tsx: { savePrompt, fuzzySearch, incrementUsage, deletePrompt } + <PromptPalette>.
  // Mobile never imports components/* (G3) — this wrapper lives in mobile/components/.
  const {
    savePrompt,
    prompts: savedPrompts,
    fuzzySearch,
    incrementUsage,
    deletePrompt,
  } = useSavedPrompts();

  // Portable draft persistence — same hook desktop Chat.tsx uses.
  // Fork handoff seeds `draft:<newId>`; this hook loads it and debounces saves.
  const draftHandle = useConversationDraft({
    conversationId,
    textareaRef,
    maxHeight: 120,
    autoFocus: false,
    controlled: true,
    onDraftLoaded: setDraft,
    onDraftChange: setDraft,
  });
  const { setDraft: setDraftPersisted } = draftHandle;

  // Shared attachment lifecycle — same hook desktop Chat.tsx uses so both
  // trees share upload (POST /api/upload), object-URL previews, framing,
  // and localStorage key `pendingFiles:{conversationId}`.
  const attachments = usePendingAttachments(conversationId);
  const {
    pendingFiles,
    isUploading,
    handleFilesUpload,
    uploadError,
    dismissUploadError,
    removeFile,
    handlePaste,
  } = attachments;

  // One send path, shared with desktop. See hooks/useComposerSubmission.ts.
  const { submit, error } = useComposerSubmission(conversationId, draftHandle, attachments);

  const updateDraft = useCallback(
    (value: string) => {
      setDraftPersisted(value);
    },
    [setDraftPersisted]
  );

  // Ctrl+P / Cmd+P to open palette — matches desktop Chat.tsx window listener.
  // Also handles palette selection pushed from parent (ConversationView) via prop.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        textareaRef.current?.blur();
        setExpanded(false);
        if (onOpenPalette) onOpenPalette();
        else setShowPalette(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenPalette]);

  // Parent-owned palette selection (ConversationView -> ComposerMobile)
  useEffect(() => {
    if (paletteSelectedContent) {
      updateDraft(paletteSelectedContent);
      requestAnimationFrame(() => textareaRef.current?.focus());
      // resize textarea to fit
      if (textareaRef.current) {
        const ta = textareaRef.current;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
      }
    }
  }, [paletteSelectedContent, updateDraft]);

  // Also listen for custom event bridge (alternative parent->child channel)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail) {
        updateDraft(detail);
        requestAnimationFrame(() => textareaRef.current?.focus());
        if (textareaRef.current) {
          const ta = textareaRef.current;
          ta.style.height = 'auto';
          ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
        }
      }
    };
    window.addEventListener('prompt-palette:select', handler as EventListener);
    return () => window.removeEventListener('prompt-palette:select', handler as EventListener);
  }, [updateDraft]);

  const handleSavePrompt = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    if (onSavePrompt) onSavePrompt(content);
    else savePrompt(content);
  }, [draft, savePrompt, onSavePrompt]);

  // Turn diagnostics — same hook as ConversationView (and desktop Chat.tsx).
  // Composer owns its own subscription so typing/turn status remains visible
  // even when the conversation pane is not mounted (e.g. embedded use).
  // Reuses derived view model, not new state.
  const streamingText = useAtomValue(streamFamily(conversationId));
  const runtimeTurnActive = isRunning || isStreaming;
  const { attempt: composerTurnAttempt } = useTurnDiagnostics(
    conversationId || undefined,
    runtimeTurnActive
  );
  const restartRecovery = useRestartRecovery(
    conversationId,
    composerTurnAttempt,
    runtimeTurnActive
  );
  const composerTurnDiagnostics =
    composerTurnAttempt && shouldPresentTurnAttempt(composerTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(composerTurnAttempt)
      : null;
  const composerShowTyping = shouldShowTypingIndicator(isStreaming, streamingText ?? '');

  const handleSelectPrompt = useCallback(
    (content: string) => {
      updateDraft(content);
      requestAnimationFrame(() => textareaRef.current?.focus());
      if (textareaRef.current) {
        const ta = textareaRef.current;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
      }
    },
    [updateDraft]
  );

  const hasActiveTurn = isRunning || isStreaming;
  const hasQueue = resolvedQueue.length > 0;
  const hasText = draft.trim().length > 0;
  const hasAttachments = pendingFiles.length > 0;
  const canSend = hasText || hasAttachments;
  // One label for the button and the hint below it, so they cannot disagree.
  const sendLabel = hasActiveTurn ? 'Interrupt' : hasQueue ? 'Queue' : 'Send';

  // Optimistic send — same contract as desktop Chat.tsx: the server ack can lag
  // seconds behind the tap (ensureReady + turn-spawn setup), so the composer
  // empties immediately and the queue strip carries the in-flight state.
  const handleSend = useCallback(async () => {
    closeEditor();
    await submit(hasActiveTurn ? interruptAndSend : queueMessage);
  }, [submit, hasActiveTurn, closeEditor]);

  // Desktop's only stop affordance is endConversation (clear_queue then
  // stop_conversation, Sidebar.tsx). Mobile called bare stopConversation, so
  // tapping Stop on a runaway agent ended the current turn and the next queued
  // message started immediately — there was no "stop everything" on a phone.
  // Per-item cancel and Clear All in MobileQueueStrip cover the finer-grained
  // case, so Stop matches desktop and means end all work.
  const handleStop = useCallback(() => {
    endConversation(conversationId);
  }, [conversationId]);

  // A phone has no Tab key, so the desktop queue-vs-interrupt toggle is
  // unreachable here. Without this the only send path during an active turn was
  // interruptAndSend, which destroys the in-flight turn's partial progress —
  // "add a follow-up without killing the current turn" was impossible on mobile.
  const handleQueue = useCallback(async () => {
    closeEditor();
    await submit(queueMessage);
  }, [submit, closeEditor]);

  const handleFilesSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = '';
      if (files.length > 0) await handleFilesUpload(files);
    },
    [handleFilesUpload]
  );

  // Enter inserts a newline; the button sends. This inverts the desktop binding
  // deliberately: a soft keyboard has no Shift+Enter, so intercepting Enter left
  // NO way to type a second line on a phone — and the old hint said
  // "Shift+Enter for newline", which is unactionable on the target device.
  // Standard mobile-chat behaviour (Messages, WhatsApp) is return = newline.
  // A hardware keyboard (iPad, Bluetooth) still gets Cmd/Ctrl+Enter to send.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      closeEditor();
      if (onOpenPalette) onOpenPalette();
      else setShowPalette(true);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSend && !disabled) void handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    updateDraft(value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const disabled = Boolean(disabledReason);
  const sendEnabled = canSend && !disabled;

  return (
    <FullscreenComposer expanded={expanded} onClose={closeEditor}>
      <div
        className="mobile-composer"
        onPointerDownCapture={(event) => {
          // Safari does not focus tapped buttons. Remember pointer intent so its
          // textarea blur cannot collapse the editor before the button's click.
          toolbarPointerRef.current = Boolean(
            (event.target as HTMLElement).closest('button, summary')
          );
        }}
      >
        {restartRecovery ? <RestartRecoveryPrompt recovery={restartRecovery} /> : null}
        {composerTurnDiagnostics ? (
          <div className="mobile-composer__turn-status">
            <TurnStatusMobile diagnostics={composerTurnDiagnostics} />
          </div>
        ) : null}
        {hasActiveTurn && !composerTurnDiagnostics && !composerShowTyping ? (
          <div className="mobile-composer__turn-status" role="status">
            Running
          </div>
        ) : null}
        {composerShowTyping && !composerTurnDiagnostics ? (
          <div className="mobile-composer__typing" aria-live="polite">
            <span className="mobile-composer__typing-dot" />
            <span className="mobile-composer__typing-dot" />
            <span className="mobile-composer__typing-dot" />
          </div>
        ) : null}
        {/* Upload failure — parity with desktop. A failed drop/paste must never
          look like an ignored one; see usePendingAttachments' uploadError. */}
        {uploadError && (
          <div className="mobile-upload-error ui-row" role="alert">
            <span className="mobile-upload-error__text">{uploadError}</span>
            <button
              type="button"
              className="mobile-upload-error__dismiss"
              onClick={dismissUploadError}
              aria-label="Dismiss upload error"
            >
              ×
            </button>
          </div>
        )}
        <ComposerAttachments files={pendingFiles} onRemove={removeFile} />

        {/* Hidden file input — triggered by the attach button. Same POST /api/upload
          as desktop; accept any file, preview only for images. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFilesSelected}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />

        <div
          className={
            disabled
              ? 'mobile-composer__box mobile-composer__box--disabled'
              : 'mobile-composer__box'
          }
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
              toolbarPointerRef.current = false;
              setExpanded(true);
            }}
            onBlur={(event) => {
              const toolbarInteraction = toolbarPointerRef.current;
              toolbarPointerRef.current = false;
              if (event.relatedTarget || toolbarInteraction) return;
              requestAnimationFrame(() => {
                if (document.activeElement === document.body) setExpanded(false);
              });
            }}
            disabled={disabled}
            placeholder={disabledReason ?? (hasActiveTurn ? 'Interrupt with message…' : 'Message…')}
            rows={1}
            className="mobile-composer__input"
            aria-label="Message"
          />
          <div className="mobile-composer__actions">
            <details className="mobile-composer__tools">
              <summary aria-label="Composer tools">+</summary>
              <div
                className="mobile-composer__tool-menu"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }
                }}
              >
                {/* Save prompt — mirrors desktop Chat.tsx save-prompt-btn (star). Thin UI, logic in hook. */}
                <button
                  type="button"
                  onClick={handleSavePrompt}
                  disabled={disabled || !hasText}
                  className="mobile-composer__btn mobile-composer__btn--save"
                  aria-label="Save prompt"
                  title="Save prompt (prompt palette: Ctrl+P)"
                >
                  <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
                    ☆
                  </span>
                </button>
                {/* Palette — mobile sheet trigger (desktop uses Ctrl+P only). */}
                <button
                  type="button"
                  onClick={() => {
                    closeEditor();
                    if (onOpenPalette) onOpenPalette();
                    else setShowPalette(true);
                  }}
                  disabled={disabled}
                  className="mobile-composer__btn mobile-composer__btn--palette"
                  aria-label="Open prompt palette"
                  title="Prompt palette (Ctrl+P)"
                >
                  <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
                    ☰
                  </span>
                </button>
                {/* Attach — reuses desktop's upload path (same hook). */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || isUploading}
                  className="mobile-composer__btn mobile-composer__btn--attach"
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
                    📎
                  </span>
                </button>
              </div>
            </details>
            <button
              type="button"
              className="mobile-composer__done"
              onClick={(event) => {
                closeEditor();
                event.currentTarget.blur();
              }}
            >
              Done
            </button>
            {hasActiveTurn && !disabled && (
              <button
                type="button"
                onClick={handleStop}
                className="mobile-composer__btn mobile-composer__btn--stop"
                aria-label="Stop all work"
                title="Stop all work (also clears queued messages)"
              >
                <span className="mobile-composer__stop-glyph" aria-hidden="true" />
              </button>
            )}
            {hasActiveTurn && !disabled && (
              <button
                type="button"
                onClick={() => void handleQueue()}
                disabled={!sendEnabled}
                className="mobile-composer__btn mobile-composer__btn--queue"
                aria-label="Queue message"
                title="Queue after the current turn (does not interrupt)"
              >
                <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                  ⏱
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!sendEnabled}
              className="mobile-composer__btn mobile-composer__btn--send"
              aria-label={sendLabel}
              title={sendLabel}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path
                  d="M12 19V5M12 5l-6 6M12 5l6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {error && (
          <div className="mobile-composer__error" role="alert">
            {error}
          </div>
        )}

        {/* Prompt palette — mobile bottom-sheet (thin wrapper). When parent owns palette
          (ConversationView), this self palette is the fallback for standalone usage. */}
        {!onOpenPalette && (
          <PromptPaletteMobile
            isOpen={showPalette}
            onClose={() => setShowPalette(false)}
            onSelect={handleSelectPrompt}
            prompts={savedPrompts}
            fuzzySearch={fuzzySearch}
            incrementUsage={incrementUsage}
            deletePrompt={deletePrompt}
          />
        )}
      </div>
    </FullscreenComposer>
  );
}
