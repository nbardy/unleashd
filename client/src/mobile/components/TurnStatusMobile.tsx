import { useEffect, useState } from 'react';
import {
  type TurnDiagnosticsInput,
  buildTurnDiagnosticsViewModel,
  isActiveTurnStatus,
} from '../../utils/turn-diagnostics';

export interface TurnStatusMobileProps {
  diagnostics: TurnDiagnosticsInput;
  className?: string;
  now?: number;
  refreshIntervalMs?: number;
}

/**
 * Mobile variant of TurnStatus — same derived view model, same refresh logic,
 * mobile-only markup/CSS. Does not import from components/* (G3), so it reads
 * the shared logic from utils/turn-diagnostics (canonical) rather than
 * components/turn-diagnostics.
 */
export function TurnStatusMobile({
  diagnostics,
  className = '',
  now,
  refreshIntervalMs = 1000,
}: TurnStatusMobileProps) {
  const [clock, setClock] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) {
      setClock(now);
      return;
    }
    const shouldRefresh =
      isActiveTurnStatus(diagnostics.status) || diagnostics.lastActivityAt != null;
    if (!shouldRefresh) {
      setClock(Date.now());
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [diagnostics.lastActivityAt, diagnostics.status, now, refreshIntervalMs]);

  const view = buildTurnDiagnosticsViewModel(diagnostics, now ?? clock);
  const classes = ['mobile-turn-status', `mobile-turn-status--${view.tone}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <output className={classes} aria-live="polite" title={view.title}>
      <span className="mobile-turn-status__indicator" aria-hidden="true" />
      <span className="mobile-turn-status__label">{view.label}</span>
      {view.duration ? (
        <span className="mobile-turn-status__duration">{view.duration}</span>
      ) : null}
      {view.lastActivity ? (
        <span className="mobile-turn-status__activity">{view.lastActivity}</span>
      ) : null}
      {view.reason ? <span className="mobile-turn-status__reason">{view.reason}</span> : null}
    </output>
  );
}
