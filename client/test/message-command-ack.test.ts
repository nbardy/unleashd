import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMessage, queueMessage } from '../src/atoms/actions';
import { openSocket } from './fixtures/client-store';

const conversationId = '07e0146f-95c6-43a0-a506-bd48e5e8156b';

/** Queue composer text and return the correlated command the client sent for it. */
function queueAndCapture(): { settled: Promise<void>; commandId: string } {
  const sent = openSocket();
  const settled = queueMessage(conversationId, 'cont');
  const [command] = sent;
  if (command?.type !== 'queue_message') throw new Error('queue command was not sent');
  return { settled, commandId: command.commandId };
}

test('queued composer text waits for an exact server acknowledgement', async () => {
  const { settled, commandId } = queueAndCapture();
  handleMessage({ type: 'ack', commandId, result: { t: 'accepted' } });
  await settled;
});

test('draining rejection rejects the exact queued command so the composer can retain text', async () => {
  const { settled, commandId } = queueAndCapture();
  handleMessage({
    type: 'ack',
    commandId,
    result: {
      t: 'rejected',
      conversationId,
      error: {
        code: 'server_draining',
        message: 'Backend reload is draining active turns; try again after reconnecting',
      },
    },
  });

  await assert.rejects(settled, /Backend reload is draining active turns/);
});

test('uncorrelated server errors release pending composers without losing their draft', async () => {
  openSocket();
  const rejected = queueMessage(conversationId, 'cont');

  handleMessage({
    type: 'error',
    message: 'Backend reload is draining active turns; try again after reconnecting',
  });

  await assert.rejects(rejected, /Backend reload is draining active turns/);
});
