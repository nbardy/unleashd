import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

const FALLBACK_CURSOR_MODELS: ModelInfo[] = [
  { id: 'composer-2.5', displayName: 'Composer 2.5', isDefault: true },
  { id: 'cursor-grok-4.5-high', displayName: 'Grok 4.5 High', isDefault: false },
  { id: 'cursor-grok-4.5-medium', displayName: 'Grok 4.5 Medium', isDefault: false },
  { id: 'cursor-grok-4.5-low', displayName: 'Grok 4.5 Low', isDefault: false },
];

const cursorProvider: Provider = {
  name: 'cursor',

  listModels(): ModelInfo[] {
    return loadProviderModels('cursor', FALLBACK_CURSOR_MODELS);
  },
};

export default cursorProvider;
