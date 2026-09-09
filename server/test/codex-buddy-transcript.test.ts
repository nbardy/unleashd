import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buddyKindFromContext } from '@unleashd/shared';
import { sessionToConversation } from '../src/adapters/disk-adapter';
import { loadAllConversations } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { NormalizedSessionCache } from '../src/adapters/session-cache';
import { buildFirstTurnCliContent } from '../src/conversations/runtime';

const timestamp = '2026-09-08T04:17:59.000Z';
const buddyContext = { buddyId: 'buddy-1', workspaceId: 'workspace-1' };
const instructions =
  '# AGENTS.md instructions for /tmp/project\n\n<INSTRUCTIONS>\nSETUP\n</INSTRUCTIONS>';
const environment = '<environment_context>\n<cwd>/tmp/project</cwd>\n</environment_context>';
const prompt = 'Can buddies message each other?';

function briefing(content: string): string {
  return buildFirstTurnCliContent({
    content,
    messageCount: 0,
    hasStartedSession: false,
    buddyContext,
    buddyBriefing: 'PRIVATE BRIEFING 🐱',
  });
}

function response(role: string, texts: string[], kinds?: string[]) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: texts.map((text) => ({ type: 'input_text', text })),
      ...(kinds && {
        internal_chat_message_metadata_passthrough: { content_item_kinds: kinds },
      }),
    },
  };
}

test('Codex app import hides setup on every turn and recovers the Buddy behind it, including cached reloads', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-buddy-transcript-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'session.jsonl');
  await fs.writeFile(
    source,
    [
      { timestamp, type: 'session_meta', payload: { id: 'session', cwd: '/tmp/project' } },
      response(
        'user',
        [instructions, environment],
        ['agents_md.instructions', 'environments.environment_context']
      ),
      response('user', [briefing(prompt)], ['user.text']),
      response('assistant', ['Yes.']),
      // Resuming in another worktree reinjects setup, sometimes alongside user text.
      response('user', [instructions], ['agents_md.instructions']),
      response(
        'user',
        [environment, 'What should we change?'],
        ['environments.environment_context', 'user.text']
      ),
      // Explicit user pastes and untagged older messages must not be hidden by text heuristics.
      response('user', [instructions], ['user.text']),
      response('user', ['Older untagged prompt.']),
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')
  );
  const adapter = { ...getDiskAdapter('codex'), discoverFiles: async () => [source] };
  const cacheDirectory = path.join(directory, 'cache');
  const cache = new NormalizedSessionCache(cacheDirectory);

  for (let pass = 0; pass < 3; pass++) {
    if (pass === 2) {
      // An unchanged v1 source must be reparsed: that cache already lost the
      // provenance tags, so transcript cleanup cannot repair its setup rows.
      const [cacheFile] = await fs.readdir(cacheDirectory);
      const cachePath = path.join(cacheDirectory, cacheFile);
      const stale = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      stale.version = 1;
      stale.session.messages = [{ role: 'user', content: instructions, timestamp }];
      await fs.writeFile(cachePath, JSON.stringify(stale));
    }
    const loaded = await loadAllConversations({ adapters: [adapter], cache });
    const conversation = loaded.conversations.get('session');
    assert.ok(conversation);
    assert.equal(conversation.kind?.kind, 'buddy');
    assert.equal(conversation.buddyContext?.buddyId, buddyContext.buddyId);
    assert.deepEqual(
      conversation.messages.map((message) => message.content),
      [prompt, 'Yes.', 'What should we change?', instructions, 'Older untagged prompt.']
    );
  }
});

test('Buddy cleanup strips envelopes beyond the first message without overriding durable identity', () => {
  for (const kind of [
    undefined,
    buddyKindFromContext({ ...buddyContext, buddyId: 'durable-buddy' }),
  ]) {
    const conversation = sessionToConversation({
      sessionId: 'session',
      filePath: '/tmp/session.jsonl',
      workingDirectory: '/tmp/project',
      provider: 'codex',
      model: 'unknown',
      createdAt: new Date(timestamp),
      modifiedAt: new Date(timestamp),
      kind,
      messages: [
        { role: 'user', content: 'Earlier user message.', timestamp: new Date(timestamp) },
        { role: 'user', content: briefing(prompt), timestamp: new Date(timestamp) },
        { role: 'assistant', content: 'Yes.', timestamp: new Date(timestamp) },
        { role: 'user', content: briefing('Follow-up.'), timestamp: new Date(timestamp) },
      ],
    });
    assert.ok(conversation);
    assert.equal(conversation.buddyContext?.buddyId, kind ? 'durable-buddy' : 'buddy-1');
    assert.deepEqual(
      conversation.messages.map((message) => message.content),
      ['Earlier user message.', prompt, 'Yes.', 'Follow-up.']
    );
  }
});
