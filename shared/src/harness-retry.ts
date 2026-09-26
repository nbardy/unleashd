// A Buddy reply that failed because of its HARNESS can be rerun on another one (493c1c7). The
// server refuses any other failure; the client shows the retry button only for these.

/** The harness's usage or session limit (the runtime prefixes "Out of tokens:"). */
export function isOutOfTokensFailure(text: string): boolean {
  return /out_of_tokens|out of tokens/i.test(text);
}

/**
 * Out of tokens, or the harness ending the turn with a provider error (Codex rejecting gpt-5.4 on
 * a ChatGPT account reports `reason: error`, not out of tokens). Anything else — a Buddy that is
 * not active, a missing post — is not the harness's fault and stays plain text.
 */
export function isHarnessRetryFailure(text: string): boolean {
  return (
    isOutOfTokensFailure(text) ||
    /completed the turn with reason:\s*error/i.test(text) ||
    /not supported when using/i.test(text)
  );
}
