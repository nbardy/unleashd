import type { Provider } from '@unleashd/shared';
import { useState } from 'react';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import type { Buddy } from './types';

export interface BuddyExecutionProfileValue {
  provider: Provider;
  model: string | null;
  reasoningEffort: string | null;
}

export function BuddyExecutionProfile({
  buddy,
  busy,
  onSave,
}: {
  buddy: Buddy;
  busy: boolean;
  onSave(value: BuddyExecutionProfileValue): Promise<void>;
}) {
  const { catalog, error } = useProviderCatalog();
  const [provider, setProvider] = useState<Provider>((buddy.provider || 'codex') as Provider);
  const [model, setModel] = useState(buddy.model ?? '');
  const [reasoningEffort, setReasoningEffort] = useState(buddy.reasoning_effort ?? '');
  const providerInfo = catalog?.providers.find((candidate) => candidate.id === provider);
  const buddyProviders = catalog
    ? [
        ...(providerInfo && !providerInfo.supportsRequiredMcp ? [providerInfo] : []),
        ...catalog.providers.filter((candidate) => candidate.supportsRequiredMcp),
      ]
    : [];
  const selectedModel =
    providerInfo?.models.find((candidate) => candidate.id === model) ??
    providerInfo?.models.find((candidate) => candidate.id === providerInfo.defaultModelId);
  const effortLevels = selectedModel?.reasoning?.levels ?? [];

  return (
    <details className="buddy-execution-profile">
      <summary>
        <span>Execution</span>
        <strong>
          {provider} · {buddy.model || 'default model'} ·{' '}
          {buddy.reasoning_effort || 'default effort'}
        </strong>
      </summary>
      {error && <p>Provider catalog unavailable: {error.message}</p>}
      {catalog && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave({
              provider,
              model: model || null,
              reasoningEffort: reasoningEffort || null,
            });
          }}
        >
          <label>
            Provider
            <select
              value={provider}
              disabled={busy}
              onChange={(event) => {
                setProvider(event.target.value as Provider);
                setModel('');
                setReasoningEffort('');
              }}
            >
              {buddyProviders.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                  {candidate.supportsRequiredMcp ? '' : ' (unsupported for Buddy turns)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select
              value={model}
              disabled={busy}
              onChange={(event) => {
                setModel(event.target.value);
                setReasoningEffort('');
              }}
            >
              <option value="">
                Provider default
                {providerInfo?.defaultModelId ? ` (${providerInfo.defaultModelId})` : ''}
              </option>
              {providerInfo?.models.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning
            <select
              value={reasoningEffort}
              disabled={busy}
              onChange={(event) => setReasoningEffort(event.target.value)}
            >
              <option value="">
                Model default
                {selectedModel?.reasoning?.defaultEffort
                  ? ` (${selectedModel.reasoning.defaultEffort})`
                  : ''}
              </option>
              {effortLevels.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}
    </details>
  );
}
