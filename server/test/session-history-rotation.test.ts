import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { type UnifiedAgentEvent, buildCommand } from '@nbardy/agent-cli';
import type { ConversationConfig, Message } from '@unleashd/shared';
import { WebSocketServer } from 'ws';
import { loadAllConversations, pollForChanges } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { NormalizedSessionCache } from '../src/adapters/session-cache';
import { TranscriptTails } from '../src/adapters/transcript-tails';
import { createConversationApplicationContext } from '../src/application/context';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  type ConversationBroadcast,
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { createSessionLoader } from '../src/lifecycle/session-loader';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { sameKeyAudience } from './fixtures/buddy-audience';

const conversationId = 'dddddddd-0000-4000-8000-000000000004';
const sessionIds = [
  'eeeeeeee-0000-4000-8000-000000000001',
  'eeeeeeee-0000-4000-8000-000000000002',
  'eeeeeeee-0000-4000-8000-000000000003',
  'eeeeeeee-0000-4000-8000-000000000004',
];
const originalDate = '2026-09-09T04:45:02.313Z';
const config: ConversationConfig = {
  provider: 'codex',
  model: { mode: 'default' },
  reasoning: { mode: 'default' },
};

test('bound native sessions retain display history across capped startup, polling and restart', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-history-rotation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const transcriptRoot = path.join(root, 'transcripts');
  await fs.mkdir(transcriptRoot);
  const files = sessionIds.map((id) => path.join(transcriptRoot, `rollout-${id}.jsonl`));
  const unrelated = path.join(transcriptRoot, 'rollout-unrelated.jsonl');
  const writeTranscript = async (file: string, id: string, date: string, messages: Message[]) => {
    const rows = [
      { timestamp: date, type: 'session_meta', payload: { id, cwd: root } },
      ...messages.map((message) => ({
        timestamp: new Date(message.timestamp).toISOString(),
        type: 'response_item',
        payload: {
          type: 'message',
          role: message.role,
          content: [
            { type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content },
          ],
        },
      })),
    ];
    await fs.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  };
  const messages: Message[][] = sessionIds.map((_id, index) => [
    {
      role: 'user',
      content: 'Please continue',
      timestamp: new Date(`2026-09-${String(9 + index).padStart(2, '0')}T05:00:00.000Z`),
    },
    {
      role: 'assistant',
      content: `Response ${index + 1}`,
      timestamp: new Date(`2026-09-${String(9 + index).padStart(2, '0')}T05:00:01.000Z`),
    },
  ]);
  // Native fork/session copies can contain inherited rows. They must appear once.
  const inherited = [...messages[0], ...messages[1]];
  for (let index = 0; index < files.length; index++) {
    await writeTranscript(
      files[index],
      sessionIds[index],
      index === 0 ? originalDate : messages[index][0].timestamp.toISOString(),
      index === 1 ? inherited : messages[index]
    );
    await fs.utimes(files[index], 100 + index, 100 + index);
  }
  await writeTranscript(unrelated, 'unrelated', originalDate, [
    { role: 'user', content: 'Unrelated private transcript', timestamp: new Date(originalDate) },
  ]);
  await fs.utimes(unrelated, 1, 1);

  const store = new ConversationConfigStore({
    appDataRoot: root,
    now: () => new Date(originalDate),
  });
  await store.create({
    conversationId,
    workingDirectory: root,
    config,
    provenance: 'user',
    currentSession: { provider: 'codex', sessionId: sessionIds[0] },
  });
  for (const id of sessionIds.slice(1))
    await store.setCurrentSession(conversationId, { provider: 'codex', sessionId: id });
  const service = new ConversationConfigService({
    store,
    resolver: { resolve: async (value) => resolveConfigAgainstProviderCatalog(value) },
  });
  const native = getDiskAdapter('codex');
  const parsedFiles: string[] = [];
  const adapter = {
    ...native,
    discoverFiles: async () =>
      (await fs.readdir(transcriptRoot)).map((file) => path.join(transcriptRoot, file)),
    parseFile: async (file: string) => {
      parsedFiles.push(file);
      return native.parseFile(file);
    },
  };
  const cache = new NormalizedSessionCache(path.join(root, 'cache'));
  const tails = new TranscriptTails();
  const webSocketServer = new WebSocketServer({ noServer: true });
  t.after(() => webSocketServer.close());

  function boot() {
    const context = createConversationApplicationContext<ConversationRuntime>({
      webSocketServer,
      completionSuppressionMs: 1,
    });
    const broadcasts: ConversationBroadcast[] = [];
    const requests: Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0][] =
      [];
    const persistCurrentSession = async (
      conversation: ConversationRuntime,
      sessionId: string,
      buddyAudienceKey?: string
    ) => {
      await store.setCurrentSession(conversation.id, {
        provider: conversation.provider,
        sessionId,
        buddyAudienceKey,
      });
    };
    const Conversation = createConversationRuntime({
      broadcast: () => {},
      registerSessionAlias: context.sessions.registerAlias,
      unregisterSessionAlias: context.sessions.unregisterAlias,
      clearExternalRunningStatus: () => {},
      clearLocalCompletionSuppression: () => {},
      markLocalCompletionSuppression: () => {},
      persistCurrentSession,
      updateBuddyStatus: () => {},
      settleBuddyDelegation: () => {},
      getConversation: context.registry.get,
      readLatestOompaRuntime: async () => ({ available: false, run: null, reason: 'fixture' }),
      createSessionId: () => 'fresh-session',
      readCurrentBuddyContext: () => ({
        briefing: 'CURRENT_BRIEFING',
        memoryGeneration: 'updated-memory',
        audience: sameKeyAudience('verified-owner'),
      }),
      executeTurn: (request) => {
        requests.push(request);
        const sessionId = request.resumeSessionId ?? 'fresh-session';
        const spec = buildCommand('codex', { prompt: request.prompt });
        return {
          // No process is spawned: an exited EventEmitter is the part of
          // ChildProcess the runtime observes, so this one cast is the fake's seam.
          child: Object.assign(new EventEmitter(), { exitCode: 0 }) as unknown as ChildProcess,
          spec,
          sessionId: Promise.resolve(sessionId),
          events: (async function* (): AsyncGenerator<UnifiedAgentEvent> {
            yield { type: 'session.started', sessionId };
            yield { type: 'turn.complete', reason: 'success' };
          })(),
          completed: Promise.resolve({
            exitCode: 0,
            signal: null,
            reason: 'success' as const,
            sessionId,
            spec,
          }),
          stop: () => {},
        };
      },
    });
    let onPoll: (() => void) | undefined;
    const loader = createSessionLoader({
      ...context,
      options: {
        startupLimit: 1,
        startupConcurrency: 1,
        startupBatchSize: 1,
        startupInitialBatchSize: 1,
        startupLogEveryFiles: 1000,
        pollIntervalMs: 5,
        externalGraceMs: 1000,
        verbose: false,
      },
      configStore: store,
      configService: service,
      loadConversations: (options) =>
        loadAllConversations({ ...options, adapters: [adapter], cache }),
      pollConversations: async (mtimes, activeIds, options) => {
        const result = await pollForChanges(mtimes, activeIds, {
          ...options,
          adapters: [adapter],
          cache,
          tails,
        });
        return result;
      },
      createConversation: (options) => new Conversation(options),
      createId: () => {
        throw new Error('History must keep its durable application id');
      },
      resolveBuddyConversation: async (buddy) => ({ context: buddy, briefing: '' }),
      dispatchInitialMessage: async () => {},
      persistCurrentSession,
      broadcast: (message) => {
        broadcasts.push(message);
        // onPoll is armed only after startup, so any update here is the poller's.
        if (message.type === 'conversations_updated') onPoll?.();
      },
      logger: {
        log: () => {},
        warn: () => {},
        error: (...args) => {
          throw new Error(args.join(' '));
        },
      },
    });
    return {
      ...context,
      loader,
      broadcasts,
      requests,
      seed: (history: Message[]) => {
        const live = new Conversation({
          id: conversationId,
          workingDirectory: root,
          existingSessionId: sessionIds[3],
          configState: {
            config,
            revision: 0,
            resolution: resolveConfigAgainstProviderCatalog(config),
          },
          done: false,
        });
        live.messages = structuredClone(history);
        live.createdAt = new Date(originalDate);
        context.registry.set(live);
        return live;
      },
      poll: async () => {
        const timer = loader.startFilePolling();
        let timeout: NodeJS.Timeout | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            onPoll = resolve;
            timeout = setTimeout(() => reject(new Error('Poll did not finish')), 2000);
          });
        } finally {
          clearInterval(timer);
          if (timeout) clearTimeout(timeout);
          onPoll = undefined;
        }
      },
    };
  }

  const first = boot();
  await first.loader.loadExistingConversations();
  const runtime = first.registry.get(conversationId);
  assert.ok(runtime);
  const expected = messages.flat().map((message) => message.content);
  assert.deepEqual(
    runtime.messages.map((message) => message.content),
    expected
  );
  assert.equal(runtime.createdAt.toISOString(), originalDate);
  assert.equal(runtime.sessionId, sessionIds[3]);
  assert.equal(first.registry.size, 1);
  assert.equal(
    parsedFiles.includes(unrelated),
    false,
    'startup cap must not import unrelated transcripts'
  );
  assert.equal(new Set(parsedFiles).size, 4, 'bound history older than the cap is loaded');

  const newRows: Message[] = [
    { role: 'user', content: 'Latest input', timestamp: new Date('2026-09-12T06:00:00Z') },
    { role: 'assistant', content: 'Latest answer', timestamp: new Date('2026-09-12T06:00:01Z') },
  ];
  runtime.messages.push(...newRows);
  await writeTranscript(files[3], sessionIds[3], '2026-09-12T05:00:00.000Z', [
    ...messages[3],
    ...newRows,
  ]);
  await first.poll();
  expected.push(...newRows.map((message) => message.content));
  assert.deepEqual(
    runtime.messages.map((message) => message.content),
    expected,
    'persisted live rows replace, rather than duplicate, streamed rows'
  );
  assert.equal(runtime.createdAt.toISOString(), originalDate);
  const update = first.broadcasts.filter((entry) => entry.type === 'conversations_updated').at(-1);
  assert.ok(update && update.type === 'conversations_updated');
  assert.equal(update.summaries, true);
  assert.equal(update.conversations[0].messageCount, expected.length);

  // A late write to a historical session refreshes its history, not current metadata.
  const late: Message = {
    role: 'assistant',
    content: 'Recovered old answer',
    timestamp: new Date('2026-09-09T05:00:02Z'),
  };
  await writeTranscript(files[0], sessionIds[0], originalDate, [...messages[0], late]);
  first.broadcasts.length = 0;
  await first.poll();
  expected.splice(2, 0, late.content);
  assert.deepEqual(
    runtime.messages.map((message) => message.content),
    expected
  );
  assert.equal(runtime.sessionId, sessionIds[3]);
  assert.equal(
    first.broadcasts.some((entry) => entry.type === 'status'),
    false
  );
  assert.deepEqual((await store.getByConversationId(conversationId))?.currentSession, {
    provider: 'codex',
    sessionId: sessionIds[3],
  });

  // A missing historical file cannot truncate history already loaded in memory.
  await fs.unlink(files[0]);
  await fs.utimes(files[3], new Date(), new Date(Date.now() + 1000));
  await first.poll();
  assert.deepEqual(
    runtime.messages.map((message) => message.content),
    expected
  );
  // Restart recovers every available source; put the intact native file back first.
  await writeTranscript(files[0], sessionIds[0], originalDate, [...messages[0], late]);
  await fs.utimes(files[0], new Date(), new Date(Date.now() + 2000));
  const second = boot();
  await second.loader.loadExistingConversations();
  const restored = second.registry.get(conversationId);
  assert.ok(restored);
  assert.equal(second.registry.size, 1);
  assert.equal(restored.createdAt.toISOString(), originalDate);
  assert.equal(restored.sessionId, sessionIds[3]);
  assert.deepEqual(
    restored.toJSON().messages.map((message) => message.content),
    expected
  );

  // If a live runtime predates disk discovery, a missing middle session must
  // retain its rows as well as an unavailable oldest-session prefix.
  await fs.unlink(files[1]);
  const third = boot();
  const live = third.seed(restored.messages);
  await third.loader.loadExistingConversations();
  await fs.utimes(files[3], new Date(), new Date(Date.now() + 3000));
  await third.poll();
  assert.deepEqual(
    live.messages.map((message) => message.content),
    expected
  );

  // A verified Buddy binding must survive both transcript loading and recovery
  // without files, including a current session inferred during hydration.
  const saved = (await store.getByConversationId(conversationId))!;
  const verified = { ...saved.currentSession!, buddyAudienceKey: 'verified-owner' };
  await store.save({
    ...saved,
    creation: { buddyContext: { buddyId: 'buddy', workspaceId: 'workspace' } },
    currentSession: verified,
  });
  for (const mode of ['transcript', 'no-transcript', 'inferred-session'] as const) {
    if (mode === 'no-transcript') {
      await fs.rm(transcriptRoot, { recursive: true });
      await fs.mkdir(transcriptRoot);
    }
    if (mode === 'inferred-session') {
      const record = (await store.getByConversationId(conversationId))!;
      await store.save({ ...record, currentSession: undefined, sessionBindings: [verified] });
    }
    const restarted = boot();
    await restarted.loader.loadExistingConversations();
    const buddy = restarted.registry.get(conversationId)!;
    assert.equal(buddy.sessionId, verified.sessionId, mode);
    buddy.sendMessage('Continue', { origin: 'owner_input', inputId: mode });
    await buddy.waitForTurnDrain();
    assert.equal(restarted.requests[0].resumeSessionId, verified.sessionId, mode);
    assert.match(restarted.requests[0].prompt, /CURRENT_BRIEFING/);
    assert.doesNotMatch(restarted.requests[0].prompt, /Response 1|Unrelated private transcript/);
    assert.deepEqual((await store.getByConversationId(conversationId))?.currentSession, verified);
  }

  // A mismatched saved provider must not restore either half of the binding.
  const record = (await store.getByConversationId(conversationId))!;
  await store.save({ ...record, config: { ...config, provider: 'claude' } });
  for (const withTranscript of [false, true]) {
    if (withTranscript) await writeTranscript(files[3], sessionIds[3], originalDate, messages[3]);
    const restarted = boot();
    await restarted.loader.loadExistingConversations();
    assert.equal(restarted.registry.get(conversationId)?.hasStartedSession(), false);
  }
});
