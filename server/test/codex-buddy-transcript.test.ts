import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buddyKind } from '@unleashd/shared';
import { sessionToConversation } from '../src/adapters/disk-adapter';
import { loadAllConversations } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { NormalizedSessionCache } from '../src/adapters/session-cache';
import { buildFirstTurnCliContent } from '../src/buddies/turn-policy';

const timestamp = '2026-09-08T04:17:59.000Z';
const buddyContext = { buddyId: 'buddy-1', workspaceId: 'workspace-1' };
const instructions =
  '# AGENTS.md instructions for /tmp/project\n\n<INSTRUCTIONS>\nSETUP\n</INSTRUCTIONS>';
const environment = '<environment_context>\n<cwd>/tmp/project</cwd>\n</environment_context>';
const recommendations =
  '<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n\n- Airtable (airtable@openai-curated-remote)\n</recommended_plugins>';
const prompt = 'Can buddies message each other?';

function briefing(content: string): string {
  return buildFirstTurnCliContent({
    content,
    messageCount: 0,
    hasStartedSession: false,
    kind: buddyKind(buddyContext),
    buddyBriefing: 'PRIVATE BRIEFING 🐱',
    swarmDebugPrefix: null,
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
      internal_chat_message_metadata_passthrough: {
        turn_id: 'turn-1',
        ...(kinds && { content_item_kinds: kinds }),
      },
    },
  };
}

test('Codex app import hides setup on every turn and strips the Buddy briefing, including cached reloads', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-buddy-transcript-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'session.jsonl');
  await fs.writeFile(
    source,
    [
      { timestamp, type: 'session_meta', payload: { id: 'session', cwd: '/tmp/project' } },
      // Codex 0.146 saved this startup bundle without content provenance tags.
      response('user', [recommendations, instructions, environment]),
      response(
        'user',
        [recommendations, instructions, environment],
        ['plugins.recommendations', 'agents_md.instructions', 'environments.environment_context']
      ),
      response('user', [briefing(prompt)], ['user.text']),
      response('assistant', ['Yes.']),
      // Resuming in another worktree reinjects setup, sometimes alongside user text.
      response('user', [instructions], ['agents_md.instructions']),
      response(
        'user',
        [recommendations, environment, 'What should we change?'],
        ['plugins.recommendations', 'environments.environment_context', 'user.text']
      ),
      // Explicit user pastes and untagged older messages must not be hidden by text heuristics.
      response('user', [instructions], ['user.text']),
      response('user', [recommendations], ['user.text']),
      response('user', [recommendations, instructions, environment]),
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
      // An unchanged v5 source must be reparsed: it retained the startup
      // recommendations and already lost the content-block boundaries.
      const [cacheFile] = await fs.readdir(cacheDirectory);
      const cachePath = path.join(cacheDirectory, cacheFile);
      const stale = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      stale.version = 5;
      stale.session.messages = [{ role: 'user', content: recommendations, timestamp }];
      await fs.writeFile(cachePath, JSON.stringify(stale));
    }
    const loaded = await loadAllConversations({ adapters: [adapter], cache });
    const conversation = loaded.conversations.get('session');
    assert.ok(conversation);
    // The Buddy owner lives on the conversation record (T09), never in the transcript.
    assert.deepEqual(conversation.discoveredKind, { t: 'chat' });
    assert.deepEqual(
      conversation.messages.map((message) => message.content),
      [
        prompt,
        'Yes.',
        'What should we change?',
        instructions,
        recommendations,
        [recommendations, instructions, environment].join('\n'),
        'Older untagged prompt.',
      ]
    );
  }
});

test('Buddy cleanup strips envelopes beyond the first message', () => {
  const conversation = sessionToConversation({
    sessionId: 'session',
    filePath: '/tmp/session.jsonl',
    workingDirectory: '/tmp/project',
    provider: 'codex',
    model: 'unknown',
    createdAt: new Date(timestamp),
    modifiedAt: new Date(timestamp),
    messages: [
      { role: 'user', content: 'Earlier user message.', timestamp: new Date(timestamp) },
      { role: 'user', content: briefing(prompt), timestamp: new Date(timestamp) },
      { role: 'assistant', content: 'Yes.', timestamp: new Date(timestamp) },
      { role: 'user', content: briefing('Follow-up.'), timestamp: new Date(timestamp) },
    ],
  });
  assert.ok(conversation);
  assert.deepEqual(
    conversation.messages.map((message) => message.content),
    ['Earlier user message.', prompt, 'Yes.', 'Follow-up.']
  );
});

test('Builder and swarm first turns lose their hidden setup on disk', () => {
  for (const builder of [true, false]) {
    const kind = builder ? ({ t: 'builder' } as const) : ({ t: 'chat' } as const);
    const swarmDebugPrefix = builder ? null : 'Internal swarm debugging context';
    const content = buildFirstTurnCliContent({
      content: prompt,
      messageCount: 0,
      hasStartedSession: false,
      kind,
      buddyBriefing: null,
      swarmDebugPrefix,
    });
    const conversation = sessionToConversation({
      sessionId: 'session',
      filePath: '/tmp/session.jsonl',
      workingDirectory: '/tmp/project',
      provider: 'codex',
      model: 'unknown',
      createdAt: new Date(timestamp),
      modifiedAt: new Date(timestamp),
      messages: [{ role: 'user', content, timestamp: new Date(timestamp) }],
    });
    assert.ok(conversation);
    assert.equal(conversation.messages[0].content, prompt);
    assert.equal(conversation.swarmDebugPrefix, swarmDebugPrefix);
  }
});
