import {
  type ConversationConfig,
  type ModelId,
  type Provider,
  createDefaultConversationConfig,
  normalizeModelId,
} from '@unleashd/shared';

export function configFromProviderPreferences(input: {
  provider: Provider;
  model?: ModelId;
  reasoningEffort?: string | null;
}): ConversationConfig {
  const normalizedModel = normalizeModelId(input.provider, input.model);
  return {
    ...createDefaultConversationConfig(input.provider),
    model:
      normalizedModel === undefined
        ? { mode: 'default' }
        : { mode: 'explicit', modelId: normalizedModel },
    reasoning:
      input.reasoningEffort === null
        ? { mode: 'disabled' }
        : input.reasoningEffort !== undefined
          ? { mode: 'explicit', effort: input.reasoningEffort }
          : { mode: 'default' },
  };
}

/**
 * A Buddy profile row's execution preferences. A blank provider is Codex, the
 * Buddies default. Turn creation (integration.ts) and the channel member list
 * both read it here, so what the @mention chip shows is what the turn runs.
 */
export function buddyExecutionPreferences(buddy: {
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
}): { provider: Provider; model: ModelId | undefined; reasoningEffort: string | undefined } {
  return {
    provider: (buddy.provider || 'codex') as Provider,
    model: buddy.model || undefined,
    reasoningEffort: buddy.reasoning_effort || undefined,
  };
}
