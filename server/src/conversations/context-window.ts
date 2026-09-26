// The context meter's denominator. A sum type so the fallback is never silent: an unknown model
// is `source: 'unknown'` (docs/context-meter.md#window; replaced a hardcoded 200_000).

export type ContextWindow =
  /** Operator override via UNLEASHD_CONTEXT_BUDGET_TOKENS. Beats everything. */
  | { source: 'operator'; tokens: number }
  /** The harness reported its own window this turn. `codex exec` does. */
  | { source: 'provider'; tokens: number }
  /** Matched a known model. */
  | { source: 'model'; tokens: number; modelId: string }
  /** No match. `tokens` is a floor for display only — treat as a lower bound. */
  | { source: 'unknown'; tokens: number; modelId: string | null };

/** The smallest window we ship: the meter reads full early, never falsely roomy. */
export const UNKNOWN_MODEL_WINDOW_FLOOR = 200_000;

const TOKENS_1M = 1_000_000;
const TOKENS_200K = 200_000;

// Keyed by the catalog alias ids a config stores; 1M assumes default `claude -p`
// (docs/context-meter.md#window for when it narrows).
const CLAUDE_ALIAS_WINDOWS: Readonly<Record<string, number>> = {
  fable: TOKENS_1M,
  // Retired 2026-09-23; kept so stored `opus` configs still resolve.
  opus: TOKENS_1M,
  'claude-opus-5-5': TOKENS_1M,
  sonnet: TOKENS_1M,
  haiku: TOKENS_200K,
};

// The provider-reported name when no model id was stored; haiku must match first.
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
  /** The harness's own window (codex); absent means resolve from the model. */
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
