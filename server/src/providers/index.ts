/**
 * Provider metadata contract and registry.
 *
 * Runtime command execution and stream parsing are delegated to
 * `@nbardy/agent-cli` (`executeCommand`).
 */

import type { ModelInfo, Provider as ProviderName } from '@unleashd/shared';
import claudeProvider from './claude';
import codexProvider from './codex';
import cursorProvider from './cursor';
import geminiProvider from './gemini';
import museProvider from './muse';
import opencodeProvider from './opencode';

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
  cursor: cursorProvider,
  muse: museProvider,
};

/**
 * Get a provider by name
 * @param name - Provider name ('claude', 'codex', 'opencode', 'gemini', or 'cursor')
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
