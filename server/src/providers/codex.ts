import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

const FALLBACK_CODEX_MODELS: ModelInfo[] = [
  { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true },
  { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', isDefault: false },
  { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', isDefault: false },
  { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: false },
  { id: 'gpt-5.4', displayName: 'GPT-5.4', isDefault: false },
  { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', isDefault: false },
  { id: 'gpt-6-astra', displayName: 'GPT-6 Astra', isDefault: false },
  { id: 'gpt-5.3-codex-spark', displayName: 'Codex Spark', isDefault: false },
];

const codexProvider: Provider = {
  name: 'codex',

  listModels(): ModelInfo[] {
    return loadProviderModels('codex', FALLBACK_CODEX_MODELS);
  },
};

export default codexProvider;
