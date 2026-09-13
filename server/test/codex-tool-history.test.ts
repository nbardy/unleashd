import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadAllConversations } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { NormalizedSessionCache } from '../src/adapters/session-cache';

const timestamp = '2026-09-10T07:00:00.000Z';
const row = (type: string, payload: Record<string, unknown>) => ({ timestamp, type, payload });
const response = (payload: Record<string, unknown>) => row('response_item', payload);
const message = (role: string, text: string) =>
  response({ type: 'message', role, content: [{ type: 'input_text', text }] });
const encode = (rows: unknown[]) => `${rows.map((entry) => JSON.stringify(entry)).join('\n')}\n`;

for (const sourceKind of ['event', 'response'] as const) {
  test(`Codex ${sourceKind} history retains tool calls through completion and cached reloads`, async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-tool-history-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'session.jsonl');
    const tool = response({
      type: 'custom_tool_call',
      name: 'exec',
      call_id: 'exec-1',
      input: 'await tools.exec_command({cmd: "pwd"})',
    });
    await fs.writeFile(
      source,
      encode([
        row('session_meta', { id: 'session', cwd: directory }),
        message('user', 'Inspect the project'),
        ...(sourceKind === 'event'
          ? [row('event_msg', { type: 'user_message', message: 'Inspect the project' })]
          : []),
        response({
          type: 'function_call',
          name: 'exec_command',
          call_id: 'shell-1',
          arguments: JSON.stringify({ cmd: 'pwd' }),
        }),
        response({ type: 'function_call_output', call_id: 'shell-1', output: 'RAW TOOL OUTPUT' }),
        tool,
        // Duplicate delivery of one call is ignored; separate identical calls survive.
        tool,
        response({ ...tool.payload, call_id: 'exec-2' }),
        response({ type: 'custom_tool_call_output', call_id: 'exec-2', output: 'RAW TOOL OUTPUT' }),
        // A malformed argument payload must not drop the call or the rest of the turn.
        response({ type: 'function_call', name: 'get_inbox', call_id: 'inbox', arguments: '{' }),
      ])
    );
    let parses = 0;
    const nativeAdapter = getDiskAdapter('codex');
    const adapter = {
      ...nativeAdapter,
      discoverFiles: async () => [source],
      parseFile: async (file: string) => {
        parses++;
        return nativeAdapter.parseFile(file);
      },
    };
    const cacheDirectory = path.join(directory, 'cache');
    const cache = new NormalizedSessionCache(cacheDirectory);
    const expected = ['Inspect the project', '⚡ shell pwd', '🔧 exec', '🔧 exec', '🔧 get_inbox'];
    const checkHistory = async () => {
      const loaded = await loadAllConversations({ adapters: [adapter], cache });
      const messages = loaded.conversations.get('session')?.messages;
      assert.deepEqual(
        messages?.map((entry) => entry.content),
        expected
      );
      assert.deepEqual(messages?.[1].toolCall, {
        name: 'exec_command',
        input: '{\n  "cmd": "pwd"\n}',
      });
      assert.deepEqual(messages?.[2].toolCall, {
        name: 'exec',
        input: tool.payload.input,
      });
      assert.deepEqual(messages?.[3].toolCall, messages?.[2].toolCall);
      assert.equal(messages?.[4].toolCall?.input, '{', 'unparseable arguments stay inspectable');
    };
    await checkHistory();
    await fs.appendFile(
      source,
      encode([
        ...(sourceKind === 'event'
          ? [row('event_msg', { type: 'agent_message', message: 'Inspection complete' })]
          : []),
        message('assistant', 'Inspection complete'),
        row('event_msg', { type: 'task_complete', turn_id: 'turn-1' }),
      ])
    );
    expected.push('Inspection complete');
    await checkHistory();
    assert.equal(parses, 2);
    await checkHistory();
    assert.equal(parses, 2, 'unchanged source uses the normalized cache');

    const [cacheFile] = await fs.readdir(cacheDirectory);
    const cachePath = path.join(cacheDirectory, cacheFile);
    const stale = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    stale.version = 4;
    for (const entry of stale.session.messages) delete entry.toolCall;
    await fs.writeFile(cachePath, JSON.stringify(stale));
    await checkHistory();
    assert.equal(parses, 3, 'old caches are rebuilt from the original tool-bearing transcript');
  });
}
