/** A failure whose text is the harness usage or session limit. */
export function isOutOfTokensFailure(text: string): boolean {
  return /out_of_tokens|out of tokens|ran out of tokens/i.test(text);
}

/**
 * A failed reply the owner can rerun on another harness: the seat ran out of
 * tokens, or the harness finished with a provider error (Codex rejecting
 * gpt-5.4 on a ChatGPT account is reported as `reason: error`, not
 * `out_of_tokens`). Other failures stay plain text.
 */
export function isHarnessRetryFailure(text: string): boolean {
  return (
    isOutOfTokensFailure(text) ||
    /completed the turn with reason:\s*error/i.test(text) ||
    /not supported when using/i.test(text)
  );
}

/** Stamped on a channel failure so a retry can find the post it was answering. */
export const RETRY_TRIGGER_EVIDENCE_PREFIX = 'trigger:';

/** Stamped on a channel failure so the picker can hide the harness that failed. */
export const RETRY_PROVIDER_EVIDENCE_PREFIX = 'provider:';

export function evidenceField(evidence: readonly string[], prefix: string): string | null {
  const hit = evidence.find((item) => item.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}
