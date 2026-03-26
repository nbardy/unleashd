import type { ModelInfo } from '@unleashd/shared';
import type { Provider } from './index';

const qwenProvider: Provider = {
  name: 'qwen',

  listModels(): ModelInfo[] {
    return [
      { id: 'qwen/coder-model', displayName: 'Qwen Coder (Default)', isDefault: true },
    ];
  },
};

export default qwenProvider;
