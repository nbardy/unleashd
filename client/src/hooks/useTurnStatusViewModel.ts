import { useEffect, useState } from 'react';
import {
  type TurnDiagnosticsInput,
  buildTurnDiagnosticsViewModel,
  isActiveTurnStatus,
} from '../utils/turn-diagnostics';

export interface TurnStatusViewModelOptions {
  diagnostics: TurnDiagnosticsInput;
  now?: number;
  refreshIntervalMs?: number;
}

export function useTurnStatusViewModel({
  diagnostics,
  now,
  refreshIntervalMs = 1_000,
}: TurnStatusViewModelOptions) {
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

  return buildTurnDiagnosticsViewModel(diagnostics, now ?? clock);
}
