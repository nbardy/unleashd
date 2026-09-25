/**
 * API Tests for Claude Multi-Chat
 *
 * Spins up the server and tests WebSocket communication
 * Run with: npm test
 */

const WebSocket = require('ws');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3001; // Use different port for tests
const SERVER_URL = `ws://localhost:${PORT}`;

let serverProcess = null;
let testDataDir = null;

/**
 * Start the server on test port
 */
function startServer({ reuseDataDir = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!reuseDataDir || !testDataDir) {
      testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-api-'));
    }
    const shimDir = path.join(testDataDir, 'bin');
    fs.mkdirSync(shimDir, { recursive: true });
    const claudeShim = path.join(shimDir, 'claude');
    fs.writeFileSync(claudeShim, '#!/bin/sh\nexit 0\n', 'utf8');
    fs.chmodSync(claudeShim, 0o755);
    const env = {
      ...process.env,
      HOME: testDataDir,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
      PORT: PORT,
      UNLEASHD_DATA_DIR: testDataDir,
    };
    // Use the installed loader directly. `npx tsx` may perform package
    // resolution/update checks and exhaust the startup timeout before Node is
    // even spawned, especially on a cold or offline machine.
    serverProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: path.join(__dirname, '..', 'server'),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const startupTimeout = setTimeout(() => {
      if (!started) reject(new Error('Server failed to start within 15 seconds'));
    }, 15_000);

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Server]', output.trim());
      if (output.includes('Server running') && !started) {
        started = true;
        clearTimeout(startupTimeout);
        setTimeout(resolve, 500); // Give server async init time (7000+ files parsed)
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString().trim());
    });

    serverProcess.on('error', (error) => {
      clearTimeout(startupTimeout);
      reject(error);
    });
  });
}

/**
 * Stop the server
 */
async function stopServer({ preserveDataDir = false } = {}) {
  const processToStop = serverProcess;
  serverProcess = null;
  if (processToStop) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      processToStop.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      processToStop.kill('SIGTERM');
    });
  }
  if (!preserveDataDir && testDataDir) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    testDataDir = null;
  }
}

/**
 * Create WebSocket connection
 */
function createConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    ws._messageQueue = [];
    ws._messageWaiters = new Map();
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const waiters = ws._messageWaiters.get(message.type);
        const waiter = waiters?.shift();
        if (waiter) {
          waiter(message);
          if (waiters.length === 0) ws._messageWaiters.delete(message.type);
        } else {
          ws._messageQueue.push(message);
        }
      } catch (_error) {
        // Ignore malformed server output in this protocol-level helper.
      }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 3000);
  });
}

/**
 * Wait for specific message type from WebSocket
 */
function waitForMessage(ws, type, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const queuedIndex = ws._messageQueue.findIndex((message) => message.type === type);
    if (queuedIndex >= 0) {
      resolve(ws._messageQueue.splice(queuedIndex, 1)[0]);
      return;
    }
    const timer = setTimeout(() => {
      const waiters = ws._messageWaiters.get(type);
      const index = waiters?.indexOf(resolveMessage) ?? -1;
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);
    const resolveMessage = (message) => {
      clearTimeout(timer);
      resolve(message);
    };
    const waiters = ws._messageWaiters.get(type) ?? [];
    waiters.push(resolveMessage);
    ws._messageWaiters.set(type, waiters);
  });
}

/**
 * Send WebSocket message
 */
function send(ws, data) {
  ws.send(JSON.stringify(data));
}

function createConversationCommand(overrides = {}) {
  const provider = overrides.provider ?? 'claude';
  return {
    type: 'create_conversation',
    commandId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    workingDirectory: overrides.workingDirectory ?? process.cwd(),
    config: {
      provider,
      model: overrides.model ? { mode: 'explicit', modelId: overrides.model } : { mode: 'default' },
      reasoning:
        overrides.reasoningEffort === null
          ? { mode: 'disabled' }
          : overrides.reasoningEffort
            ? { mode: 'explicit', effort: overrides.reasoningEffort }
            : { mode: 'default' },
    },
  };
}

// Test runner
async function runTests() {
  console.log('\n🧪 Starting API Tests\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      failed++;
    }
  }

  // Retry wrapper for tests that race against server async init (7000+ file parse).
  // waitForMessage can timeout if the server hasn't finished loading when the
  // test fires. Retrying with backoff is more robust than a single long timeout.
  async function testWithRetry(name, fn, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await fn();
        console.log(`✅ ${name}`);
        passed++;
        return;
      } catch (err) {
        if (attempt < retries) {
          console.log(`⚠️  ${name} (attempt ${attempt} failed, retrying...)`);
          await new Promise((r) => setTimeout(r, 500));
        } else {
          console.log(`❌ ${name}`);
          console.log(`   Error: ${err.message}`);
          failed++;
        }
      }
    }
  }

  try {
    // Start server
    console.log('Starting server...');
    await startServer();
    console.log('Server started on port', PORT);
    console.log('');

    // Test: Connect and receive init
    await test('Connect and receive init message', async () => {
      const ws = await createConnection();
      const msg = await waitForMessage(ws, 'init');
      if (!msg.conversations) throw new Error('Missing conversations array');
      if (!msg.defaultCwd) throw new Error('Missing defaultCwd');
      if (msg.protocol?.version !== 2) throw new Error('Missing protocol v2 capability');
      ws.close();
    });

    await test('Provider catalog exposes Sol, Terra, and Luna', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/provider-catalog`);
      if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`);
      const catalog = await response.json();
      const codex = catalog.providers?.find((provider) => provider.id === 'codex');
      if (!codex) throw new Error('Missing Codex catalog entry');
      const modelIds = codex.models.map((model) => model.id);
      for (const expected of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra']) {
        if (!modelIds.includes(expected)) throw new Error(`Missing catalog model ${expected}`);
      }
    });

    await test('Protocol v2 create and revisioned config update are authoritative', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');
      const conversationId = crypto.randomUUID();
      const createCommandId = crypto.randomUUID();
      send(ws, {
        type: 'create_conversation',
        commandId: createCommandId,
        conversationId,
        workingDirectory: '/tmp',
        config: {
          provider: 'codex',
          model: { mode: 'explicit', modelId: 'gpt-5.6-luna' },
          reasoning: { mode: 'default' },
        },
      });
      const created = await waitForMessage(ws, 'conversation_created');
      if (created.commandId !== createCommandId)
        throw new Error('Create command was not correlated');
      if (created.conversation.configRevision !== 0) throw new Error('Expected revision 0');
      if (created.conversation.config.model.modelId !== 'gpt-5.6-luna') {
        throw new Error('Canonical config was not preserved');
      }

      const retryAcknowledgement = waitForMessage(ws, 'conversation_created');
      send(ws, {
        type: 'create_conversation',
        commandId: createCommandId,
        conversationId,
        workingDirectory: '/tmp',
        config: {
          provider: 'codex',
          model: { mode: 'explicit', modelId: 'gpt-5.6-luna' },
          reasoning: { mode: 'default' },
        },
      });
      const retried = await retryAcknowledgement;
      if (retried.conversation.id !== conversationId || retried.conversation.configRevision !== 0) {
        throw new Error('Idempotent create retry did not return authoritative state');
      }

      const updateCommandId = crypto.randomUUID();
      send(ws, {
        type: 'set_conversation_config',
        commandId: updateCommandId,
        conversationId,
        expectedRevision: 0,
        patch: {
          kind: 'set_model',
          model: { mode: 'explicit', modelId: 'gpt-5.6-terra' },
        },
      });
      const updated = await waitForMessage(ws, 'conversation_updated');
      if (updated.commandId !== updateCommandId)
        throw new Error('Update command was not correlated');
      if (updated.conversation.configRevision !== 1) throw new Error('Expected revision 1');

      const staleCommandId = crypto.randomUUID();
      send(ws, {
        type: 'set_conversation_config',
        commandId: staleCommandId,
        conversationId,
        expectedRevision: 0,
        patch: { kind: 'set_reasoning', reasoning: { mode: 'disabled' } },
      });
      const rejected = await waitForMessage(ws, 'command_rejected');
      if (rejected.commandId !== staleCommandId) throw new Error('Rejection was not correlated');
      if (rejected.error.code !== 'revision_conflict') {
        throw new Error(`Expected revision_conflict, got ${rejected.error.code}`);
      }
      if (rejected.authoritativeConversation?.configRevision !== 1) {
        throw new Error('Rejection omitted authoritative rollback state');
      }

      send(ws, { type: 'delete_conversation', conversationId });
      await waitForMessage(ws, 'conversation_deleted');
      ws.close();
    });

    // Test: Create conversation (retry — races with server async init)
    await testWithRetry('Create new conversation', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      send(ws, createConversationCommand());
      const msg = await waitForMessage(ws, 'conversation_created');

      if (!msg.conversation) throw new Error('Missing conversation');
      if (!msg.conversation.id) throw new Error('Missing conversation id');
      if (!msg.conversation.workingDirectory) throw new Error('Missing workingDirectory');

      ws.close();
    });

    // Test: Create conversation with custom directory
    await test('Create conversation with custom directory', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      send(ws, createConversationCommand({ workingDirectory: '/tmp' }));
      const msg = await waitForMessage(ws, 'conversation_created');

      if (msg.conversation.workingDirectory !== '/tmp') {
        throw new Error(`Expected /tmp, got ${msg.conversation.workingDirectory}`);
      }

      ws.close();
    });

    await test('Codex model defaults and explicit no-reasoning stay distinct', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      send(
        ws,
        createConversationCommand({
          workingDirectory: '/tmp',
          provider: 'codex',
          model: 'gpt-5.6-terra',
        })
      );
      const defaulted = await waitForMessage(ws, 'conversation_created');
      if (defaulted.conversation.reasoningEffort !== 'xhigh') {
        throw new Error(
          `Expected Terra default xhigh, got ${defaulted.conversation.reasoningEffort}`
        );
      }

      send(
        ws,
        createConversationCommand({
          workingDirectory: '/tmp',
          provider: 'codex',
          model: 'gpt-5.6-sol',
          reasoningEffort: null,
        })
      );
      const noReasoning = await waitForMessage(ws, 'conversation_created');
      if (noReasoning.conversation.reasoningEffort !== undefined) {
        throw new Error(
          `Expected explicit no-reasoning to omit the flag, got ${noReasoning.conversation.reasoningEffort}`
        );
      }

      ws.close();
    });

    await test('Conversation lifecycle and provider updates reach every client', async () => {
      const ws1 = await createConnection();
      await waitForMessage(ws1, 'init');
      const ws2 = await createConnection();
      await waitForMessage(ws2, 'init');

      const createOnFirstClient = waitForMessage(ws1, 'conversation_created');
      const createOnSecondClient = waitForMessage(ws2, 'conversation_updated');
      send(
        ws1,
        createConversationCommand({
          workingDirectory: '/tmp',
          provider: 'codex',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'minimal',
        })
      );
      const [created, createdOnSecond] = await Promise.all([
        createOnFirstClient,
        createOnSecondClient,
      ]);
      if (createdOnSecond.conversation.id !== created.conversation.id) {
        throw new Error('Second client received the wrong created conversation');
      }

      const updateOnSecondClient = waitForMessage(ws2, 'conversation_updated');

      send(ws1, {
        type: 'set_conversation_config',
        commandId: crypto.randomUUID(),
        conversationId: created.conversation.id,
        expectedRevision: 0,
        patch: { kind: 'set_provider', provider: 'claude' },
      });
      const updated = await updateOnSecondClient;
      if (updated.conversation.provider !== 'claude') {
        throw new Error(`Expected claude, got ${updated.conversation.provider}`);
      }
      if (updated.conversation.model !== 'opus') {
        throw new Error(`Expected Claude default opus, got ${updated.conversation.model}`);
      }
      if (updated.conversation.reasoningEffort !== 'high') {
        throw new Error(
          `Expected Claude default effort high, got ${updated.conversation.reasoningEffort}`
        );
      }

      const deleteOnFirstClient = waitForMessage(ws1, 'conversation_deleted');
      const deleteOnSecondClient = waitForMessage(ws2, 'conversation_deleted');
      send(ws1, {
        type: 'delete_conversation',
        conversationId: created.conversation.id,
      });
      const [deletedOnFirst, deletedOnSecond] = await Promise.all([
        deleteOnFirstClient,
        deleteOnSecondClient,
      ]);
      if (
        deletedOnFirst.conversationId !== created.conversation.id ||
        deletedOnSecond.conversationId !== created.conversation.id
      ) {
        throw new Error('Conversation deletion was not broadcast consistently');
      }

      ws1.close();
      ws2.close();
    });

    // Test: Invalid directory returns error
    await test('Invalid directory returns error', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      send(ws, createConversationCommand({ workingDirectory: '/nonexistent/path/12345' }));
      const msg = await waitForMessage(ws, 'command_rejected');

      if (!msg.error.message.includes('No matching folder')) {
        throw new Error(`Expected 'No matching folder' error, got: ${msg.error.message}`);
      }

      ws.close();
    });

    // Test: Delete conversation
    await test('Delete conversation', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      // Create first
      send(ws, createConversationCommand());
      const created = await waitForMessage(ws, 'conversation_created');
      const convId = created.conversation.id;

      // Delete
      send(ws, {
        type: 'delete_conversation',
        conversationId: convId,
      });
      const deleted = await waitForMessage(ws, 'conversation_deleted');

      if (deleted.conversationId !== convId) {
        throw new Error('Deleted wrong conversation');
      }

      ws.close();
    });

    // Test: Multiple connections receive same state (retry — races with server async init)
    await testWithRetry('Multiple connections sync state', async () => {
      const ws1 = await createConnection();
      const init1 = await waitForMessage(ws1, 'init');

      // Create conversation on ws1
      send(ws1, createConversationCommand());
      await waitForMessage(ws1, 'conversation_created');

      // Connect ws2 and check it sees the conversation
      const ws2 = await createConnection();
      const init2 = await waitForMessage(ws2, 'init');

      if (init2.conversations.length !== init1.conversations.length + 1) {
        throw new Error('Second connection missing new conversation');
      }

      ws1.close();
      ws2.close();
    });

    // Test: Upload rejects path traversal in conversationId
    await test('Upload rejects path traversal in conversationId', async () => {
      const http = require('node:http');
      const boundary = `----TestBoundary${Date.now()}`;
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="conversationId"',
        '',
        '../../etc',
        `--${boundary}`,
        'Content-Disposition: form-data; name="files"; filename="test.txt"',
        'Content-Type: text/plain',
        '',
        'hello',
        `--${boundary}--`,
      ].join('\r\n');

      const result = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: PORT,
            path: '/api/upload',
            method: 'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      if (result.status < 400) {
        throw new Error(`Expected 4xx, got ${result.status}`);
      }
    });

    // Test: Malformed WS message returns error (not crash)
    await test('Malformed WS message returns error', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      // Send a message missing required fields
      send(ws, { type: 'queue_message' }); // missing commandId, conversationId and content
      // Server should not crash — verify by sending a valid message after
      send(ws, createConversationCommand());
      const msg = await waitForMessage(ws, 'conversation_created');
      if (!msg.conversation.id) throw new Error('Server crashed after malformed message');

      ws.close();
    });

    await test('Malformed correlated command returns a structured rejection', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');
      const commandId = crypto.randomUUID();

      send(ws, {
        type: 'create_conversation',
        commandId,
        conversationId: crypto.randomUUID(),
        workingDirectory: '/tmp',
      });
      const rejected = await waitForMessage(ws, 'command_rejected');
      if (rejected.commandId !== commandId) {
        throw new Error(`Expected rejection for ${commandId}, got ${rejected.commandId}`);
      }
      if (rejected.error?.code !== 'invalid_message') {
        throw new Error(`Expected invalid_message, got ${rejected.error?.code}`);
      }

      ws.close();
    });

    // Test: interrupt_and_send is handled and preserves the interruption message
    await test('interrupt_and_send queues interruption message', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');

      send(ws, createConversationCommand({ workingDirectory: '/tmp' }));
      const created = await waitForMessage(ws, 'conversation_created');
      const convId = created.conversation.id;

      const commandId = crypto.randomUUID();
      send(ws, {
        type: 'interrupt_and_send',
        commandId,
        conversationId: convId,
        content: 'follow-up after interrupt',
      });
      const queueUpdated = await waitForMessage(ws, 'queue_updated');
      const accepted = await waitForMessage(ws, 'command_accepted');

      if (accepted.commandId !== commandId || accepted.conversationId !== convId) {
        throw new Error(`Expected acknowledgement for ${commandId}, got ${accepted.commandId}`);
      }

      if (queueUpdated.conversationId !== convId) {
        throw new Error(`Expected queue update for ${convId}, got ${queueUpdated.conversationId}`);
      }
      if (queueUpdated.queue.length !== 1) {
        throw new Error(`Expected 1 queued interruption, got ${queueUpdated.queue.length}`);
      }
      if (queueUpdated.queue[0].content !== 'follow-up after interrupt') {
        throw new Error(`Expected raw interruption content, got: ${queueUpdated.queue[0].content}`);
      }
      if (!['pending', 'sending'].includes(queueUpdated.queue[0].status)) {
        throw new Error(
          `Expected interruption status "pending" or "sending", got ${queueUpdated.queue[0].status}`
        );
      }

      ws.close();
    });

    // Test: Deleted conversation does not reappear on new connection (retry — races with server async init)
    await testWithRetry('Deleted conversation stays deleted on reconnect', async () => {
      const ws1 = await createConnection();
      const init1 = await waitForMessage(ws1, 'init');
      const baseCount = init1.conversations.length;

      // Create then delete
      send(ws1, createConversationCommand());
      const created = await waitForMessage(ws1, 'conversation_created');
      const convId = created.conversation.id;

      send(ws1, { type: 'delete_conversation', conversationId: convId });
      await waitForMessage(ws1, 'conversation_deleted');
      ws1.close();

      // Reconnect and verify it's gone
      const ws2 = await createConnection();
      const init2 = await waitForMessage(ws2, 'init');

      const found = init2.conversations.find((c) => c.id === convId);
      if (found) {
        throw new Error('Deleted conversation reappeared in init');
      }
      if (init2.conversations.length !== baseCount) {
        throw new Error(`Expected ${baseCount} conversations, got ${init2.conversations.length}`);
      }

      ws2.close();
    });

    await test('Active lifecycle records recover and tombstones survive a server restart', async () => {
      const ws = await createConnection();
      await waitForMessage(ws, 'init');
      const activeId = crypto.randomUUID();
      const deletedId = crypto.randomUUID();
      const config = {
        provider: 'codex',
        model: { mode: 'explicit', modelId: 'gpt-5.6-luna' },
        reasoning: { mode: 'disabled' },
      };

      for (const conversationId of [activeId, deletedId]) {
        send(ws, {
          type: 'create_conversation',
          commandId: crypto.randomUUID(),
          conversationId,
          workingDirectory: '/tmp',
          config,
        });
        await waitForMessage(ws, 'conversation_created');
      }
      send(ws, { type: 'delete_conversation', conversationId: deletedId });
      await waitForMessage(ws, 'conversation_deleted');
      ws.close();

      await stopServer({ preserveDataDir: true });
      await startServer({ reuseDataDir: true });

      const restarted = await createConnection();
      const init = await waitForMessage(restarted, 'init');
      const recovered = init.conversations.find((conversation) => conversation.id === activeId);
      if (!recovered) throw new Error('Active conversation was not recovered');
      if (recovered.sessionId !== activeId) {
        throw new Error(`Pristine conversation incorrectly resumed ${recovered.sessionId}`);
      }
      if (recovered.model !== 'gpt-5.6-luna') {
        throw new Error(`Recovered wrong model: ${recovered.model}`);
      }
      if (init.conversations.some((conversation) => conversation.id === deletedId)) {
        throw new Error('Tombstoned conversation resurrected after restart');
      }
      restarted.close();
    });

    console.log(`\n${'='.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);
  } finally {
    await stopServer();
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((err) => {
  console.error('Test runner error:', err);
  void stopServer().finally(() => process.exit(1));
});
