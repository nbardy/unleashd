import { useCallback, useRef, useState } from 'react';
import { interruptAndSend, queueMessage, stopConversation } from '../../atoms/actions';
import { useConversationDraft } from '../../hooks/useConversationDraft';
import { usePendingAttachments } from '../../hooks/usePendingAttachments';

export function ComposerMobile({
  conversationId,
  isRunning,
  isStreaming,
  queueLength,
  disabledReason,
}: {
  conversationId: string;
  isRunning: boolean;
  isStreaming: boolean;
  queueLength: number;
  /** Set to render the composer inert with an explanation (e.g. unconfirmed). */
  disabledReason?: string;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const hasActiveTurn = isRunning || isStreaming;
  const hasQueue = queueLength > 0;
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
  }, [conversationId, draft, hasActiveTurn, hasAttachments, sending, buildContent, clearDraftPersisted, clearFiles]);

  const handleStop = useCallback(() => {
    stopConversation(conversationId);
  }, [conversationId]);

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
      {/* Pending attachments — same data as desktop, mobile-styled strip. */}
      {pendingFiles.length > 0 && (
        <div className="mobile-pending-files" aria-label="Attached files">
          {pendingFiles.map((file) => (
            <div key={file.absolutePath} className="mobile-pending-file">
              {file.previewUrl ? (
                <img className="mobile-pending-file__thumb" src={file.previewUrl} alt={file.originalName} />
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
              aria-label="Stop"
              title="Stop"
            >
              <span className="mobile-composer__stop-glyph" aria-hidden="true" />
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
    </div>
  );
}
