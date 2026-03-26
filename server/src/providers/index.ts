/**
 * Provider metadata contract and registry.
 *
 * Runtime command execution and stream parsing are delegated to
 * `@nbardy/agent-cli` (`executeCommand`).
 */

import type { ModelInfo, Provider as ProviderName } from '@unleashd/shared';
import claudeProvider from './claude';
import codexProvider from './codex';
import geminiProvider from './gemini';
import opencodeProvider from './opencode';
import piProvider from './pi';
import qwenProvider from './qwen';

/**
 * Unified event types consumed by conversation state handling.
 * These are emitted by `executeCommand` and passed through server logic.
 */
export type ProviderEvent =
  | { type: 'message_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'message_complete'; reason?: 'success' | 'error' | 'out_of_tokens' | 'killed' }
  | { type: 'tool_use'; name: string; input: Record<string, unknown>; displayText?: string }
  | { type: 'error'; message: string };

/**
 * Minimal provider contract used by the server runtime.
 */
export interface Provider {
  name: ProviderName;

  listModels(): ModelInfo[];
}

const providers: Record<ProviderName, Provider> = {
  claude: claudeProvider,
  codex: codexProvider,
  opencode: opencodeProvider,
  gemini: geminiProvider,
  pi: piProvider,
  qwen: qwenProvider,
};

/**
 * Get a provider by name
 * @param name - Provider name ('claude', 'codex', 'opencode', or 'gemini')
 * @throws Error if provider not found
 */
export function getProvider(name: ProviderName): Provider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
}

export { providers };
