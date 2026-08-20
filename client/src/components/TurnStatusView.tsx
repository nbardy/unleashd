import { createElement } from 'react';
import type { TurnDiagnosticsViewModel } from './turn-diagnostics';

/**
 * `compact` is for the chat header, where "Running 7s Provider output just now"
 * was mostly noise. It keeps the label + elapsed time and drops the activity /
 * reason trail — except on warning/danger tones, where that trail IS the signal
 * (stalled bridge, provider silence, failure cause). Full text stays in `title`.
 */
export type TurnStatusDensity = 'full' | 'compact';

export interface TurnStatusViewProps {
  view: TurnDiagnosticsViewModel;
  className?: string;
  density?: TurnStatusDensity;
}

const DIAGNOSTIC_TONES: ReadonlySet<TurnDiagnosticsViewModel['tone']> = new Set([
  'warning',
  'danger',
]);

export function TurnStatusView({ view, className = '', density = 'full' }: TurnStatusViewProps) {
  const classes = ['turn-status', `turn-status--${view.tone}`, className].filter(Boolean).join(' ');
  const showDetail = density === 'full' || DIAGNOSTIC_TONES.has(view.tone);
  return createElement(
    'output',
    { className: classes, 'aria-live': 'polite', title: view.title },
    createElement('span', { className: 'turn-status__indicator', 'aria-hidden': true }),
    createElement('span', { className: 'turn-status__label' }, view.label),
    view.duration
      ? createElement('span', { className: 'turn-status__duration' }, view.duration)
      : null,
    showDetail && view.lastActivity
      ? createElement('span', { className: 'turn-status__activity' }, view.lastActivity)
      : null,
    showDetail && view.reason
      ? createElement('span', { className: 'turn-status__reason' }, view.reason)
      : null
  );
}
