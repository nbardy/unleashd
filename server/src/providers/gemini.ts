import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

const FALLBACK_GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview', isDefault: false },
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', isDefault: true },
  { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', isDefault: false },
  { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', isDefault: false },
];

const geminiProvider: Provider = {
  name: 'gemini',

  listModels(): ModelInfo[] {
    return loadProviderModels('gemini', FALLBACK_GEMINI_MODELS);
  },
};

export default geminiProvider;
