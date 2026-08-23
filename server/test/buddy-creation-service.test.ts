import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDefaultConversationConfig } from '@unleashd/shared';
import {
  type BuddyCreationServicePorts,
  createBuddyCreationService,
  creationFingerprint,
} from '../src/conversations/buddy-creation-service';
import type { ConversationOptions, ConversationRuntime } from '../src/conversations/runtime';

const context = {
  buddyId: 'buddy-1',
  workspaceId: 'workspace-1',
  buddyProjectId: null,
};

test('creation fingerprint is stable and covers message intent', () => {
  const base = {
    workingDirectory: '/workspace',
    config: createDefaultConversationConfig('codex'),
    buddyContext: context,
  };
  assert.equal(creationFingerprint(base), creationFingerprint({ ...base }));
  assert.notEqual(
    creationFingerprint(base),
    creationFingerprint({ ...base, initialMessage: 'Ship it' })
  );
});

test('server Buddy creation persists, registers, broadcasts, links, and dispatches once', async () => {
  const registered: ConversationRuntime[] = [];
  const broadcasts: unknown[] = [];
  const linked: string[] = [];
  const queued: string[] = [];
  const creates: unknown[] = [];
  const conversationOptions: ConversationOptions[] = [];
  let claimed = false;

  class FakeConversation extends EventEmitter {
    readonly id: string;
    readonly sessionId: string;
    readonly provider = 'codex' as const;
    readonly config = createDefaultConversationConfig('codex');
    readonly buddyContext = context;
    readonly messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    constructor(options: ConversationOptions) {
      super();
      this.id = options.id;
      this.sessionId = options.id;
    }

    enqueueMessage(message: string): void {
      queued.push(message);
    }

    toJSON() {
      return { id: this.id };
    }
  }

  const config = createDefaultConversationConfig('codex');
  const ports = {
    configService: {
      async createOrReplay(input: unknown) {
        creates.push(input);
        return {
          state: {
            config,
            revision: 0,
            resolution: {
              status: 'resolved',
              value: { provider: 'codex', model: 'gpt-5.6-sol' },
            },
          },
        };
      },
      async claimInitialMessageDispatch() {
        if (claimed) return undefined;
        claimed = true;
        return {
          creation: {
            initialMessage: 'Start here',
            initialMessageDispatchClaimedAt: new Date().toISOString(),
            initialMessageDispatchClaimToken: 'claim-1',
          },
        };
      },
      async completeInitialMessageDispatch() {
        return {
          creation: {
            initialMessage: 'Start here',
            initialMessageDispatchedAt: new Date().toISOString(),
          },
        };
      },
      async getRecord() {
        return {
          creation: {
            initialMessage: 'Start here',
            initialMessageDispatchedAt: claimed ? new Date().toISOString() : undefined,
          },
        };
      },
      async setCurrentSession() {},
    },
    resolveBuddyConversation: async () => ({
      context,
      briefing: 'briefing',
      workingDirectory: '/workspace',
      provider: 'codex' as const,
      model: 'gpt-5.6-sol',
    }),
    resolveWorkingDirectory: (directory: string) => directory,
    isProviderAvailable: () => true,
    createId: () => 'conversation-1',
    createConversation: (options: ConversationOptions) => {
      conversationOptions.push(options);
      return new FakeConversation(options) as unknown as ConversationRuntime;
    },
    registerConversation: (conversation: ConversationRuntime) => registered.push(conversation),
    createConversationLink: async (conversation: ConversationRuntime) => {
      linked.push(conversation.id);
    },
    updateConversationStatus: () => undefined,
    broadcast: (message: unknown) => broadcasts.push(message),
  } as unknown as BuddyCreationServicePorts;

  const service = createBuddyCreationService(ports);
  const conversation = await service.createServerBuddyConversation({
    context,
    initialMessage: 'Start here',
    commandId: 'command-1',
  });
  await service.dispatchInitialMessageIfPending(conversation);

  assert.equal(conversation.id, 'conversation-1');
  assert.equal(creates.length, 1);
  assert.deepEqual(registered, [conversation]);
  assert.deepEqual(linked, ['conversation-1']);
  assert.equal(broadcasts.length, 1);
  assert.deepEqual(queued, ['Start here']);

  await service.createAutomationConversation(
    {
      id: 'automation-1',
      buddy_id: 'buddy-1',
      workspace_id: 'workspace-1',
      buddy_project_id: null,
      name: 'Owned run',
      schedule_kind: 'interval',
      schedule_expression: '60',
      timezone: 'UTC',
      job_kind: 'prompt',
      job_payload: { prompt: 'Work' },
      policy: {
        max_runtime_seconds: 60,
        max_iterations: 1,
        max_tokens: 1,
        max_cost_usd: 1,
        allowed_operations: ['buddy.get_current_work'],
      },
      enabled: true,
      next_run_at: null,
      last_run_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'run-1',
      automation_id: 'automation-1',
      scheduled_for: new Date().toISOString(),
      idempotency_key: 'run-1',
      status: 'claimed',
      conversation_id: null,
      iteration: 0,
      tokens_used: 0,
      cost_usd: 0,
      policy: {
        max_runtime_seconds: 60,
        max_iterations: 1,
        max_tokens: 1,
        max_cost_usd: 1,
        allowed_operations: ['buddy.get_current_work'],
      },
      outcome: null,
      error: null,
      claimed_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      claim_token: 'private-claim-token',
      claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }
  );
  assert.equal(conversationOptions.at(-1)?.automationClaimToken, 'private-claim-token');
  assert.equal('automationClaimToken' in (conversationOptions.at(-1) ?? {}), true);

  claimed = false;
  const queuedBeforeDormantCreate = queued.length;
  const dormant = await service.createServerBuddyConversation({
    context,
    initialMessage: 'Must remain dormant',
    commandId: 'deferred-command',
    deferInitialMessage: true,
  });
  assert.equal(queued.length, queuedBeforeDormantCreate);
  await assert.rejects(
    service.dispatchInitialMessageIfPending(dormant, {
      enqueueAuthorized: () => {
        throw new Error('automation run is not active: cancelled');
      },
    }),
    /automation run is not active: cancelled/
  );
  assert.equal(queued.length, queuedBeforeDormantCreate, 'lost authority never starts the child');
});
