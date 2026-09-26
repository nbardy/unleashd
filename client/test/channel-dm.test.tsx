import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import type { Message } from '@unleashd/shared';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);

const { dmTranscriptRows } = await import('../src/components/buddies/channel-dm');
const { DmTranscript } = await import('../src/components/buddies/ChannelDmTranscript');
const { ChannelDmComposer } = await import('../src/components/buddies/ChannelDmComposer');
const { groupChatMessages } = await import('../src/utils/chat-message-groups');

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  },
});

function message(role: Message['role'], content: string, timestamp: string): Message {
  return { role, content, timestamp: new Date(timestamp) };
}

test('a DM transcript uses thread runs, not one bubble per record', () => {
  const groups = groupChatMessages(
    [
      message('user', 'Hello', '2026-09-26T10:00:00.000Z'),
      message('user', 'One more thing', '2026-09-26T10:01:00.000Z'),
      message('assistant', '⚡ Bash ls\nFour channels are up.', '2026-09-26T10:01:20.000Z'),
    ],
    null
  );
  const rows = dmTranscriptRows(groups, [
    { id: 'q1', content: 'And this', queuedAt: new Date('2026-09-26T10:02:00.000Z') },
  ]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['day', 'lead', 'continuation', 'lead', 'lead']
  );
  assert.equal(rows[1].kind === 'lead' && rows[1].author, 'owner');
  assert.equal(rows[2].kind === 'continuation' && rows[2].author, 'owner');
  assert.equal(rows[3].kind === 'lead' && rows[3].author, 'buddy');
  assert.equal(rows[3].kind === 'lead' && rows[3].body.includes('⚡ Bash ls'), true);
  assert.equal(rows[4].kind === 'lead' && rows[4].author, 'owner');
});

test('a new-chat divider starts a fresh run on the same day', () => {
  const before = groupChatMessages(
    [message('user', 'Earlier', '2026-09-26T10:00:00.000Z')],
    null
  );
  const after = groupChatMessages([message('user', 'Fresh', '2026-09-26T10:01:00.000Z')], null);
  const rows = dmTranscriptRows([
    ...before,
    { type: 'dm_divider', firstMessageIndex: 1, harness: 'codex' },
    ...after,
  ]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['day', 'lead', 'divider', 'lead']
  );
  assert.equal(rows[2].kind === 'divider' && rows[2].harness, 'codex');
});

test('DM messages render with the thread row and the channel composer', () => {
  const rows = dmTranscriptRows(
    groupChatMessages(
      [
        message('user', 'Hello', '2026-09-26T10:00:00.000Z'),
        message(
          'assistant',
          '🔧 ToolSearch select:mcp__unleashd_buddy__get_thread\nThe answer is ready.',
          '2026-09-26T10:00:30.000Z'
        ),
      ],
      null
    )
  );
  const transcript = renderToStaticMarkup(
    <MemoryRouter>
      <DmTranscript
        rows={rows}
        buddyName="Lead"
        frame="desktop"
        buddyNames={{}}
        tasks={new Map()}
      />
    </MemoryRouter>
  );
  assert.match(transcript, /channel-browser-message--lead/);
  assert.match(transcript, /channel-browser-author/);
  assert.match(transcript, />You</);
  assert.match(transcript, />Lead</);
  assert.match(transcript, /chat-activity-toggle/);
  assert.doesNotMatch(transcript, /class="message /);

  const composer = renderToStaticMarkup(
    <ChannelDmComposer
      conversationId="conv_1"
      placeholder="Message Lead"
      submit="enter"
      confirmed
      onSent={() => undefined}
    />
  );
  assert.match(composer, /class="channel-composer"/);
  assert.match(composer, /channel-composer-attach/);
  assert.match(composer, /channel-composer-send/);
  assert.match(composer, />Send</);
  assert.doesNotMatch(composer, /input-container/);
});
