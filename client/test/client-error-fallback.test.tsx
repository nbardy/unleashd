/**
 * The crash screen must name the crash.
 *
 * Regression guard, reported 2026-09-20: the boundary state was
 * `{ failed: boolean }`, so a `ReferenceError: useComposerSubmission is not
 * defined` in Chat.tsx rendered as "Unleashd hit an unexpected error" and
 * nothing else — no message, no stack, nothing expandable. The only way to
 * learn what broke was to leave the broken app and run `pnpm errors:list`.
 *
 * Renders the real fallback with a real description produced by the real
 * `getDerivedStateFromError` — no mocks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
// biome-ignore lint/style/useImportType: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientErrorBoundary, ClientErrorFallback } from '../src/observability/ClientErrorBoundary';

test('the crash screen shows the thrown message and an expandable stack', () => {
  const error = new Error('useComposerSubmission is not defined');
  error.stack =
    'ReferenceError: useComposerSubmission is not defined\n    at Chat (Chat.tsx:165:7)';

  const state = ClientErrorBoundary.getDerivedStateFromError(error);
  assert.equal(state.status, 'failed');
  if (state.status !== 'failed') return;

  const html = renderToStaticMarkup(<ClientErrorFallback failure={state.failure} />);

  // The reason is on screen without any interaction.
  assert.match(html, /useComposerSubmission is not defined/);
  // ...and the frame that names the culprit file is one disclosure away.
  assert.match(html, /<details/);
  assert.match(html, /at Chat \(Chat\.tsx:165:7\)/);
});

test('a thrown non-Error still yields a readable crash screen', () => {
  const state = ClientErrorBoundary.getDerivedStateFromError({ notAnError: true });
  assert.equal(state.status, 'failed');
  if (state.status !== 'failed') return;

  const html = renderToStaticMarkup(<ClientErrorFallback failure={state.failure} />);
  assert.match(html, /Non-Error object thrown by the client/);
});
