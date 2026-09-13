import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

// Models come from the unified catalog loader (./catalog.ts →
// vendor/agent-cli-tool/catalog.jsonc). Fallback list is only for minimal
// test envs without the vendor checkout.
const FALLBACK_OPENCODE_MODELS: ModelInfo[] = [
  { id: 'opencode/big-pickle', displayName: 'OpenCode Big Pickle (Free)', isDefault: true },
  { id: 'opencode/gpt-5-nano', displayName: 'OpenCode GPT-5 Nano (Free)', isDefault: false },
  { id: 'opencode/kimi-k2.5-free', displayName: 'OpenCode Kimi K2.5 Free', isDefault: false },
  {
    id: 'opencode/minimax-m2.5-free',
    displayName: 'OpenCode MiniMax M2.5 Free',
    isDefault: false,
  },
  { id: 'meta/muse-spark-1.1', displayName: 'Muse Spark 1.1 (Meta)', isDefault: false },
  {
    id: 'meta/muse-spark-1.2-contributor',
    displayName: 'Muse Spark 1.2 Contributor (Meta)',
    isDefault: false,
  },
  {
    id: 'meta/muse-spark-1.3-contributor',
    displayName: 'Muse Spark 1.3 Contributor (Meta)',
    isDefault: false,
  },
];

const opencodeProvider: Provider = {
  name: 'opencode',

  listModels(): ModelInfo[] {
    return loadProviderModels('opencode', FALLBACK_OPENCODE_MODELS);
  },
};

export default opencodeProvider;
