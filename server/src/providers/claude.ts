import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

const FALLBACK_CLAUDE_MODELS: ModelInfo[] = [
  { id: 'fable', displayName: 'Claude Fable 5.1', isDefault: false },
  { id: 'opus', displayName: 'Claude Opus 5', isDefault: true },
  { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', isDefault: false },
  { id: 'sonnet', displayName: 'Claude Sonnet', isDefault: false },
  { id: 'haiku', displayName: 'Claude Haiku', isDefault: false },
];

const claudeProvider: Provider = {
  name: 'claude',

  listModels(): ModelInfo[] {
    return loadProviderModels('claude', FALLBACK_CLAUDE_MODELS);
  },
};

export default claudeProvider;
