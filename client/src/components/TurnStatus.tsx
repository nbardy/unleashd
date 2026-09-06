import {
  type TurnStatusViewModelOptions,
  useTurnStatusViewModel,
} from '../hooks/useTurnStatusViewModel';
import { type TurnStatusDensity, TurnStatusView } from './TurnStatusView';
import './TurnStatus.css';

export interface TurnStatusProps extends TurnStatusViewModelOptions {
  className?: string;
  density?: TurnStatusDensity;
}

export function TurnStatus({
  diagnostics,
  className = '',
  now,
  refreshIntervalMs,
  density = 'full',
}: TurnStatusProps) {
  const view = useTurnStatusViewModel({ diagnostics, now, refreshIntervalMs });
  return <TurnStatusView view={view} className={className} density={density} />;
}
