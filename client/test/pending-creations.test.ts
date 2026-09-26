import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ClientMessage,
  type ConversationConfig,
  type ServerMessage,
  classifyServerFrame,
  encodeRows,
} from '@unleashd/shared';
import { handleMessage } from '../src/atoms/actions';
import { createConversation } from '../src/atoms/commands';
import { commandFor } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { openSocket } from './fixtures/client-store';

const config: ConversationConfig = {
  provider: 'codex',
  model: { mode: 'default' },
  reasoning: { mode: 'default' },
};

function createSent(sent: readonly ClientMessage[], conversationId: string) {
  return sent.filter(
    (message) => message.type === 'create_conversation' && message.conversationId === conversationId
  );
}

function reject(sent: readonly ClientMessage[], conversationId: string, code: string): void {
  const [command] = createSent(sent, conversationId);
  if (command?.type !== 'create_conversation') throw new Error('create was not sent');
  handleMessage({
    type: 'ack',
    commandId: command.commandId,
    result: { t: 'rejected', conversationId, error: { code, message: code } },
  } as ServerMessage);
}

// Pending creations are in memory only (T19, O5). A reconnect is a new server
// epoch: a create rejected because the old server was draining is resent with
// its ORIGINAL ids (the server dedupes on them); a permanent rejection stays
// failed so the view shows why.
test('a hello resends a draining-rejected create with its ids and keeps a permanent failure', () => {
  const sent = openSocket();
  const draining = createConversation({ workingDirectory: '/tmp/a', config, kind: { t: 'chat' } });
  const invalid = createConversation({ workingDirectory: '/tmp/b', config, kind: { t: 'chat' } });
  reject(sent, draining, 'server_draining');
  reject(sent, invalid, 'create_failed');
  const [original] = createSent(sent, draining);
  sent.length = 0;

  const hello = classifyServerFrame({
    type: 'hello',
    protocol: { version: 3 },
    defaultCwd: '/',
    loading: false,
    archivedBuddyIds: [],
    ...encodeRows([]),
  });
  if (hello.t !== 'message') throw new Error(`hello did not parse: ${hello.t}`);
  handleMessage(hello.message as ServerMessage);

  assert.deepEqual(createSent(sent, draining), [original], 'resent with the original ids');
  assert.deepEqual(createSent(sent, invalid), [], 'a permanent failure is not resent');
  assert.equal(jotaiStore.get(commandFor(draining)).create?.state.tag, 'sent');
  assert.equal(jotaiStore.get(commandFor(invalid)).create?.state.tag, 'rejected');
});
