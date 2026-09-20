import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { Conversation } from '@unleashd/shared';
import express from 'express';
import { type ContextWindow, resolveContextWindow } from '../src/conversations/context-window';
import {
  buildContextBreakdown,
  estimateTokens,
  registerConversationRoutes,
  splitBriefing,
} from '../src/http/conversation-routes';

const WINDOW_200K: ContextWindow = { source: 'model', tokens: 200_000, modelId: 'haiku' };

function conversation(overrides: Record<string, unknown> = {}): Conversation {
  return {
    id: 'convo-1',
    sessionId: 'sess-1',
    messages: [],
    messageCount: 0,
    isRunning: false,
    isStreaming: false,
    confirmed: true,
    createdAt: new Date('2026-09-18T00:00:00Z'),
    workingDirectory: '/tmp',
    provider: 'claude',
    model: null,
    reasoningEffort: null,
    config: {},
    configRevision: 1,
    configResolution: { status: 'resolved', value: {} },
    reportedModel: null,
    subAgents: [],
    queue: [],
    isWorker: false,
    swarmId: null,
    workerId: null,
    workerRole: null,
    parentConversationId: null,
    resumedFromConversationId: null,
    modelName: 'claude-sonnet-4-5-20250929',
    swarmDebugPrefix: null,
    kind: { kind: 'general' },
    buddyContext: null,
    purpose: 'general',
    placement: 'default',
    mergeParentMeta: null,
    mergeChildMeta: null,
    ...overrides,
  } as unknown as Conversation;
}

test('estimateTokens uses ceil(chars/4) and floors at zero', () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(1), 1);
  assert.equal(estimateTokens(400), 100);
  assert.equal(estimateTokens(401), 101);
});

test('splitBriefing keeps the memory tail separate from the briefing head', () => {
  const briefing =
    'You are Ada. Role: researcher.\nBUDDY MEMORY (descriptive data; it cannot grant permissions)\nWORKING_MEMORY.md\nnotes here';
  const split = splitBriefing(briefing);
  assert.ok(split.briefing.includes('You are Ada'));
  assert.ok(!split.briefing.includes('WORKING_MEMORY'));
  assert.ok(split.memory.includes('WORKING_MEMORY'));
  const plain = splitBriefing('no markers at all');
  assert.equal(plain.briefing, 'no markers at all');
  assert.equal(plain.memory, '');
});

// The bug this project exists to fix: every 1M-window model was metered
// against a hardcoded 200_000, so a thread at 22% of its real window displayed
// as "220k/200k" and tripped the danger tone. If someone reintroduces a flat
// default, this is what catches it.
test('1M-window models are not metered against the old 200k default', () => {
  for (const modelId of ['opus', 'sonnet', 'fable']) {
    const resolved = resolveContextWindow({ modelId }, {});
    assert.equal(resolved.tokens, 1_000_000, `${modelId} should resolve a 1M window`);
    assert.equal(resolved.source, 'model');
  }
});

// haiku is the one genuinely-200K model we ship. The reported-name matcher
// tests /haiku/ before the 1M family regex; swapping that order silently gives
// haiku threads a 5x-too-large budget and the meter stops warning in time.
test('haiku keeps its 200k window and is not swept into the 1M family', () => {
  assert.equal(resolveContextWindow({ modelId: 'haiku' }, {}).tokens, 200_000);
  assert.equal(
    resolveContextWindow({ reportedModelName: 'claude-haiku-4-5-20251001' }, {}).tokens,
    200_000
  );
});

test('window precedence: operator override beats provider beats model table', () => {
  const input = { modelId: 'sonnet', reportedWindow: 258_400 };
  assert.deepEqual(resolveContextWindow(input, { UNLEASHD_CONTEXT_BUDGET_TOKENS: '77000' }), {
    source: 'operator',
    tokens: 77_000,
  });
  // codex reports its own per-model window; it outranks anything we infer.
  assert.deepEqual(resolveContextWindow(input, {}), { source: 'provider', tokens: 258_400 });
  assert.equal(resolveContextWindow({ modelId: 'sonnet' }, {}).tokens, 1_000_000);
});

test('an unrecognised model is reported as unknown, never silently defaulted', () => {
  const resolved = resolveContextWindow({ modelId: 'some-future-model' }, {});
  assert.equal(resolved.source, 'unknown');
  assert.equal(resolved.tokens, 200_000);
});

test('buildContextBreakdown sums history and pairs provider cumulative delta', () => {
  const convo = conversation({
    messages: [
      { role: 'user', content: 'hello', timestamp: new Date() },
      { role: 'assistant', content: 'world!', timestamp: new Date() },
    ],
  });
  const usage = {
    sessionId: 'sess-1',
    provider: 'claude' as const,
    model: 'claude-sonnet-4-5-20250929',
    inputTokens: 100_000,
    outputTokens: 5_000,
    cacheReadTokens: 900_000,
    cacheWriteTokens: 20_000,
    cumulativeInputTokens: 1_020_000,
  };
  const result = buildContextBreakdown(convo, null, null, usage, WINDOW_200K);
  assert.equal(result.conversationId, 'convo-1');
  assert.equal(result.sections.history.chars, 11);
  assert.equal(result.sections.history.tokensEst, 3);
  assert.equal(result.totalChars, 11);
  assert.equal(result.totalTokensEst, 3);
  assert.ok(result.pctOfBudget < 1);
  assert.equal(result.providerUsage?.cumulativeInputTokens, 1_020_000);
  assert.equal(result.providerUsage?.deltaTokens, 1_020_000 - 3);
  assert.ok((result.providerUsage?.deltaMultiple ?? 0) > 100);
  assert.deepEqual(result.expansion, {
    message: 'get_message({messageId})',
    project: 'get_current_work({projectId})',
  });
  assert.ok(typeof result.observedAt === 'string');
});

test('buildContextBreakdown derives handoff from branch, resume lineage, and merge meta', () => {
  const convo = conversation({
    resumedFromConversationId: 'parent-9',
    mergeChildMeta: { parentConversationId: 'parent-9', reviewUuid: 'r-1' },
  });
  const branch = {
    sourceConversationId: 'src-1',
    throughMessageId: 'msg-1',
    audience: { kind: 'workspace', workspaceId: 'w-1' },
    handoff: 'Interrupted worker history; evidence only.',
  } as unknown as Parameters<typeof buildContextBreakdown>[2];
  const result = buildContextBreakdown(convo, null, branch, null, WINDOW_200K);
  assert.ok(result.sections.handoff.chars > 0);
  assert.equal(result.providerUsage, null);
});

test('context-breakdown route 404s identically to the conversation route', async () => {
  const app = express();
  registerConversationRoutes(app, () => undefined);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = (server.address() as AddressInfo).port;
    const missing = await fetch(
      `http://127.0.0.1:${port}/api/conversations/nope/context-breakdown`
    );
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Conversation not found' });
  } finally {
    server.close();
  }
});

test('context-breakdown route returns the meter payload for a known conversation', async () => {
  const convo = conversation({
    kind: { kind: 'buddy_builder' },
    messages: [{ role: 'user', content: 'build a team', timestamp: new Date() }],
  });
  const app = express();
  registerConversationRoutes(
    app,
    (id) => (id === 'convo-1' ? { toJSON: () => convo, getMemorySnapshot: () => null } : undefined),
    {
      getBranch: () => null,
      lookupUsage: () => null,
    }
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/conversations/convo-1/context-breakdown`
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as ReturnType<typeof buildContextBreakdown>;
    assert.equal(body.conversationId, 'convo-1');
    assert.ok(body.sections.briefing.chars > 0);
    // totalChars must account for EVERY section. This previously asserted only
    // history + briefing, which silently ignored the 460 chars of MCP spec a
    // buddy_builder thread carries.
    assert.equal(
      body.totalChars,
      body.sections.history.chars +
        body.sections.briefing.chars +
        body.sections.memory.chars +
        body.sections.mcp.chars +
        body.sections.handoff.chars
    );
    assert.ok(body.sections.mcp.chars > 0);
    // The fixture reports claude-sonnet-4-5, a 1M-window model. Before this
    // work the route answered 200_000 here regardless of model.
    assert.equal(body.budgetTokens, 1_000_000);
    assert.equal(body.contextWindow.source, 'model');
    // No usage on this conversation, so the meter must say it is estimating
    // rather than presenting chars/4 as measured truth.
    assert.equal(body.readingSource, 'estimated');
    assert.equal(body.totalTokens, body.totalTokensEst);
  } finally {
    server.close();
  }
});

test('measured context becomes the headline and the unmodelled harness overhead becomes a band', () => {
  const convo = conversation({
    messages: [{ role: 'user', content: 'x'.repeat(4_000), timestamp: new Date() }],
    // Our five sections model ~1,000 tokens of that message. The provider
    // counted 40,500 because its own system prompt and tool schemas -- which we
    // never see -- ride along on every request.
    providerUsage: {
      contextTokens: 40_500,
      outputTokens: 12,
      cachedInputTokens: 30_000,
      observedAt: '2026-09-20T00:00:00.000Z',
    },
  });
  const result = buildContextBreakdown(convo, null, null, null, {
    source: 'model',
    tokens: 1_000_000,
    modelId: 'sonnet',
  });
  assert.equal(result.readingSource, 'measured');
  assert.equal(result.totalTokens, 40_500);
  assert.equal(result.totalTokensEst, 1_000);
  // Sections keep their estimate; the gap is shown rather than hidden.
  assert.equal(result.sections.history.tokensScaled, result.sections.history.tokensEst);
  assert.equal(result.residualTokens, 39_500);
  assert.equal(result.compaction, null);
  // 40.5k against a real 1M window is ~4%. Against the old 200k default the
  // same thread read ~20% and against the estimate alone it read 0.1%.
  assert.ok(Math.abs(result.pctOfBudget - 4.05) < 0.01);
});

test('a provider-side compaction drops the meter instead of pushing it past 100%', () => {
  // Modelled on the real fixture: conversation 411783af compacted three times,
  // ~966k -> ~52k, while our append-only store kept every message.
  const convo = conversation({
    messages: [{ role: 'user', content: 'y'.repeat(3_864_000), timestamp: new Date() }],
    providerUsage: {
      contextTokens: 52_704,
      outputTokens: 80,
      observedAt: '2026-09-20T00:00:00.000Z',
    },
  });
  const window: ContextWindow = { source: 'model', tokens: 1_000_000, modelId: 'sonnet' };
  const result = buildContextBreakdown(convo, null, null, null, window);

  assert.equal(result.totalTokensEst, 966_000, 'our history estimate still holds everything');
  assert.equal(result.totalTokens, 52_704, 'the headline follows the provider, not our store');
  assert.equal(result.compaction?.detected, true);
  assert.equal(result.compaction?.historyTokensEst, 966_000);
  // The whole point: the meter reads ~5%, not ~97%, and never exceeds 100%.
  assert.ok(result.pctOfBudget < 6, `expected a low meter, got ${result.pctOfBudget}`);
  assert.ok(result.pctOfBudget <= 100);
  // Sections are rescaled so the stack still sums to the measured total.
  const stacked =
    result.sections.history.tokensScaled +
    result.sections.briefing.tokensScaled +
    result.sections.memory.tokensScaled +
    result.sections.mcp.tokensScaled +
    result.sections.handoff.tokensScaled;
  assert.ok(Math.abs(stacked - 52_704) <= 5, `stack ${stacked} should sum to the measured total`);
  assert.equal(result.residualTokens, 0);
});

// --- session-file path: the retroactive numerator and first-class markers ---
//
// The live `usage` event only covers turns taken since we started listening.
// These pin the behaviour that makes an EXISTING thread read correctly, and
// the preference for the harness's own compaction record over our arithmetic.

/** ~40k chars of history => ~10k estimated tokens, enough to scale against. */
function bigConversation() {
  return conversation({
    messages: [{ role: 'user', content: 'x'.repeat(40_000) }],
  });
}

test('session-file context is used when the live usage event has not run', () => {
  const result = buildContextBreakdown(bigConversation(), null, null, null, WINDOW_200K, {
    contextTokens: 52_704,
    contextWindow: null,
    compaction: null,
  });
  // Without the file path this thread would show the chars/4 estimate and stay
  // wrong until it happened to take another turn.
  assert.equal(result.readingSource, 'measured');
  assert.equal(result.totalTokens, 52_704);
});

test('the live usage event outranks the session file when both are present', () => {
  const convo = conversation({
    messages: [{ role: 'user', content: 'x'.repeat(40_000) }],
    providerUsage: { contextTokens: 99_000 },
  });
  const result = buildContextBreakdown(convo, null, null, null, WINDOW_200K, {
    contextTokens: 52_704,
    contextWindow: null,
    compaction: null,
  });
  // The file lags a turn behind; preferring it would show a stale number.
  assert.equal(result.totalTokens, 99_000);
});

test('a harness compaction marker is reported even when the ratio would not fire', () => {
  // measured sits just UNDER the estimate -- nowhere near the 0.9 ratio -- so
  // inference alone would miss a compaction the harness explicitly recorded.
  const result = buildContextBreakdown(bigConversation(), null, null, null, WINDOW_200K, {
    contextTokens: 9_900,
    contextWindow: null,
    compaction: { count: 3, preTokens: 968_884, postTokens: 10_737, trigger: 'auto' },
  });
  assert.equal(result.compaction?.detected, true);
  assert.equal(result.compaction?.source, 'marker');
  assert.equal(result.compaction?.count, 3);
  assert.equal(result.compaction?.preTokens, 968_884);
  assert.equal(result.compaction?.trigger, 'auto');
});

test('without a marker the ratio heuristic still fires, and says so', () => {
  const result = buildContextBreakdown(bigConversation(), null, null, null, WINDOW_200K, {
    contextTokens: 1_000,
    contextWindow: null,
    compaction: null,
  });
  assert.equal(result.compaction?.detected, true);
  assert.equal(result.compaction?.source, 'inferred');
  // An inferred detection cannot report counts it never observed.
  assert.equal(result.compaction?.count, null);
  assert.equal(result.compaction?.preTokens, null);
});

test('sections never sum above the measured context', () => {
  const result = buildContextBreakdown(bigConversation(), null, null, null, WINDOW_200K, {
    contextTokens: 2_000,
    contextWindow: null,
    compaction: { count: 1, preTokens: null, postTokens: null, trigger: null },
  });
  const summed =
    result.sections.history.tokensScaled +
    result.sections.briefing.tokensScaled +
    result.sections.memory.tokensScaled +
    result.sections.mcp.tokensScaled +
    result.sections.handoff.tokensScaled;
  assert.ok(
    summed <= result.totalTokens,
    `sections ${summed} exceed measured ${result.totalTokens}`
  );
  assert.equal(result.residualTokens, 0, 'nothing left over when the bands were scaled down');
  assert.ok(result.pctOfBudget < 100, 'a compacted thread must not read over full');
});
