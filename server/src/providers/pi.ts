import type { ModelInfo } from '@unleashd/shared';
import type { Provider } from './index';

const piProvider: Provider = {
  name: 'pi',

  listModels(): ModelInfo[] {
    return [
      { id: 'anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4', isDefault: false },
      { id: 'anthropic/claude-opus-4', displayName: 'Claude Opus 4', isDefault: true },
      { id: 'anthropic/claude-haiku-4.5', displayName: 'Claude Haiku 4.5', isDefault: false },
      { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', isDefault: false },
      { id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', isDefault: false },
      { id: 'openai/gpt-4o', displayName: 'GPT-4o', isDefault: false },
    ];
  },
};

export default piProvider;
