import {
  type TurnStatusViewModelOptions,
  useTurnStatusViewModel,
} from '../../hooks/useTurnStatusViewModel';

export interface TurnStatusMobileProps extends TurnStatusViewModelOptions {
  className?: string;
}

export function TurnStatusMobile({
  diagnostics,
  className = '',
  now,
  refreshIntervalMs,
}: TurnStatusMobileProps) {
  const view = useTurnStatusViewModel({ diagnostics, now, refreshIntervalMs });
  const classes = ['mobile-turn-status', `mobile-turn-status--${view.tone}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <output className={classes} aria-live="polite" title={view.title}>
      <span className="mobile-turn-status__indicator" aria-hidden="true" />
      <span className="mobile-turn-status__label">{view.label}</span>
      {view.duration ? <span className="mobile-turn-status__duration">{view.duration}</span> : null}
      {view.lastActivity ? (
        <span className="mobile-turn-status__activity">{view.lastActivity}</span>
      ) : null}
      {view.reason ? <span className="mobile-turn-status__reason">{view.reason}</span> : null}
    </output>
  );
}
