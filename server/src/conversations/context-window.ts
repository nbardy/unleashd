/**
 * Resolving the model's real context window — the DENOMINATOR of the context
 * meter.
 *
 * This replaces a hardcoded 200_000, which was the single largest source of
 * error in the meter: Opus 5, Fable 5.1 and Sonnet 5 all carry 1M windows, so a
 * thread reading "220k / 200k" was actually at 22% of its real budget. Only
 * Haiku 4.5 is genuinely a 200K model.
 *
 * Resolution is a sum type rather than a number so the fallback can never be
 * silent: an unknown model id surfaces as `source: 'unknown'` and the UI can
 * say so, instead of quietly asserting a window we did not measure.
 */

export type ContextWindow =
  /** Operator override via UNLEASHD_CONTEXT_BUDGET_TOKENS. Beats everything. */
  | { source: 'operator'; tokens: number }
  /** The harness reported its own window this turn. `codex exec` does. */
  | { source: 'provider'; tokens: number }
  /** Matched a known model. */
  | { source: 'model'; tokens: number; modelId: string }
  /** No match. `tokens` is a floor for display only — treat as a lower bound. */
  | { source: 'unknown'; tokens: number; modelId: string | null };

/**
 * The conservative floor used when nothing identifies the model. Chosen as the
 * smallest window any model we ship reaches, so a meter built on it reads FULL
 * early rather than falsely roomy. It is never silently presented as truth —
 * it only ever arrives tagged `source: 'unknown'`.
 */
export const UNKNOWN_MODEL_WINDOW_FLOOR = 200_000;

const TOKENS_1M = 1_000_000;
const TOKENS_200K = 200_000;

/**
 * Claude model windows keyed by the catalog's ALIAS ids (see
 * shared/src/generated/catalog.ts: CLAUDE_MODEL_IDS). These are the ids a
 * conversation config actually stores.
 *
 * The 1M entries assume the default `claude -p` configuration. The window
 * narrows to 200K on Bedrock/GCP/Foundry, on Opus 4.6 / Sonnet 4.6 without
 * extended context, or when CLAUDE_CODE_DISABLE_1M_CONTEXT=1 is set — none of
 * which we can observe from here. An operator on those paths should set
 * UNLEASHD_CONTEXT_BUDGET_TOKENS, which outranks this table.
 */
const CLAUDE_ALIAS_WINDOWS: Readonly<Record<string, number>> = {
  fable: TOKENS_1M,
  opus: TOKENS_1M,
  sonnet: TOKENS_1M,
  haiku: TOKENS_200K,
};

/**
 * Fallback matcher for the provider-REPORTED model name (e.g.
 * "claude-sonnet-4-5-20250929"), which is what we have when the conversation
 * ran on a provider default and stored no explicit model id. Ordered most to
 * least specific; `haiku` must be tested before the 1M families so a
 * "claude-haiku-*" name cannot be swept up by a looser rule.
 */
const REPORTED_NAME_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/haiku/i, TOKENS_200K],
  [/opus|sonnet|fable/i, TOKENS_1M],
];

export function readOperatorWindowOverride(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.UNLEASHD_CONTEXT_BUDGET_TOKENS;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface ContextWindowInput {
  /** Explicit model id from the conversation config, when one was chosen. */
  modelId?: string | null;
  /** Provider-reported model name, available once a turn has run. */
  reportedModelName?: string | null;
  /**
   * Window the harness reported alongside usage this turn. Present for codex,
   * absent for claude — absent means "resolve it from the model", not "unknown".
   */
  reportedWindow?: number | null;
}

export function resolveContextWindow(
  input: ContextWindowInput,
  env: NodeJS.ProcessEnv = process.env
): ContextWindow {
  const override = readOperatorWindowOverride(env);
  if (override !== null) return { source: 'operator', tokens: override };

  // The harness measured its own window; nothing we infer can beat that.
  if (input.reportedWindow && input.reportedWindow > 0) {
    return { source: 'provider', tokens: input.reportedWindow };
  }

  const modelId = input.modelId ?? null;
  if (modelId) {
    const aliasWindow = CLAUDE_ALIAS_WINDOWS[modelId];
    if (aliasWindow) return { source: 'model', tokens: aliasWindow, modelId };
  }

  const reported = input.reportedModelName ?? null;
  if (reported) {
    for (const [pattern, tokens] of REPORTED_NAME_WINDOWS) {
      if (pattern.test(reported)) return { source: 'model', tokens, modelId: reported };
    }
  }

  return { source: 'unknown', tokens: UNKNOWN_MODEL_WINDOW_FLOOR, modelId: modelId ?? reported };
}
