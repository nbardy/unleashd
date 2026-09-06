import {
  type ConversationConfig,
  type Provider,
  fromCodexModelId,
  isEffortValidForProvider,
  isModelIdValidForProvider,
  normalizeModelId,
} from '@unleashd/shared';
import type { ConfigProvenance } from './config-store';

export interface LegacyConfigEvidence {
  provider: Provider;
  /** Provider-reported model, or `unknown` when the native session has none. */
  reportedModel?: string | null;
  /** A legacy flattened effort field, when the application previously stored one. */
  reasoningEffort?: string | null;
  /** Native sessions discovered without an application record use external provenance. */
  source?: 'legacy_application' | 'external_session';
}

export interface LegacyConfigDiagnostic {
  code: 'unknown_reported_model' | 'invalid_legacy_effort';
  message: string;
  reportedModel?: string;
  reasoningEffort?: string;
}

export interface LegacyConfigMigration {
  config: ConversationConfig;
  provenance: ConfigProvenance;
  diagnostics: LegacyConfigDiagnostic[];
}

/**
 * The only application boundary that decodes historical Codex composite IDs.
 * Runtime/CLI code must receive model and reasoning as independent opaque values.
 */
export function migrateLegacyConversationConfig(
  evidence: LegacyConfigEvidence
): LegacyConfigMigration {
  const diagnostics: LegacyConfigDiagnostic[] = [];
  const reportedModel = normalizeLegacyValue(evidence.reportedModel);
  const flattenedEffort = normalizeLegacyValue(evidence.reasoningEffort);

  let modelId = reportedModel;
  let compositeEffort: string | undefined;
  if (evidence.provider === 'codex' && reportedModel) {
    const decoded = fromCodexModelId(reportedModel);
    // fromCodexModelId is deliberately consulted only here. Requiring a known
    // provider/model pair prevents a future base ID ending in "-ultra" from
    // being silently decomposed by runtime code.
    if (decoded.effort && isModelIdValidForProvider('codex', decoded.baseModel)) {
      modelId = decoded.baseModel;
      compositeEffort = decoded.effort;
    }
  }

  // Claude reports this versioned name for the catalog's Fable alias.
  // Recover it only from session evidence; explicit stored selections stay unchanged.
  if (evidence.provider === 'claude' && modelId === 'claude-fable-5-1') {
    modelId = 'fable';
  }

  // Collapse provider aliases (e.g. composer-2 → composer-2.5) before validation
  // so historical session labels land on the current catalog id.
  if (modelId) {
    modelId = normalizeModelId(evidence.provider, modelId) ?? modelId;
  }

  const modelValid = modelId !== undefined && isModelIdValidForProvider(evidence.provider, modelId);
  if (reportedModel && !modelValid) {
    diagnostics.push({
      code: 'unknown_reported_model',
      message: `Could not map reported ${evidence.provider} model "${reportedModel}" to a current catalog model`,
      reportedModel,
    });
  }

  const reasoningEffort = flattenedEffort ?? compositeEffort;
  const reasoningValid =
    reasoningEffort !== undefined && isLegacyEffortValid(evidence.provider, reasoningEffort);
  if (reasoningEffort && !reasoningValid) {
    diagnostics.push({
      code: 'invalid_legacy_effort',
      message: `Ignoring unavailable legacy ${evidence.provider} reasoning effort "${reasoningEffort}"`,
      reasoningEffort,
    });
  }

  const model =
    modelValid && modelId ? { mode: 'explicit' as const, modelId } : { mode: 'default' as const };
  const reasoning =
    reasoningValid && reasoningEffort
      ? { mode: 'explicit' as const, effort: reasoningEffort }
      : { mode: 'disabled' as const };

  return {
    config: {
      provider: evidence.provider,
      model,
      // Missing/unknown effort maps to disabled. Applying today's default would
      // silently change the command used to resume a historical session.
      reasoning,
    },
    provenance: evidence.source === 'external_session' ? 'external_discovered' : 'legacy_inferred',
    diagnostics,
  };
}

function normalizeLegacyValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isLegacyEffortValid(provider: Provider, effort: string): boolean {
  return isEffortValidForProvider(provider, effort);
}
