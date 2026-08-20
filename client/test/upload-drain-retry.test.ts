import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPLOAD_RETRY_BACKOFF_MS,
  uploadFilesWithDrainRetry,
} from '../src/hooks/usePendingAttachments';

// Regression guards for the 2026-08-20 "drag-and-drop silently does nothing
// during a dev hot reload" incident. Two distinct defects produced it:
//   1. the server refuses uploads with 503 server_draining while reloading, and
//      the client gave up after a single ~1s wait — shorter than a real restart;
//   2. the retry counter was a defaulted SECOND PARAMETER on the callback handed
//      to react-dropzone, which invokes onDrop(files, fileRejections, event) —
//      so every drag bound `fileRejections` to `attempt` and disabled the retry.
// Nothing else in the suite would catch either: tsc accepts a unary function in
// a 3-arg callback slot, and the failure path only console.error'd.

const okResponse = (files: unknown[]) =>
  ({ ok: true, status: 200, json: async () => ({ files }) }) as unknown as Response;

const drainingResponse = () =>
  ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    json: async () => ({ error: 'server_draining', retryable: true }),
  }) as unknown as Response;

const hardFailure = () =>
  ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: async () => ({ error: 'no files' }),
  }) as unknown as Response;

function recordingFetch(responses: Response[]) {
  const calls: number[] = [];
  const impl = (async () => {
    calls.push(calls.length);
    const next = responses.shift();
    assert.ok(next, 'fetch called more times than the test scripted');
    return next;
  }) as unknown as typeof fetch;
  return { impl, callCount: () => calls.length };
}

test('an upload survives a drain that outlasts the first retry', async () => {
  // Three consecutive drains is a normal restart: old process draining, then the
  // replacement rehydrating. The pre-fix single retry gave up at the second.
  const { impl, callCount } = recordingFetch([
    drainingResponse(),
    drainingResponse(),
    drainingResponse(),
    okResponse([{ originalName: 'a.png', absolutePath: '/tmp/a.png', mimeType: 'image/png', size: 1 }]),
  ]);
  const slept: number[] = [];
  const result = await uploadFilesWithDrainRetry('conv-1', [], impl, async (ms) => {
    slept.push(ms);
  });

  assert.equal(result.files[0]?.originalName, 'a.png');
  assert.equal(callCount(), 4);
  assert.deepEqual(slept, UPLOAD_RETRY_BACKOFF_MS.slice(0, 3));
});

test('a non-retryable rejection fails immediately instead of burning the backoff', async () => {
  const { impl, callCount } = recordingFetch([hardFailure()]);
  await assert.rejects(
    () => uploadFilesWithDrainRetry('conv-1', [], impl, async () => undefined),
    /Upload failed: no files/
  );
  assert.equal(callCount(), 1);
});

test('a drain that never lifts gives up after the whole schedule', async () => {
  const responses = Array.from({ length: UPLOAD_RETRY_BACKOFF_MS.length + 1 }, drainingResponse);
  const { impl, callCount } = recordingFetch(responses);
  await assert.rejects(
    () => uploadFilesWithDrainRetry('conv-1', [], impl, async () => undefined),
    /Upload failed: server_draining/
  );
  // One attempt per backoff step, plus the initial try — and then it stops.
  assert.equal(callCount(), UPLOAD_RETRY_BACKOFF_MS.length + 1);
});
