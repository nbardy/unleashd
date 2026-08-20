import { useEffect, useState } from 'react';
import { TurnStatusView, type TurnStatusDensity } from './TurnStatusView';
import {
  type TurnDiagnosticsInput,
  buildTurnDiagnosticsViewModel,
  isActiveTurnStatus,
} from './turn-diagnostics';
import './TurnStatus.css';

export interface TurnStatusProps {
  diagnostics: TurnDiagnosticsInput;
  className?: string;
  now?: number;
  refreshIntervalMs?: number;
  density?: TurnStatusDensity;
}

export function TurnStatus({
  diagnostics,
  className = '',
  now,
  refreshIntervalMs = 1_000,
  density = 'full',
}: TurnStatusProps) {
  const [clock, setClock] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) {
      setClock(now);
      return;
    }
    const shouldRefreshRelativeTime =
      isActiveTurnStatus(diagnostics.status) || diagnostics.lastActivityAt != null;
    if (!shouldRefreshRelativeTime) {
      setClock(Date.now());
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [diagnostics.lastActivityAt, diagnostics.status, now, refreshIntervalMs]);

  const view = buildTurnDiagnosticsViewModel(diagnostics, now ?? clock);
  return <TurnStatusView view={view} className={className} density={density} />;
}
