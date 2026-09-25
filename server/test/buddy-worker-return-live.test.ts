import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executeCommand } from '@nbardy/agent-cli';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyContext } from '@unleashd/shared';
import { chatRunAdmission } from '../src/buddies/chat-run-admission';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { BuddyControlServer } from '../src/buddies/control-server';
import { coordinationStore } from '../src/buddies/coordination-store';
import {
  createBuddyDispatchService,
  createReturnConversationPreparer,
} from '../src/buddies/dispatch-service';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

// Explicit opt-in: real provider turns, temporary workspace/database, no production server.
test(
  'live worker writes artifact and contextual background lead reads and accepts it',
  {
    skip: !['1', 'timeout'].includes(process.env.UNLEASHD_LIVE_WORKER_RETURN ?? ''),
    timeout: 300_000,
  },
  async () => {
    const timeoutMode = process.env.UNLEASHD_LIVE_WORKER_RETURN === 'timeout';
    const root = mkdtempSync(join(tmpdir(), 'buddy-worker-return-live-'));
    const raw = new BuddiesStore(join(root, 'buddies.sqlite'));
    const store = coordinationStore(raw as unknown as BuddiesStorePort);
    const workspace = raw.createWorkspace({ name: 'Isolated return proof', rootPath: root });
    const lead = raw.createBuddy({
      project: workspace.id,
      name: 'Lead',
      role: 'Read returned artifacts and assess the assignment.',
    });
    const worker = raw.createBuddy({
      project: workspace.id,
      name: 'Worker',
      role: 'Save requested artifacts and reply with their paths.',
    });
    for (const buddy of [lead, worker])
      store.setCoordinationMembership(buddy.id, workspace.id, {
        background_enabled: true,
        max_active_runs: 2,
      });
    const conversations = new Map<string, ConversationRuntime>();
    const integration = createBuddiesIntegration({
      getConversation: (id) => conversations.get(id),
      store,
    });
    await integration.getStore();
    let dispatch!: ReturnType<typeof createBuddyDispatchService>;
    const control = new BuddyControlServer({
      getStore: async () => store,
      isConversationActive: (id) => conversations.get(id)?.isRunning === true,
      dispatchMessage: (...args) => dispatch.send(...args),
      dispatchDelegation: async () => {
        throw new Error('unused');
      },
      dispatchReview: async () => {
        throw new Error('unused');
      },
    });
    await control.start();
    let current!: { context: BuddyContext; conversationId: string };
    const evidence: Array<{
      conversationId: string;
      inputKind: string;
      prompt: string;
      events: unknown[];
    }> = [];
    const configStore = new ConversationConfigStore({ appDataRoot: root });
    const configService = new ConversationConfigService({
      store: configStore,
      resolver: { resolve: async (value) => resolveConfigAgainstProviderCatalog(value) },
    });
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
      getConversation: (id) => conversations.get(id),
      readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
      createSessionId: randomUUID,
      readCurrentBuddyContext: integration.readCurrentConversation,
      ...chatRunAdmission(
        () => store,
        () => MESSAGE_BUDDY_OPERATIONS
      ),
      finishBuddyChatRun: (id, token, status, detail) => {
        store.finishBuddyRun(id, { claimToken: token, status, outcome: detail });
      },
      issueBuddyControlCapability: (context, conversationId, token) => {
        current = { context, conversationId };
        return control.issue(context, conversationId, token);
      },
      revokeBuddyControlCapability: (id) => control.revoke(id),
      executeTurn: ((request) => {
        const run = store.getBuddyRun(current.context.coordinationRunId!)!;
        const entry = {
          conversationId: current.conversationId,
          inputKind: run.input_kind,
          prompt: String(request.prompt),
          events: [] as unknown[],
        };
        evidence.push(entry);
        const mcpServers = Object.fromEntries(
          Object.entries(request.mcpServers ?? {}).map(([name, spec]) => [
            name,
            { ...spec, env: { ...spec.env, BUDDIES_HOME: root } },
          ])
        );
        const turn = executeCommand({ ...request, cwd: root, mcpServers });
        const timer = setTimeout(() => turn.stop(), 100_000);
        async function* events() {
          for await (const event of turn.events) {
            entry.events.push(event);
            yield event;
          }
        }
        return {
          ...turn,
          events: events(),
          completed: turn.completed.finally(() => clearTimeout(timer)),
        };
      }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
    });
    const creation = createBuddyCreationService({
      configService,
      getConversation: (id) => conversations.get(id),
      resolveBuddyConversation: async (context) => ({
        ...(await integration.resolveConversation(context)),
        provider: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
      }),
      resolveWorkingDirectory: (directory) => directory,
      isProviderAvailable: () => true,
      createId: randomUUID,
      createConversation: (options) => new Conversation(options),
      registerConversation: (conversation) => {
        conversations.set(conversation.id, conversation);
      },
      createConversationLink: async (conversation) => {
        raw.linkConversation({
          buddy: conversation.buddyContext!.buddyId,
          workspace: workspace.id,
          provider: 'codex',
          unleashdConversationId: conversation.id,
        });
      },
      updateConversationStatus: () => {},
      broadcast: () => {},
    });
    const owner = await creation.createServerBuddyConversation({
      context: { buddyId: lead.id, workspaceId: workspace.id },
      conversationId: 'human',
      commandId: 'human',
      deferInitialMessage: true,
    });
    dispatch = createBuddyDispatchService({
      getStore: async () => store,
      prepareReturnConversation: createReturnConversationPreparer({
        getConversation: (id) => conversations.get(id),
        configService,
        createConversation: creation.createServerBuddyConversation,
      }),
      createConversation: creation.createServerBuddyConversation,
      dispatchInitialMessage: async () => {
        throw new Error('durable messages only');
      },
      abandonConversation: () => {},
      createId: randomUUID,
    });
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => conversations.get(id),
      getConversationRecord: (id) => configService.getRecord(id),
      createConversation: creation.createServerBuddyConversation,
      ensureConversationReady: creation.ensureConversationReady,
    });
    let ticker: ReturnType<typeof setInterval> | undefined;
    try {
      // The secret exists only on disk. Acceptance must demonstrate a real artifact read.
      const secret = randomUUID();
      writeFileSync(join(root, 'source.txt'), `${secret}\n`);
      owner.sendMessage(
        `This is an isolated integration test. Use native send to Worker ${worker.id}, key artifact-proof, expectsReply true, wait false, purpose artifact proof. Assignment body: copy source.txt byte-for-byte to artifact.txt using cp source.txt artifact.txt, ${timeoutMode ? 'then run sleep 40 before replying so this fixture can interrupt execution after the file is saved;' : ''} then reply done with evidence artifact.txt. Do not include file contents in the reply. Only one worker turn is needed. After dispatch, finish your foreground turn. When the worker return arrives in your separate background review, read artifact.txt yourself and write acceptance.txt containing ACCEPTED followed by its exact contents if it matches source.txt. Do not read files or write acceptance before the worker returns.`,
        { origin: 'owner_input', inputId: 'launch' }
      );
      let interrupted = false;
      ticker = setInterval(() => {
        executor.poll();
        if (timeoutMode && !interrupted && existsSync(join(root, 'artifact.txt'))) {
          const activeWorker = [...conversations.values()].find(
            (conversation) =>
              conversation.buddyContext?.buddyId === worker.id && conversation.isRunning
          );
          if (activeWorker) {
            interrupted = true;
            activeWorker.expireCoordinationRun();
          }
        }
      }, 100);
      await owner.waitForTurnDrain();
      assert.ok(
        [...conversations.values()].some(
          (conversation) => conversation.id !== owner.id && conversation.hasActiveProcess()
        ),
        'worker executes independently of foreground completion'
      );
      owner.sendMessage(
        'Reply briefly that this human conversation remains available. Do not call tools or change files.',
        { origin: 'owner_input', inputId: 'availability' }
      );
      await owner.waitForTurnDrain();
      const sourceMessages = owner.messages.length;
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline && !existsSync(join(root, 'acceptance.txt')))
        await new Promise((resolve) => setTimeout(resolve, 100));
      await Promise.all(
        [...conversations.values()].map((conversation) => conversation.waitForTurnDrain())
      );
      assert.equal(
        readFileSync(join(root, 'artifact.txt'), 'utf8'),
        readFileSync(join(root, 'source.txt'), 'utf8')
      );
      assert.match(
        readFileSync(join(root, 'acceptance.txt'), 'utf8'),
        new RegExp(`ACCEPTED\\s*${secret}`)
      );
      assert.equal(
        owner.messages.length,
        sourceMessages,
        'review never appends to the human conversation'
      );
      assert.ok(
        evidence.some(
          (turn) =>
            turn.conversationId.startsWith('buddy-return-') &&
            ['message_reply', 'failure_notice'].includes(turn.inputKind)
        )
      );
      const review = evidence.find((turn) => turn.conversationId.startsWith('buddy-return-'))!;
      assert.ok(
        review.events.some((event) => {
          const tool = event as { type?: string; input?: unknown };
          return tool.type === 'tool.use' && JSON.stringify(tool.input).includes('artifact.txt');
        }),
        'provider trace records artifact access'
      );
      const messages = store.listBuddyRuns({ limit: 100 });
      const delivery = messages.find((run) =>
        ['message_reply', 'failure_notice'].includes(run.input_kind)
      )!;
      assert.equal(delivery.status, 'complete');
      const request = store.getMessage(
        delivery.input_kind === 'failure_notice'
          ? store.getBuddyRun(delivery.input_id!)!.input_id!
          : delivery.input_id!
      )!;
      if (timeoutMode) {
        assert.ok(messages.some((run) => run.error_code === 'max_runtime_timeout'));
        assert.ok(
          messages.some(
            (run) => run.policy.interruption_report_of_run_id && run.status === 'complete'
          )
        );
      }
      assert.equal(request.parent_conversation_id, 'human');
      assert.ok(delivery.conversation_id?.startsWith('buddy-return-'));

      console.log(
        JSON.stringify({
          verified: true,
          timeoutMode,
          provider: 'codex',
          model: 'gpt-5.6-sol',
          messageId: request.id,
          workerArtifact: true,
          leadReadAndAccepted: true,
          humanAvailable: true,
          turns: evidence.map(({ conversationId, inputKind }) => ({ conversationId, inputKind })),
        })
      );
    } finally {
      if (ticker) clearInterval(ticker);
      executor.stop();
      for (const conversation of conversations.values())
        if (conversation.isRunning) conversation.stop();
      await Promise.all(
        [...conversations.values()].map((conversation) => conversation.waitForTurnDrain())
      );
      const evidencePath = process.env.UNLEASHD_LIVE_EVIDENCE_PATH;
      if (evidencePath)
        writeFileSync(
          evidencePath,
          JSON.stringify(
            {
              root,
              evidence,
              runs: store.listBuddyRuns({ limit: 100 }),
              artifacts: Object.fromEntries(
                ['source.txt', 'artifact.txt', 'acceptance.txt']
                  .filter((name) => existsSync(join(root, name)))
                  .map((name) => {
                    const bytes = readFileSync(join(root, name));
                    return [
                      name,
                      {
                        bytes: bytes.length,
                        sha256: createHash('sha256').update(bytes).digest('hex'),
                      },
                    ];
                  })
              ),
            },
            (key, value) => (key === 'claim_token' ? undefined : value),
            2
          )
        );
      await control.close();
      raw.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
