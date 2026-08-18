import { useCallback, useEffect, useRef, useState } from 'react';
import { interruptAndSend, queueMessage, stopConversation } from '../../atoms/actions';
import { DRAFT_KEY_PREFIX } from '../../atoms/ui';

// Matches Chat.tsx's DRAFT_SAVE_DELAY_MS — both trees write the same key.
const DRAFT_SAVE_DELAY_MS = 500;

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
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saving reads these refs, never the `draft` state. An effect keyed on
  // [conversationId, draft] looks equivalent but is not: its cleanup closes over
  // the PREVIOUS draft, so the first render's cleanup fires with '' and deletes
  // the key the load effect just read — which silently ate every forked draft.
  const draftRef = useRef('');
  const draftKeyRef = useRef('');

  const writeDraft = useCallback(() => {
    const key = draftKeyRef.current;
    if (!key) return;
    try {
      if (draftRef.current) localStorage.setItem(key, draftRef.current);
      else localStorage.removeItem(key);
    } catch {
      // Quota or private-mode failure — a lost draft must never take down the
      // composer. Same posture as the storage wrapper in atoms/ui.ts.
    }
  }, []);

  const updateDraft = useCallback(
    (value: string) => {
      setDraft(value);
      draftRef.current = value;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(writeDraft, DRAFT_SAVE_DELAY_MS);
    },
    [writeDraft]
  );

  // Draft persistence, same localStorage key as Chat.tsx. Load on conversation
  // switch. Without this, Fork silently loses its handoff: forkConversation()
  // seeds the transcript under `draft:<new id>` and the composer must pick it up
  // or the forked thread opens blank and carries nothing.
  useEffect(() => {
    if (!conversationId) return;
    const key = `${DRAFT_KEY_PREFIX}${conversationId}`;
    let saved = '';
    try {
      saved = localStorage.getItem(key) ?? '';
    } catch {
      saved = '';
    }
    draftKeyRef.current = key;
    draftRef.current = saved;
    setDraft(saved);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
    // Flush on unmount / conversation switch so a back-navigation keeps the draft.
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      writeDraft();
    };
  }, [conversationId, writeDraft]);

  const hasActiveTurn = isRunning || isStreaming;
  const hasQueue = queueLength > 0;
  const canSend = draft.trim().length > 0 && !sending;
  // One label for the button and the hint below it, so they cannot disagree.
  const sendLabel = hasActiveTurn ? 'Interrupt' : hasQueue ? 'Queue' : 'Send';

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      if (hasActiveTurn) {
        await interruptAndSend(conversationId, text);
      } else {
        await queueMessage(conversationId, text);
      }
      updateDraft('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, hasActiveTurn, sending, updateDraft]);

  const handleStop = useCallback(() => {
    stopConversation(conversationId);
  }, [conversationId]);

  // Enter inserts a newline; the button sends. This inverts the desktop binding
  // deliberately: a soft keyboard has no Shift+Enter, so intercepting Enter left
  // NO way to type a second line on a phone — and the old hint said
  // "Shift+Enter for newline", which is unactionable on the target device.
  // Standard mobile-chat behaviour (Messages, WhatsApp) is return = newline.
  // A hardware keyboard (iPad, Bluetooth) still gets Cmd/Ctrl+Enter to send.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSend) void handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const disabled = Boolean(disabledReason);
  const sendEnabled = canSend && !disabled;

  return (
    <div className="mobile-composer">
      {/* No queue-count line and no keybinding hint: both were standing helper
          text in a footer that needs to be lean. The queue depth still reaches
          the user through the send button's label ("Queue") and its title. */}

      {/* Send control lives INSIDE the box. Previously the button was a sibling
          of the textarea, so iOS auto-zoom on focus pushed it past the right
          edge and clipped it. */}
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
          disabled={disabled}
          placeholder={disabledReason ?? (hasActiveTurn ? 'Interrupt with message…' : 'Message…')}
          rows={1}
          className="mobile-composer__input"
          aria-label="Message"
        />
        <div className="mobile-composer__actions">
          {/* Stop and Send coexist during a turn. Previously Stop REPLACED Send,
              so interrupt-with-a-message was reachable only via the Enter key —
              and Enter is now a newline, which would have left no path at all. */}
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
