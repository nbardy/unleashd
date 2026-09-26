import './SendControls.css';

/**
 * The queue/interrupt controls of both composers. The semantics are shared:
 * with no turn running the primary action sends (it queues behind nothing);
 * during a turn the primary action INTERRUPTS, and queueing is the secondary
 * action. The callers own the actions (hooks/useComposerSubmission).
 *
 * `presentation` is picked by the caller:
 * - `labelled`: one text button (Send / Interrupt) plus a "Tab to queue" hint;
 *   the keyboard owns queueing (Tab) and the Sidebar owns stopping (desktop).
 * - `icons`: round icon buttons. A phone has no Tab key, so a running turn gets
 *   explicit Stop (ends all work, clearing the queue) and Queue buttons;
 *   without Queue the only send path mid-turn destroyed the turn's progress.
 */
export type SendControlsPresentation = 'labelled' | 'icons';

export interface SendControlsProps {
  /** A turn is running AND the composer may act on it. */
  turnActive: boolean;
  /** Messages are waiting: an idle send joins them rather than starting fresh. */
  hasQueue: boolean;
  /** There is content to send and the conversation accepts it. */
  canSend: boolean;
  onSend: () => void;
  onInterrupt: () => void;
  onQueue: () => void;
  onStop: () => void;
}

/** One label for the button, its tooltip and any hint, so they cannot disagree. */
function primaryLabel({ turnActive, hasQueue }: SendControlsProps): string {
  if (turnActive) return 'Interrupt';
  return hasQueue ? 'Queue' : 'Send';
}

function LabelledControls(props: SendControlsProps) {
  const { turnActive, canSend, onSend, onInterrupt } = props;
  const label = primaryLabel(props);
  return (
    <div className="send-action ui-stack">
      <button
        type="button"
        className={`send-btn ui-control ${turnActive ? 'interrupt-mode' : ''}`}
        onClick={turnActive ? onInterrupt : onSend}
        disabled={!canSend}
        title={turnActive ? 'Enter: Interrupt & send | Tab: Queue' : 'Enter: Send | Tab: Queue'}
      >
        {label}
      </button>
      {turnActive && canSend && (
        <div className="send-queue-hint ui-muted" aria-live="polite">
          Tab to queue
        </div>
      )}
    </div>
  );
}

function IconControls(props: SendControlsProps) {
  const { turnActive, canSend, onSend, onInterrupt, onQueue, onStop } = props;
  const label = primaryLabel(props);
  return (
    <>
      {turnActive && (
        <button
          type="button"
          onClick={onStop}
          className="send-controls__icon send-controls__icon--stop"
          aria-label="Stop all work"
          title="Stop all work (also clears queued messages)"
        >
          <span className="send-controls__stop-glyph" aria-hidden="true" />
        </button>
      )}
      {turnActive && (
        <button
          type="button"
          onClick={onQueue}
          disabled={!canSend}
          className="send-controls__icon send-controls__icon--queue"
          aria-label="Queue message"
          title="Queue after the current turn (does not interrupt)"
        >
          <span aria-hidden="true">⏱</span>
        </button>
      )}
      <button
        type="button"
        onClick={turnActive ? onInterrupt : onSend}
        disabled={!canSend}
        className="send-controls__icon send-controls__icon--send"
        aria-label={label}
        title={label}
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
    </>
  );
}

const CONTROLS: Record<SendControlsPresentation, (props: SendControlsProps) => React.JSX.Element> =
  {
    labelled: LabelledControls,
    icons: IconControls,
  };

export function SendControls({
  presentation,
  ...props
}: SendControlsProps & { presentation: SendControlsPresentation }) {
  const Controls = CONTROLS[presentation];
  return <Controls {...props} />;
}
