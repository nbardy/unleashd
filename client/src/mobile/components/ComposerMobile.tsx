import type { QueuedMessage } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endConversation, interruptAndSend, queueMessage } from '../../atoms/actions';
import { queueAtomFamily, streamingAtomFamily } from '../../atoms/conversations';
import { useConversationDraft } from '../../hooks/useConversationDraft';
import { usePendingAttachments } from '../../hooks/usePendingAttachments';
import { useSavedPrompts } from '../../hooks/useSavedPrompts';
import { useTurnDiagnostics } from '../../hooks/useTurnDiagnostics';
import {
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
} from '../../utils/turn-diagnostics';
import { PromptPaletteMobile } from './PromptPaletteMobile';
import { TurnStatusMobile } from './TurnStatusMobile';

export function ComposerMobile({
  conversationId,
  isRunning,
  isStreaming,
  queue,
  queueLength: queueLengthLegacy,
  disabledReason,
  onOpenPalette,
  paletteSelectedContent,
  onSavePrompt,
}: {
  conversationId: string;
  isRunning: boolean;
  isStreaming: boolean;
  /** Full queue list — per-item cancel via cancelQueuedMessage. Prefer over queueLength. */
  queue?: QueuedMessage[];
  /** @deprecated — use queue. Kept for backward compat during migration. */
  queueLength?: number;
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
  const queueFromAtom = useAtomValue(queueAtomFamily(conversationId ?? ''));
  const resolvedQueue: QueuedMessage[] = queue ?? queueFromAtom ?? [];
  // Legacy fallback: queueLength prop → synthesize length for sendLabel
  const effectiveQueue: QueuedMessage[] =
    queue !== undefined
      ? queue
      : queueLengthLegacy !== undefined
        ? Array.from({ length: queueLengthLegacy }, (_, i) => ({
            id: `legacy-${i}`,
            content: '',
            queuedAt: new Date(0),
            status: 'pending' as const,
          }))
        : resolvedQueue;

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const { setDraft: setDraftPersisted, clear: clearDraftPersisted } = useConversationDraft({
    conversationId,
    textareaRef,
    maxHeight: 120,
    autoFocus: false,
    controlled: true,
    onDraftLoaded: (loaded) => setDraft(loaded),
    onDraftChange: (value) => setDraft(value),
  });

  // Shared attachment lifecycle — same hook desktop Chat.tsx uses so both
  // trees share upload (POST /api/upload), object-URL previews, framing,
  // and localStorage key `pendingFiles:{conversationId}`.
  const {
    pendingFiles,
    isUploading,
    handleFilesUpload,
    removeFile,
    clearFiles,
    buildContent,
    handlePaste,
  } = usePendingAttachments(conversationId);

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
  const streamingText = useAtomValue(streamingAtomFamily(conversationId));
  const runtimeTurnActive = isRunning || isStreaming;
  const { attempt: composerTurnAttempt } = useTurnDiagnostics(
    conversationId || undefined,
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
  const hasQueue = effectiveQueue.length > 0;
  const hasText = draft.trim().length > 0;
  const hasAttachments = pendingFiles.length > 0;
  const canSend = (hasText || hasAttachments) && !sending;
  // One label for the button and the hint below it, so they cannot disagree.
  const sendLabel = hasActiveTurn ? 'Interrupt' : hasQueue ? 'Queue' : 'Send';

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !hasAttachments) || sending) return;
    setSending(true);
    setError(null);
    const content = buildContent(text);
    try {
      if (hasActiveTurn) {
        await interruptAndSend(conversationId, content);
      } else {
        await queueMessage(conversationId, content);
      }
      clearDraftPersisted();
      clearFiles();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [
    conversationId,
    draft,
    hasActiveTurn,
    hasAttachments,
    sending,
    buildContent,
    clearDraftPersisted,
    clearFiles,
  ]);

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
    const text = draft.trim();
    if ((!text && !hasAttachments) || sending) return;
    setSending(true);
    setError(null);
    try {
      await queueMessage(conversationId, buildContent(text));
      clearDraftPersisted();
      clearFiles();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [
    conversationId,
    draft,
    hasAttachments,
    sending,
    buildContent,
    clearDraftPersisted,
    clearFiles,
  ]);

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
    <div className="mobile-composer">
      {composerTurnDiagnostics ? (
        <div className="mobile-composer__turn-status">
          <TurnStatusMobile diagnostics={composerTurnDiagnostics} />
        </div>
      ) : null}
      {composerShowTyping && !composerTurnDiagnostics ? (
        <div className="mobile-composer__typing" aria-live="polite">
          <span className="mobile-composer__typing-dot" />
          <span className="mobile-composer__typing-dot" />
          <span className="mobile-composer__typing-dot" />
        </div>
      ) : null}
      {/* Pending attachments — same data as desktop, mobile-styled strip. */}
      {pendingFiles.length > 0 && (
        <div className="mobile-pending-files" aria-label="Attached files">
          {pendingFiles.map((file) => (
            <div key={file.absolutePath} className="mobile-pending-file">
              {file.previewUrl ? (
                <img
                  className="mobile-pending-file__thumb"
                  src={file.previewUrl}
                  alt={file.originalName}
                />
              ) : (
                <span className="mobile-pending-file__icon" aria-hidden="true">
                  📄
                </span>
              )}
              <span className="mobile-pending-file__name">{file.originalName}</span>
              <button
                type="button"
                className="mobile-pending-file__remove"
                onClick={() => removeFile(file.absolutePath)}
                aria-label={`Remove ${file.originalName}`}
                title="Remove file"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

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
          disabled ? 'mobile-composer__box mobile-composer__box--disabled' : 'mobile-composer__box'
        }
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={disabledReason ?? (hasActiveTurn ? 'Interrupt with message…' : 'Message…')}
          rows={1}
          className="mobile-composer__input"
          aria-label="Message"
        />
        <div className="mobile-composer__actions">
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
            onClick={() => (onOpenPalette ? onOpenPalette() : setShowPalette(true))}
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
            {sending ? (
              <span className="mobile-composer__spinner" aria-hidden="true" />
            ) : (
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
            )}
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
  );
}
