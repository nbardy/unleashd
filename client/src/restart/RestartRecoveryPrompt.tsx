import type { RestartRecoveryController } from '../hooks/useRestartRecovery';

export function RestartRecoveryPrompt({ recovery }: { recovery: RestartRecoveryController }) {
  return (
    <div className="restart-recovery" aria-live="polite">
      <div className="restart-recovery__copy">
        <strong>Continue from where you left off?</strong>
        <span className="restart-recovery__message ui-truncate">{recovery.currentMessage}</span>
        <span className="restart-recovery__count">
          Resubmit current message
          {recovery.queuedCount > 0
            ? ` + ${recovery.queuedCount} queued message${recovery.queuedCount === 1 ? '' : 's'}`
            : ''}
        </span>
        {recovery.error ? (
          <span className="restart-recovery__error" role="alert">
            {recovery.error}
          </span>
        ) : null}
      </div>
      <div className="restart-recovery__actions">
        <button type="button" onClick={() => void recovery.resume()} disabled={recovery.isResuming}>
          {recovery.isResuming ? 'Continuing…' : 'Continue'}
        </button>
        <button type="button" onClick={recovery.dismiss} disabled={recovery.isResuming}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
