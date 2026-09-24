import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommand } from '@nbardy/agent-cli';
import {
  CreateConversationCommandSchema,
  ModelIdSchema,
  SetConversationConfigCommandSchema,
  isModelIdValidForProvider,
  normalizeModelId,
} from '../../shared/src/index';
import { sessionToConversation } from '../src/adapters/disk-adapter';
import opencodeProvider from '../src/providers/opencode';

const conversationId = '550e8400-e29b-41d4-a716-446655440000';

test('shared model schemas accept practical OpenCode ids', () => {
  assert.equal(ModelIdSchema.safeParse('opencode/big-pickle').success, true);
  assert.equal(
    CreateConversationCommandSchema.safeParse({
      type: 'create_conversation',
      commandId: 'create-opencode',
      conversationId,
      workingDirectory: '/tmp',
      config: {
        provider: 'opencode',
        model: { mode: 'explicit', modelId: 'opencode/big-pickle' },
        reasoning: { mode: 'default' },
      },
    }).success,
    true
  );
  assert.equal(
    SetConversationConfigCommandSchema.safeParse({
      type: 'set_conversation_config',
      commandId: 'set-opencode-model',
      conversationId,
      expectedRevision: 0,
      patch: {
        kind: 'set_model',
        model: { mode: 'explicit', modelId: 'opencode/big-pickle' },
      },
    }).success,
    true
  );
});

test('shared model wire schema accepts opaque ids and rejects only empty strings', () => {
  assert.equal(ModelIdSchema.safeParse('fable').success, true);
  assert.equal(ModelIdSchema.safeParse('opus').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.6-sol').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.6-terra').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.6-luna').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-6-astra').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.5').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.4').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.4-high').success, true);
  assert.equal(ModelIdSchema.safeParse('openai').success, true);
  assert.equal(ModelIdSchema.safeParse('gpt-5.3-codex-ultra').success, true);
  assert.equal(ModelIdSchema.safeParse('').success, false);
});

test('server provider/model compatibility validation works per provider', () => {
  assert.equal(isModelIdValidForProvider('claude', 'claude-opus-5-5'), true);
  assert.equal(isModelIdValidForProvider('claude', 'opus'), false); // retired 2026-09-23
  assert.equal(isModelIdValidForProvider('claude', 'fable'), true);
  assert.equal(isModelIdValidForProvider('claude', 'opencode/gpt-5'), false);

  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.6-sol'), true);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.6-terra'), true);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.6-luna'), true);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-6-astra'), true);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.5'), true);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.4'), true);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.4-medium'), false);
  assert.equal(isModelIdValidForProvider('codex', 'opencode/gpt-5'), false);

  assert.equal(isModelIdValidForProvider('opencode', 'opencode/gpt-5'), true);
  assert.equal(isModelIdValidForProvider('opencode', 'openai/gpt-5'), true);
  assert.equal(isModelIdValidForProvider('opencode', 'opus'), false);

  assert.equal(isModelIdValidForProvider('cursor', 'composer-2.5'), true);
  assert.equal(isModelIdValidForProvider('cursor', 'composer-2'), true); // alias
  assert.equal(isModelIdValidForProvider('cursor', 'grok-4.5'), true); // alias → high
  assert.equal(isModelIdValidForProvider('cursor', 'cursor-grok-4.5-medium'), true);
  assert.equal(isModelIdValidForProvider('cursor', 'opus'), false);
  assert.equal(normalizeModelId('cursor', 'composer-2'), 'composer-2.5');
  assert.equal(normalizeModelId('cursor', 'grok-4.5'), 'cursor-grok-4.5-high');
  assert.equal(normalizeModelId('cursor', 'grok-4.7'), 'grok-4.7-high');
});

test('disk hydration rejects a globally valid model from the wrong provider', () => {
  const conversation = sessionToConversation({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    filePath: '/tmp/codex-session.jsonl',
    workingDirectory: '/tmp',
    provider: 'codex',
    model: 'opus',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    modifiedAt: new Date('2026-01-01T00:00:00Z'),
    messages: [],
  });

  assert.ok(conversation);
  assert.equal(conversation.model, undefined);
});

test('OpenCode shared CLI builder normalizes model IDs', () => {
  const legacy = buildCommand('opencode', { model: 'openai/gpt-5', prompt: 'hi' });
  const native = buildCommand('opencode', { model: 'opencode/gpt-5', prompt: 'hi' });
  const custom = buildCommand('opencode', { model: 'opencode/big-pickle', prompt: 'hi' });
  const lmLegacy = legacy.argv[legacy.argv.indexOf('-m') + 1];
  const lmNative = native.argv[native.argv.indexOf('-m') + 1];
  const lmCustom = custom.argv[custom.argv.indexOf('-m') + 1];
  assert.equal(lmLegacy, 'opencode/gpt-5');
  assert.equal(lmNative, 'opencode/gpt-5');
  assert.equal(lmCustom, 'opencode/big-pickle');
});

test('OpenCode listModels remains dropdown-friendly with one default', () => {
  const models = opencodeProvider.listModels();
  const defaults = models.filter((m) => m.isDefault);

  assert.equal(
    models.some((m) => m.id === 'opencode/big-pickle'),
    true
  );
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, 'opencode/big-pickle');
});

test('OpenCode shared CLI builder uses --session + --continue only for valid resume IDs', () => {
  const resumeSpec = buildCommand('opencode', {
    sessionId: 'ses_abc123',
    resume: true,
    model: 'opencode/big-pickle',
    prompt: 'continue',
  });
  assert.ok(resumeSpec.argv.includes('--session'));
  assert.ok(resumeSpec.argv.includes('ses_abc123'));
  assert.ok(resumeSpec.argv.includes('--continue'));

  const freshSpec = buildCommand('opencode', {
    sessionId: 'temporary-client-id',
    resume: true,
    model: 'opencode/big-pickle',
    prompt: 'continue',
  });
  assert.ok(!freshSpec.argv.includes('--session'));
  assert.ok(!freshSpec.argv.includes('--continue'));
});
