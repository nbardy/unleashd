import type { QueuedMessage } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endConversation, interruptAndSend, queueMessage } from '../../atoms/actions';
import { streamFamily } from '../../atoms/conversations';
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
import { ComposerAttachments, UploadErrorNotice } from '../../views/composer/ComposerAttachments';
import { PromptPalette } from '../../views/composer/PromptPalette';
import { SendControls } from '../../views/composer/SendControls';
import { TurnStatus } from '../../views/conversation/TurnStatus';
import { FullscreenComposer } from './FullscreenComposer';

export function ComposerMobile({
  conversationId,
  isRunning,
  isStreaming,
  queue,
  disabledReason,
}: {
  conversationId: string;
  isRunning: boolean;
  isStreaming: boolean;
  /** The conversation's queue (the pane reads it once for the queue strip too). */
  queue: readonly QueuedMessage[];
  /** Set to render the composer inert with an explanation (e.g. unconfirmed). */
  disabledReason?: string;
}) {
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

  // Saved prompts: logic in hooks/useSavedPrompts, the palette is views/composer,
  // owned by the composer exactly as desktop Chat.tsx owns its own.
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

  const openPalette = useCallback(() => {
    textareaRef.current?.blur();
    setExpanded(false);
    setShowPalette(true);
  }, []);

  // Ctrl+P / Cmd+P opens the palette — the same window binding as desktop Chat.tsx.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openPalette]);

  const handleSavePrompt = useCallback(() => {
    const content = draft.trim();
    if (content) savePrompt(content);
  }, [draft, savePrompt]);

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
  const hasQueue = queue.length > 0;
  const hasText = draft.trim().length > 0;
  const hasAttachments = pendingFiles.length > 0;
  const canSend = hasText || hasAttachments;

  // Optimistic send — same contract as desktop Chat.tsx: the server ack can lag
  // seconds behind the tap (ensureReady + turn-spawn setup), so the composer
  // empties immediately and the queue strip carries the in-flight state.
  const handleSend = useCallback(async () => {
    closeEditor();
    await submit(hasActiveTurn ? interruptAndSend : queueMessage);
  }, [submit, hasActiveTurn, closeEditor]);
  const handleInterrupt = useCallback(async () => {
    closeEditor();
    await submit(interruptAndSend);
  }, [submit, closeEditor]);

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
    // Ctrl/Cmd+P bubbles to the window binding above.
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
            <TurnStatus presentation="composer" diagnostics={composerTurnDiagnostics} />
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
        {uploadError && <UploadErrorNotice error={uploadError} onDismiss={dismissUploadError} />}
        <ComposerAttachments presentation="gallery" files={pendingFiles} onRemove={removeFile} />

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
                  onClick={openPalette}
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
            <SendControls
              presentation="icons"
              turnActive={hasActiveTurn && !disabled}
              hasQueue={hasQueue}
              canSend={sendEnabled}
              onSend={() => void handleSend()}
              onInterrupt={() => void handleInterrupt()}
              onQueue={() => void handleQueue()}
              onStop={handleStop}
            />
          </div>
        </div>

        {error && (
          <div className="mobile-composer__error" role="alert">
            {error}
          </div>
        )}

        <PromptPalette
          presentation="sheet"
          isOpen={showPalette}
          onClose={() => setShowPalette(false)}
          onSelect={handleSelectPrompt}
          prompts={savedPrompts}
          fuzzySearch={fuzzySearch}
          incrementUsage={incrementUsage}
          deletePrompt={deletePrompt}
        />
      </div>
    </FullscreenComposer>
  );
}
