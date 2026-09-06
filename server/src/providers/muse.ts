import type { ModelInfo } from '@unleashd/shared';
import { loadProviderModels } from './catalog';
import type { Provider } from './index';

const FALLBACK_MUSE_MODELS: ModelInfo[] = [
  { id: 'muse-spark-1.1', displayName: 'Muse Spark 1.1', isDefault: false },
  { id: 'muse-spark-1.2-contributor', displayName: 'Muse Spark 1.2 Contributor', isDefault: true },
];

const museProvider: Provider = {
  name: 'muse',

  listModels(): ModelInfo[] {
    return loadProviderModels('muse', FALLBACK_MUSE_MODELS);
  },
};

export default museProvider;
