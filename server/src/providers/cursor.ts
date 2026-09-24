import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

const FALLBACK_CURSOR_MODELS: ModelInfo[] = [
  { id: 'composer-2.5', displayName: 'Composer 2.5', isDefault: true },
  { id: 'grok-4.7-xhigh', displayName: 'Grok 4.7 Extra High', isDefault: false },
  { id: 'grok-4.7-high', displayName: 'Grok 4.7 High', isDefault: false },
  { id: 'grok-4.7-medium', displayName: 'Grok 4.7 Medium', isDefault: false },
  { id: 'grok-4.7-low', displayName: 'Grok 4.7 Low', isDefault: false },
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
