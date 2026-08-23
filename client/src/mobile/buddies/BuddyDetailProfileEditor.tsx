import { useEffect, useState } from 'react';
import { buddyApi } from '../../components/buddies/api';
import type { Buddy } from '../../components/buddies/types';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';

// ---------------------------------------------------------------------------
// Buddy profile editor — provider/model/effort pass-through (verbatim)
// ---------------------------------------------------------------------------

export function BuddyProfileEditor({
  buddy,
  busy,
  error,
  onBusy,
  onError,
  onSaved,
}: {
  buddy: Buddy;
  busy: boolean;
  error: string | null;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onSaved: () => void;
}) {
  const { catalog } = useProviderCatalog();
  const [provider, setProvider] = useState<string>(buddy.provider ?? 'codex');
  const [model, setModel] = useState<string>(buddy.model ?? '');
  const [reasoningEffort, setReasoningEffort] = useState<string>(buddy.reasoning_effort ?? '');

  useEffect(() => {
    setProvider(buddy.provider ?? 'codex');
    setModel(buddy.model ?? '');
    setReasoningEffort(buddy.reasoning_effort ?? '');
  }, [buddy.provider, buddy.model, buddy.reasoning_effort]);

  const providerInfo = catalog?.providers.find((candidate) => candidate.id === provider);
  const buddyProviders = catalog
    ? [
        ...(providerInfo && !providerInfo.supportsRequiredMcp ? [providerInfo] : []),
        ...catalog.providers.filter((candidate) => candidate.supportsRequiredMcp),
      ]
    : [{ id: provider, displayName: provider, supportsRequiredMcp: true } as never];
  const selectedModel =
    providerInfo?.models.find((candidate) => candidate.id === model) ??
    providerInfo?.models.find((candidate) => candidate.id === providerInfo?.defaultModelId);
  const effortLevels = selectedModel?.reasoning?.levels ?? [];

  return (
    <details className="mobile-buddy-profile-editor">
      <summary className="mobile-buddy-profile-editor__summary">
        Execution · {provider} · {buddy.model ?? 'default model'} ·{' '}
        {buddy.reasoning_effort ?? 'default effort'}
      </summary>
      <form
        className="mobile-buddy-profile-editor__form"
        onSubmit={(event) => {
          event.preventDefault();
          onError(null);
          onBusy(true);
          // Pass-through verbatim: strings reach the harness unchanged (no translation).
          const payload = {
            provider,
            model: model || null,
            reasoningEffort: reasoningEffort || null,
          };
          void buddyApi(`/api/buddies/${encodeURIComponent(buddy.id)}/profile`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
            .then(() => onSaved())
            .catch((cause: unknown) =>
              onError(cause instanceof Error ? cause.message : String(cause))
            )
            .finally(() => onBusy(false));
        }}
      >
        <label className="mobile-field">
          <span>Provider</span>
          <select
            value={provider}
            disabled={busy}
            onChange={(event) => setProvider(event.target.value)}
          >
            {buddyProviders.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName ?? candidate.id}
                {candidate.supportsRequiredMcp ? '' : ' (unsupported for Buddy turns)'}
              </option>
            ))}
          </select>
        </label>
        <label className="mobile-field">
          <span>Model</span>
          <select value={model} disabled={busy} onChange={(event) => setModel(event.target.value)}>
            <option value="">
              Provider default{' '}
              {providerInfo?.defaultModelId ? `(${providerInfo.defaultModelId})` : ''}
            </option>
            {(providerInfo?.models ?? []).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName ?? candidate.id}
              </option>
            ))}
          </select>
        </label>
        <label className="mobile-field">
          <span>Reasoning effort</span>
          <select
            value={reasoningEffort}
            disabled={busy}
            onChange={(event) => setReasoningEffort(event.target.value)}
          >
            <option value="">
              Model default{' '}
              {selectedModel?.reasoning?.defaultEffort
                ? `(${selectedModel.reasoning.defaultEffort})`
                : ''}
            </option>
            {effortLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="mobile-error">{error}</p>}
        <button type="submit" className="mobile-cta" disabled={busy}>
          {busy ? 'Saving…' : 'Save execution'}
        </button>
      </form>
    </details>
  );
}
