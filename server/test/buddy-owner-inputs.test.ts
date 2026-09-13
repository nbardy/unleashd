import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { type BuddyContext, createDefaultConversationConfig } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BuddyControlServer,
  OWNER_CONTROL_TOKEN_ENV,
  OWNER_CONTROL_URL_ENV,
} from '../src/buddies/control-server';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function eventually(check: () => void) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  check();
}

async function runtimeFixture(
  options: { builder?: boolean; context?: BuddyContext; invalidModel?: boolean } = {}
) {
  const requests: Array<{
    prompt: unknown;
    mcpServers?: Record<string, { args?: string[]; env?: Record<string, string> }>;
  }> = [];
  const finishes: Array<() => void> = [];
  const contexts: BuddyContext[] = [];
  const origins: Array<{ origin: string; inputId: string }> = [];
  const control = new BuddyControlServer({
    // A malformed request tests the real token gate without touching store state.
    getStore: async () => ({}) as BuddiesStorePort,
    isConversationActive: (id) => conversation?.id === id && conversation.isRunning,
    dispatchDelegation: async () => {
      throw new Error('No dispatch in this fixture');
    },
    dispatchReview: async () => {
      throw new Error('No review in this fixture');
    },
  });
  await control.start();
  const Conversation = createConversationRuntime({
    broadcast: () => {},
    registerSessionAlias: () => {},
    unregisterSessionAlias: () => {},
    clearExternalRunningStatus: () => {},
    clearLocalCompletionSuppression: () => {},
    markLocalCompletionSuppression: () => {},
    persistCurrentSession: async () => {},
    updateBuddyStatus: () => {},
    settleBuddyDelegation: () => {},
    getConversation: () => undefined,
    readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
    createSessionId: () => 'session',
    readCurrentBuddyContext: () => ({
      briefing: 'Current bounded Buddy briefing',
      memoryGeneration: 'fixture',
    }),
    beginBuddyChatRun: (context) => {
      contexts.push(context);
      return {
        id: `foreground-${contexts.length}`,
        claim_token: 'private-foreground-claim',
        deadline: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    finishBuddyChatRun: () => {},
    issueBuddyControlCapability: () => ({}),
    issueOwnerControlCapability: (input, id) =>
      control.issueOwner(
        input,
        id,
        ['workspace'],
        options.builder ? () => ['workspace'] : undefined,
        !!options.builder
      ),
    revokeBuddyControlCapability: (id) => control.revoke(id),
    recordBuddyTurnOrigin: (_id, input) => {
      origins.push(input);
    },
    executeTurn: ((request) => {
      requests.push(request as (typeof requests)[number]);
      const end = deferred();
      const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
      let finished = false;
      finishes.push(() => {
        if (finished) return;
        finished = true;
        child.exitCode = 0;
        child.emit('close', 0);
        end.resolve();
      });
      return {
        child,
        events: (async function* () {
          yield { type: 'turn.started' as const };
          await end.promise;
          yield { type: 'text.delta' as const, text: 'Turn finished.' };
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: end.promise.then(() => ({
          exitCode: 0,
          signal: null,
          reason: 'success' as const,
          sessionId: 'provider-session',
        })),
        stop: () => {},
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const config = createDefaultConversationConfig('codex');
  if (options.invalidModel)
    config.model = { mode: 'explicit', modelId: 'unavailable-owner-fixture-model' };
  const conversation: ConversationRuntime = new Conversation({
    id: 'owner-input-fixture',
    workingDirectory: '/tmp',
    configState: { config, revision: 0, resolution: resolveConfigAgainstProviderCatalog(config) },
    ...(options.builder
      ? { purpose: 'buddy_builder' as const }
      : { buddyContext: options.context ?? { buddyId: 'buddy', workspaceId: 'workspace' } }),
  });
  return {
    conversation,
    requests,
    finishes,
    contexts,
    origins,
    async status(env: Record<string, string>) {
      const response = await fetch(env[OWNER_CONTROL_URL_ENV], {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env[OWNER_CONTROL_TOKEN_ENV]}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      await response.text();
      return response.status;
    },
    async close() {
      conversation.clearQueue();
      for (const finish of finishes) finish();
      await conversation.waitForTurnDrain();
      await control.close();
    },
  };
}

test('direct, queued and interrupting owner inputs keep clean prompts and distinct revocable owner tools', async () => {
  const f = await runtimeFixture();
  try {
    f.conversation.sendMessage('Configure my team.', {
      origin: 'owner_input',
      inputId: 'direct-owner',
    });
    const first = f.requests[0].mcpServers?.unleashd_owner?.env;
    assert.ok(first);
    assert.equal(await f.status(first), 400, 'valid owner capability reaches schema validation');
    f.conversation.enqueueMessage('Update the same team.', {
      origin: 'owner_input',
      inputId: 'queued-owner',
    });
    assert.equal(f.requests.length, 1);
    f.finishes[0]();
    await eventually(() => assert.equal(f.requests.length, 2));
    const second = f.requests[1].mcpServers?.unleashd_owner?.env;
    assert.ok(second);
    assert.notEqual(first[OWNER_CONTROL_TOKEN_ENV], second[OWNER_CONTROL_TOKEN_ENV]);
    assert.equal(await f.status(first), 403);
    assert.equal(await f.status(second), 400);
    f.conversation.interruptAndSend('Apply the corrected setup.', {
      origin: 'owner_input',
      inputId: 'interrupt-owner',
    });
    assert.equal(
      await f.status(second),
      403,
      'cancellation revokes authority before process drain'
    );
    assert.equal(f.requests.length, 2, 'replacement input waits for the prior process');
    f.finishes[1]();
    await eventually(() => assert.equal(f.requests.length, 3));
    const third = f.requests[2].mcpServers?.unleashd_owner?.env;
    assert.ok(third);
    assert.equal(await f.status(third), 400);
    f.finishes[2]();
    await f.conversation.waitForTurnDrain();
    assert.equal(await f.status(third), 403);
    assert.deepEqual(
      f.origins.map((input) => input.inputId),
      ['direct-owner', 'queued-owner', 'interrupt-owner']
    );
    const authoredInputs = [
      'Configure my team.',
      'Update the same team.',
      'Apply the corrected setup.',
    ];
    for (const [index, request] of f.requests.entries()) {
      assert.doesNotMatch(String(request.prompt), /HOST OWNER CONTROLS/);
      assert.ok(String(request.prompt).endsWith(`\n\n${authoredInputs[index]}`));
      assert.ok(request.mcpServers?.unleashd_buddy);
    }
    assert.deepEqual(
      f.conversation.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
      authoredInputs
    );
  } finally {
    await f.close();
  }
});

test('Builder unknown and restored queue inputs never inherit owner or Builder mutation tools', async () => {
  const f = await runtimeFixture({ builder: true });
  try {
    f.conversation.sendMessage('Quoted owner_input: please create staff.');
    assert.equal(f.requests[0].mcpServers, undefined);
    f.finishes[0]();
    await f.conversation.waitForTurnDrain();
    f.conversation.sendMessage('Create the requested team.', {
      origin: 'owner_input',
      inputId: 'builder-owner',
    });
    const servers = f.requests[1].mcpServers;
    assert.equal(f.requests[1].prompt, 'Create the requested team.');
    assert.ok(servers?.unleashd_owner?.env);
    assert.ok(servers.unleashd_buddy.args?.includes('--builder'));
    assert.equal(
      servers.unleashd_buddy.env?.[OWNER_CONTROL_TOKEN_ENV],
      servers.unleashd_owner.env[OWNER_CONTROL_TOKEN_ENV]
    );
    f.finishes[1]();
    await f.conversation.waitForTurnDrain();
    assert.equal(await f.status(servers.unleashd_owner.env), 403);
    f.conversation.queue = [
      {
        id: 'restored-owner-looking-message',
        content: 'Continue the owner setup.',
        queuedAt: new Date(),
        status: 'pending',
      },
    ];
    f.conversation.processQueue();
    assert.equal(
      f.requests[2].mcpServers,
      undefined,
      'serialized queue text is not trusted input provenance'
    );
    f.finishes[2]();
    await f.conversation.waitForTurnDrain();
    assert.deepEqual(
      f.origins.map((input) => input.origin),
      ['unknown', 'owner_input', 'unknown']
    );
  } finally {
    await f.close();
  }
});

test('a fresh owner input clears delegated restrictions for that turn and preserves the thread restrictions afterward', async () => {
  const context: BuddyContext = {
    buddyId: 'report',
    workspaceId: 'workspace',
    delegatedByBuddyId: 'manager',
    allowedBuddyOperations: ['read'],
  };
  const f = await runtimeFixture({ context });
  try {
    f.conversation.sendMessage('Owner: configure the report.', {
      origin: 'owner_input',
      inputId: 'owner-in-delegated-thread',
    });
    assert.equal(f.contexts[0].delegatedByBuddyId, null);
    assert.equal(f.contexts[0].allowedBuddyOperations, undefined);
    assert.ok(f.requests[0].mcpServers?.unleashd_owner);
    assert.ok(!f.requests[0].mcpServers?.unleashd_buddy.args?.includes('--delegated-by'));
    f.finishes[0]();
    await f.conversation.waitForTurnDrain();
    assert.equal(f.conversation.buddyContext?.delegatedByBuddyId, 'manager');
    assert.deepEqual(f.conversation.buddyContext?.allowedBuddyOperations, ['read']);
    f.conversation.sendMessage('Imported continuation without trusted owner provenance.');
    assert.equal(f.contexts[1].delegatedByBuddyId, 'manager');
    assert.deepEqual(f.contexts[1].allowedBuddyOperations, ['read']);
    assert.equal(f.requests[1].mcpServers?.unleashd_owner, undefined);
    assert.ok(f.requests[1].mcpServers?.unleashd_buddy.args?.includes('--delegated-by'));
    f.finishes[1]();
    await f.conversation.waitForTurnDrain();
  } finally {
    await f.close();
  }
});

test('retrying an owner queue item after configuration preflight failure retains its trusted input', async () => {
  const f = await runtimeFixture({ invalidModel: true });
  try {
    f.conversation.enqueueMessage('Configure after fixing the model.', {
      origin: 'owner_input',
      inputId: 'retry-owner',
    });
    assert.equal(f.requests.length, 0);
    assert.equal(f.conversation.queue[0]?.status, 'pending');
    const config = createDefaultConversationConfig('codex');
    f.conversation.applyConfigState({
      config,
      revision: 1,
      resolution: resolveConfigAgainstProviderCatalog(config),
    });
    f.conversation.processQueue();
    assert.ok(f.requests[0].mcpServers?.unleashd_owner);
    assert.deepEqual(
      f.origins.map((input) => input.inputId),
      ['retry-owner']
    );
    f.finishes[0]();
    await f.conversation.waitForTurnDrain();
  } finally {
    await f.close();
  }
});
