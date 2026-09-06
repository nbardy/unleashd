/**
 * EmptyState — generic empty state for mobile lists (§6).
 * Icon + message + optional CTA. No data fetching; caller owns copy and action.
 */

type EmptyStateProps = {
  icon?: string;
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon = '∅', title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="mobile-empty" role="status" aria-live="polite">
      <div className="mobile-empty__icon" aria-hidden="true">
        {icon}
      </div>
      {title ? <h2 className="mobile-empty__title">{title}</h2> : null}
      <p className="mobile-empty__message">{message}</p>
      {actionLabel && onAction ? (
        <button type="button" className="mobile-empty__cta" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
