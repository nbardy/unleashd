import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnStatusView } from '../src/components/TurnStatusView';
import {
  type TurnDiagnosticsInput,
  buildTurnDiagnosticsViewModel,
  isActiveTurnStatus,
  isNonterminalAttemptState,
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
  turnDiagnosticsPollDelay,
} from '../src/components/turn-diagnostics';

const baseAttempt = {
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:02.000Z',
};

test('attempt projection preserves every nonterminal lifecycle state', () => {
  for (const state of ['queued', 'starting', 'running', 'stopping'] as const) {
    const diagnostics = turnDiagnosticsFromAttempt({ ...baseAttempt, state });
    const view = buildTurnDiagnosticsViewModel(
      diagnostics,
      new Date('2026-07-29T00:00:05.000Z').getTime()
    );
    const expected = state[0].toUpperCase() + state.slice(1);
    assert.equal(diagnostics.status, state);
    assert.equal(view.label, expected);
    assert.equal(view.duration, '5s');
    assert.equal(isActiveTurnStatus(diagnostics.status), true);
    assert.equal(isNonterminalAttemptState(state), true);
  }
});

test('active runtime suppresses a stale terminal attempt until the current attempt appears', () => {
  const previousTerminal = { ...baseAttempt, state: 'succeeded' } as const;
  const currentRunning = { ...baseAttempt, state: 'running' } as const;

  assert.equal(shouldPresentTurnAttempt(previousTerminal, true), false);
  assert.equal(shouldPresentTurnAttempt(currentRunning, true), true);
  assert.equal(shouldPresentTurnAttempt(previousTerminal, false), true);
});

test('diagnostics polling retries 404 with bounded exponential backoff', () => {
  assert.equal(turnDiagnosticsPollDelay(false, null, 1), 1_000);
  assert.equal(turnDiagnosticsPollDelay(false, null, 2), 2_000);
  assert.equal(turnDiagnosticsPollDelay(false, null, 6), 30_000);
  assert.equal(turnDiagnosticsPollDelay(false, null, 20), 30_000);
  assert.equal(turnDiagnosticsPollDelay(true, null, 0), 2_000);
  assert.equal(turnDiagnosticsPollDelay(false, 'running', 0), 2_000);
  assert.equal(turnDiagnosticsPollDelay(false, 'succeeded', 0), 30_000);
});

test('terminal projection remains distinct from active lifecycle states', () => {
  const interrupted = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'interrupted',
    terminalCause: 'server_restart',
    terminalAt: '2026-07-29T00:00:04.000Z',
  });
  const view = buildTurnDiagnosticsViewModel(interrupted);

  assert.equal(interrupted.status, 'aborted');
  assert.equal(view.label, 'Interrupted by restart');
  assert.equal(view.duration, '4s');
  assert.equal(isActiveTurnStatus(interrupted.status), false);
  assert.equal(isNonterminalAttemptState('interrupted'), false);
});

test('terminal updates do not masquerade as provider activity', () => {
  const diagnostics = turnDiagnosticsFromAttempt({
    createdAt: '2026-07-29T00:00:00.000Z',
    startedAt: '2026-07-29T00:00:01.000Z',
    lastActivityAt: '2026-07-29T00:02:00.000Z',
    lastActivity: {
      source: 'provider_event',
      providerEventType: 'text.delta',
    },
    updatedAt: '2026-07-29T00:12:00.000Z',
    terminalAt: '2026-07-29T00:12:00.000Z',
    state: 'failed',
    terminalCause: 'idle_timeout',
  });
  const view = buildTurnDiagnosticsViewModel(
    diagnostics,
    new Date('2026-07-29T00:12:00.000Z').getTime()
  );

  assert.equal(diagnostics.lastActivityAt, '2026-07-29T00:02:00.000Z');
  assert.equal(view.lastActivity, 'Provider output 10m ago');
  assert.equal(view.reason, 'Idle watchdog: no bridge activity');
  assert.equal(view.label, 'Failed');
});

test('a turn with no bridge event does not invent provider activity from lifecycle time', () => {
  const diagnostics = turnDiagnosticsFromAttempt({
    createdAt: '2026-07-29T00:00:00.000Z',
    startedAt: '2026-07-29T00:00:01.000Z',
    updatedAt: '2026-07-29T00:10:01.000Z',
    terminalAt: '2026-07-29T00:10:01.000Z',
    state: 'failed',
    terminalCause: 'idle_timeout',
  });
  const view = buildTurnDiagnosticsViewModel(
    diagnostics,
    new Date('2026-07-29T00:10:01.000Z').getTime()
  );

  assert.equal(diagnostics.lastActivityAt, undefined);
  assert.equal(view.lastActivity, null);
  assert.equal(view.reason, 'Idle watchdog: no bridge activity');
});

test('maximum runtime and legacy timeout causes remain distinguishable', () => {
  const maximum = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'failed',
    terminalCause: 'max_runtime_timeout',
  });
  const legacy = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'failed',
    terminalCause: 'timeout',
  });

  assert.equal(maximum.reason, 'Maximum turn runtime reached');
  assert.equal(legacy.reason, 'Legacy timeout (watchdog type unavailable)');
});

test('startup bridge heartbeat reports provider silence instead of generic activity', () => {
  const diagnostics = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:11:15.000Z',
    lastActivity: {
      source: 'agent_cli_heartbeat',
      providerEventType: 'progress',
      providerEventSource: 'agent-cli.heartbeat',
      heartbeat: {
        unifiedEventSilentSeconds: 675,
        rawStdoutSilentSeconds: 675,
        phase: 'startup',
      },
    },
  });
  const view = buildTurnDiagnosticsViewModel(
    diagnostics,
    new Date('2026-07-29T00:11:37.000Z').getTime()
  );

  assert.equal(diagnostics.activity?.kind, 'bridge_heartbeat');
  assert.equal(view.label, 'Waiting for provider output');
  assert.equal(view.tone, 'warning');
  assert.equal(view.lastActivity, 'Bridge heartbeat 22s ago · provider output silent 11m 15s');
  assert.doesNotMatch(view.title, /Last activity/);
});

test('status component renders heartbeat-only startup as waiting, not generic activity', () => {
  const diagnostics = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:11:15.000Z',
    lastActivity: {
      source: 'agent_cli_heartbeat',
      providerEventType: 'progress',
      heartbeat: { rawStdoutSilentSeconds: 675, phase: 'startup' },
    },
  });
  const view = buildTurnDiagnosticsViewModel(
    diagnostics,
    new Date('2026-07-29T00:11:37.000Z').getTime()
  );
  const markup = renderToStaticMarkup(createElement(TurnStatusView, { view }));

  assert.match(markup, /Waiting for provider output/);
  assert.match(markup, /Bridge heartbeat 22s ago · provider output silent 11m 15s/);
  assert.doesNotMatch(markup, /Last activity/);
});

test('compact density drops routine activity text but never hides a stall', () => {
  // Regression guard: the chat header renders TurnStatus with density="compact"
  // to kill "Running 7s Provider output just now". Compacting must not also
  // swallow the warning/danger detail that is the whole point of the pill.
  const healthy = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:00:04.000Z',
    lastActivity: { source: 'provider_event', providerEventType: 'text.delta' },
  });
  const stalled = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:11:15.000Z',
    lastActivity: {
      source: 'agent_cli_heartbeat',
      providerEventType: 'progress',
      heartbeat: { rawStdoutSilentSeconds: 675, phase: 'startup' },
    },
  });
  const now = new Date('2026-07-29T00:11:37.000Z').getTime();
  const compact = (input: TurnDiagnosticsInput) =>
    renderToStaticMarkup(
      createElement(TurnStatusView, {
        view: buildTurnDiagnosticsViewModel(input, now),
        density: 'compact',
      })
    );

  const healthyMarkup = compact(healthy);
  const healthyBody = healthyMarkup.replace(/title="[^"]*"/, '');
  assert.match(healthyBody, /Running/);
  assert.match(healthyBody, /11m 37s/);
  assert.doesNotMatch(healthyBody, /Provider output/);
  // Full detail still reachable on hover.
  assert.match(healthyMarkup, /title="[^"]*Provider output/);

  assert.match(compact(stalled), /provider output silent 11m 15s/);
});

test('native progress and visible output remain distinct', () => {
  const native = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:00:04.000Z',
    lastActivity: {
      source: 'provider_native_activity',
      providerEventType: 'progress',
      providerEventSource: 'codex.native_session',
    },
  });
  const visible = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:00:04.000Z',
    lastActivity: {
      source: 'provider_event',
      providerEventType: 'text.delta',
    },
  });

  assert.equal(native.activity?.kind, 'native_progress');
  assert.equal(visible.activity?.kind, 'visible_output');
  assert.equal(
    buildTurnDiagnosticsViewModel(native, Date.parse('2026-07-29T00:00:05Z')).label,
    'Working'
  );
  assert.equal(
    buildTurnDiagnosticsViewModel(visible, Date.parse('2026-07-29T00:00:05Z')).lastActivity,
    'Provider output just now'
  );
});

test('heartbeat-embedded native advancement is native progress, not a bridge-only heartbeat', () => {
  const diagnostics = turnDiagnosticsFromAttempt({
    ...baseAttempt,
    state: 'running',
    lastActivityAt: '2026-07-29T00:11:15.000Z',
    lastActivity: {
      source: 'agent_cli_heartbeat',
      providerEventType: 'progress',
      providerEventSource: 'agent-cli.heartbeat',
      heartbeat: {
        unifiedEventSilentSeconds: 675,
        rawStdoutSilentSeconds: 675,
        phase: 'startup',
        nativeSessionAvailable: true,
        nativeSessionAdvanced: true,
        nativeSessionSilentSeconds: 0,
      },
    },
  });
  const view = buildTurnDiagnosticsViewModel(
    diagnostics,
    new Date('2026-07-29T00:11:37.000Z').getTime()
  );

  assert.equal(diagnostics.activity?.kind, 'native_progress');
  assert.equal(view.label, 'Working');
  assert.equal(view.lastActivity, 'Native Codex progress 22s ago · UI output silent 11m 15s');
});

test('typing indicator requires an actual text delta', () => {
  assert.equal(shouldShowTypingIndicator(true, ''), false);
  assert.equal(shouldShowTypingIndicator(true, 'First visible delta'), true);
  assert.equal(shouldShowTypingIndicator(false, 'Buffered text'), false);
});
