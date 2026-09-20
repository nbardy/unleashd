import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyContext, BuddyMessage } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BUDDY_CONTROL_TOKEN_ENV,
  BUDDY_CONTROL_URL_ENV,
  BuddyControlServer,
} from '../src/buddies/control-server';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { BuddyOperationsService } from '../src/buddies/operations';

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await delay(10);
  }
  assert.fail('Expected durable message state was not reached');
}

test('private send waits for its assigned reply, times out durably, and releases waits on disconnect or turn revocation', async () => {
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({
    name: 'Messages',
    rootPath: '/tmp/buddy-message-control',
  });
  const sender = store.createBuddy({ project: workspace.id, name: 'Sender', role: 'Sender' });
  const recipient = store.createBuddy({
    project: workspace.id,
    name: 'Recipient',
    role: 'Recipient',
  });
  const port = store as unknown as BuddiesStorePort;
  const contexts: BuddyContext[] = [];
  const dispatch = createBuddyDispatchService({
    getStore: async () => port,
    createConversation: async (input) => {
      contexts.push(input.context);
      const id = `child-${contexts.length}`;
      return { id, toJSON: () => ({ id }) };
    },
    dispatchInitialMessage: async (_conversation, options) => options.enqueueAuthorized(() => {}),
    abandonConversation: () => {},
    createId: () => 'unused',
  });
  const control = new BuddyControlServer({
    getStore: async () => port,
    isConversationActive: () => true,
    dispatchMessage: dispatch.send,
    dispatchDelegation: dispatch.delegation,
    dispatchReview: dispatch.review,
  });
  await control.start();
  const context: BuddyContext = {
    buddyId: sender.id,
    workspaceId: workspace.id,
    buddyProjectId: null,
    delegatedByBuddyId: null,
    parentBuddyConversationId: null,
    allowedBuddyOperations: ['buddy.send', 'buddy.get_inbox'],
  };
  let environment = control.issue(context, 'sender-turn');
  const send = (body: Record<string, unknown>, signal?: AbortSignal) =>
    fetch(`${environment[BUDDY_CONTROL_URL_ENV]}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${environment[BUDDY_CONTROL_TOKEN_ENV]}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  try {
    const responsePromise = send({
      to: recipient.id,
      purpose: 'independent assessment',
      body: 'Read the design.',
      wait: true,
      timeoutSeconds: 10,
    });
    await until(() =>
      store.listMessages().some((message) => message.child_conversation_id !== null)
    );
    const message = store.listMessages()[0];
    assert.equal(message.wait_status, 'waiting');
    assert.equal(
      contexts[0].buddyId,
      recipient.id,
      'dispatch uses the recipient identity and fresh conversation'
    );
    const replyOperations = new BuddyOperationsService(port, {
      buddyId: recipient.id,
      workspaceId: workspace.id,
      conversationId: message.child_conversation_id!,
      allowedOperations: ['buddy.reply'],
    });
    replyOperations.execute('buddy.reply', {
      messageId: message.id,
      outcome: 'needs one correction',
      body: 'Fix the stale link.',
      evidence: ['file:design.md:12'],
    });
    const response = await responsePromise;
    assert.equal(response.status, 200);
    const result = (await response.json()) as { data: { message: BuddyMessage } };
    assert.equal(result.data.message.wait_status, 'replied');
    assert.equal(result.data.message.outcome, 'needs one correction');

    const timeout = await send({
      to: 'owner',
      purpose: 'permission',
      body: 'Publish?',
      wait: true,
      timeoutSeconds: 1,
    });
    assert.equal(timeout.status, 200);
    const timed = (await timeout.json()) as { data: { message: BuddyMessage } };
    assert.equal(timed.data.message.wait_status, 'timed_out');
    assert.equal(
      timed.data.message.status,
      'pending',
      'timeout keeps owner request available for later reply'
    );

    const disconnected = new AbortController();
    const pending = send(
      {
        to: 'owner',
        purpose: 'disconnected wait',
        body: 'Wait for owner.',
        wait: true,
        timeoutSeconds: 10,
      },
      disconnected.signal
    );
    const rejected = assert.rejects(pending);
    await until(() =>
      store.listMessages().some((candidate) => candidate.purpose === 'disconnected wait')
    );
    disconnected.abort();
    await rejected;
    await until(
      () =>
        store.listMessages().find((candidate) => candidate.purpose === 'disconnected wait')
          ?.wait_status === 'cancelled'
    );

    const revoked = send({
      to: 'owner',
      purpose: 'revoked wait',
      body: 'Wait for owner.',
      wait: true,
      timeoutSeconds: 10,
    });
    await until(() =>
      store.listMessages().some((candidate) => candidate.purpose === 'revoked wait')
    );
    control.revoke('sender-turn');
    assert.equal((await revoked).status, 500);
    assert.equal(
      store.listMessages().find((candidate) => candidate.purpose === 'revoked wait')?.wait_status,
      'cancelled'
    );

    environment = control.issue(
      { ...context, allowedBuddyOperations: ['buddy.get_inbox'] },
      'sender-turn'
    );
    assert.equal(
      (await send({ to: recipient.id, purpose: 'forbidden', body: 'Try dispatch.' })).status,
      500
    );
    assert.equal(
      store.listMessages().some((candidate) => candidate.purpose === 'forbidden'),
      false
    );
  } finally {
    await control.close();
    store.close();
  }
});

test('message dispatch deadlines cover deferred creation and prevent late enqueue after cancellation', async () => {
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({
    name: 'Deferred messages',
    rootPath: '/tmp/buddy-deferred-messages',
  });
  const sender = store.createBuddy({ project: workspace.id, name: 'Sender', role: 'Sender' });
  const recipient = store.createBuddy({
    project: workspace.id,
    name: 'Recipient',
    role: 'Recipient',
  });
  const context: BuddyContext = {
    buddyId: sender.id,
    workspaceId: workspace.id,
    buddyProjectId: null,
  };
  const input = {
    to: recipient.id,
    purpose: 'bounded creation',
    body: 'Read this.',
    evidence: [],
    wait: true,
    timeoutSeconds: 1,
    parentConversationId: 'parent',
  };
  let resolveCreate!: (conversation: { id: string; toJSON(): unknown }) => void;
  let abandoned = 0;
  let enqueued = 0;
  const service = createBuddyDispatchService({
    getStore: async () => store as unknown as BuddiesStorePort,
    createConversation: () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    dispatchInitialMessage: async (_child, options) =>
      options.enqueueAuthorized(() => {
        enqueued += 1;
      }),
    abandonConversation: () => {
      abandoned += 1;
    },
    createId: () => 'unused',
  });
  try {
    await assert.rejects(service.send(context, input), /deadline reached/);
    assert.equal(store.listMessages()[0].status, 'failed');
    resolveCreate({ id: 'late-child', toJSON: () => ({ id: 'late-child' }) });
    await until(() => abandoned === 1);
    assert.equal(enqueued, 0, 'late-created dormant child never starts');

    let authorize!: () => void;
    const controller = new AbortController();
    const delayedDispatch = createBuddyDispatchService({
      getStore: async () => store as unknown as BuddiesStorePort,
      createConversation: async () => ({
        id: 'delayed-child',
        toJSON: () => ({ id: 'delayed-child' }),
      }),
      dispatchInitialMessage: async (_child, options) =>
        new Promise<void>(() => {
          authorize = () =>
            options.enqueueAuthorized(() => {
              enqueued += 1;
            });
        }),
      abandonConversation: () => {
        abandoned += 1;
      },
      createId: () => 'unused',
    });
    const pending = delayedDispatch.send(
      context,
      { ...input, purpose: 'cancelled during enqueue', wait: false, timeoutSeconds: 10 },
      undefined,
      controller.signal
    );
    const rejected = assert.rejects(pending, /cancelled by caller/);
    await until(() => Boolean(authorize));
    controller.abort(new Error('cancelled by caller'));
    await rejected;
    assert.throws(authorize, /cancelled by caller/);
    assert.equal(enqueued, 0, 'late callback cannot enqueue after revocation');
    await until(() => abandoned === 2);

    const noEnqueue = createBuddyDispatchService({
      getStore: async () => store as unknown as BuddiesStorePort,
      createConversation: async () => ({ id: 'no-enqueue', toJSON: () => ({ id: 'no-enqueue' }) }),
      dispatchInitialMessage: async () => {},
      abandonConversation: () => {
        abandoned += 1;
      },
      createId: () => 'unused',
    });
    await assert.rejects(noEnqueue.send(context, { ...input, wait: false }), /authorized start/);
    await until(() => abandoned === 3);
  } finally {
    store.close();
  }
});

test('legacy private dispatch binds the trusted parent and cannot enqueue after capability revocation', async () => {
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({
    name: 'Legacy dispatch',
    rootPath: '/tmp/buddy-legacy-dispatch',
  });
  const sender = store.createBuddy({ project: workspace.id, name: 'Sender', role: 'Sender' });
  const recipient = store.createBuddy({
    project: workspace.id,
    name: 'Recipient',
    role: 'Recipient',
  });
  store.setBuddyRelationship({ fromBuddy: sender.id, toBuddy: recipient.id, kind: 'manager' });
  let resolveCreate!: (child: { id: string; toJSON(): unknown }) => void;
  let enqueued = 0;
  let abandoned = 0;
  const dispatch = createBuddyDispatchService({
    getStore: async () => store as unknown as BuddiesStorePort,
    createConversation: () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    dispatchInitialMessage: async (_child, options) =>
      options.enqueueAuthorized(() => {
        enqueued += 1;
      }),
    abandonConversation: () => {
      abandoned += 1;
    },
    createId: () => 'unused',
  });
  const control = new BuddyControlServer({
    getStore: async () => store as unknown as BuddiesStorePort,
    isConversationActive: () => true,
    dispatchMessage: dispatch.send,
    dispatchDelegation: dispatch.delegation,
    dispatchReview: dispatch.review,
  });
  await control.start();
  const context: BuddyContext = {
    buddyId: sender.id,
    workspaceId: workspace.id,
    buddyProjectId: null,
    allowedBuddyOperations: ['buddy.delegate'],
  };
  const environment = control.issue(context, 'trusted-parent');
  try {
    const request = fetch(`${environment[BUDDY_CONTROL_URL_ENV]}/v1/delegations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${environment[BUDDY_CONTROL_TOKEN_ENV]}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toBuddyId: recipient.id,
        purpose: 'A legacy request',
        parentConversationId: 'spoofed-parent',
      }),
    });
    await until(() => Boolean(resolveCreate));
    assert.equal(store.listMessages()[0].parent_conversation_id, 'trusted-parent');
    control.revoke('trusted-parent');
    const response = await request;
    assert.equal(response.status, 500);
    assert.match(JSON.stringify(await response.json()), /Buddy turn ended/);
    assert.equal(store.listMessages()[0].status, 'failed');
    resolveCreate({ id: 'late-legacy-child', toJSON: () => ({ id: 'late-legacy-child' }) });
    await until(() => abandoned === 1);
    assert.equal(enqueued, 0);
  } finally {
    await control.close();
    store.close();
  }
});
