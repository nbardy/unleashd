import {
  type BuddyAssignmentConfig,
  type ConversationConfig,
  type ResolvedExecutionConfig,
} from '@unleashd/shared';
import type { ConversationConfigService } from '../conversations/config-service';
import { assertBuddyProviderSupportsMcp } from './provider-capability';

export function assertAssignmentConfigMatches(
  expected: ResolvedExecutionConfig,
  actual: ResolvedExecutionConfig
) {
  if (
    expected.provider !== actual.provider ||
    expected.modelId !== actual.modelId ||
    expected.reasoningEffort !== actual.reasoningEffort
  )
    throw Object.assign(
      new Error(
        'Assignment configuration conflicts with the destination conversation. Send a new request without continueFrom to use a separate configuration.'
      ),
      { code: 'assignment_config_conflict', details: { requested: expected, actual } }
    );
}

/** Resolve after exact route validation, using the ordinary conversation authority. */
export async function resolveBuddyAssignmentConfig(
  service: Pick<ConversationConfigService, 'resolve' | 'getRecord'>,
  config: ConversationConfig,
  conversationId?: string | null
): Promise<BuddyAssignmentConfig> {
  assertBuddyProviderSupportsMcp(config.provider);
  const resolution = await service.resolve(config);
  if (resolution.status !== 'resolved')
    throw Object.assign(new Error(resolution.error.message), {
      code: resolution.error.code,
      details: resolution.error,
    });
  if (conversationId) {
    const record = await service.getRecord(conversationId);
    if (!record || record.status === 'deleted')
      throw Object.assign(
        new Error('Continuation configuration is unavailable; inspect the original request.'),
        {
          code: 'assignment_config_unavailable',
        }
      );
    const current = await service.resolve(record.config);
    if (current.status !== 'resolved')
      throw Object.assign(new Error(current.error.message), { code: current.error.code });
    assertAssignmentConfigMatches(resolution.value, current.value);
  }
  return {
    requested: config,
    resolved: resolution.value,
    catalogRevision: resolution.catalogRevision,
    source: conversationId ? 'continued_conversation' : 'assignment',
  };
}

/** Pin defaults at send time; later profile/catalog defaults cannot change this request. */
export function pinnedAssignmentConfig(selection: BuddyAssignmentConfig): ConversationConfig {
  return {
    provider: selection.resolved.provider,
    model: { mode: 'explicit', modelId: selection.resolved.modelId },
    reasoning:
      selection.resolved.reasoningEffort === undefined
        ? { mode: 'disabled' }
        : { mode: 'explicit', effort: selection.resolved.reasoningEffort },
  };
}
