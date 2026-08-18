import type { ConversationConfig } from '@unleashd/shared';
import { useEffect, useRef } from 'react';
import { setConversationConfig } from '../../atoms/config-actions';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';

/**
 * ModelSheetMobile — provider / model / reasoning selection in a modal.
 *
 * Replaces the three always-visible dropdown chips that used to sit in the
 * conversation header. On a phone those wrapped onto two or three rows (e.g.
 * "Muse" + "Muse Spark 1.2 Contributor" + "Default · high"), eating a third of
 * the screen before a single message was visible. The header now shows one
 * compact label; this sheet opens on tap.
 *
 * Values pass through verbatim — provider-bespoke effort strings are never
 * translated (see docs/pass-through-pattern.md).
 */

export function modelSummary(
  config: ConversationConfig,
  catalog: ReturnType<typeof useProviderCatalog>['catalog']
): string {
  const provider = catalog?.providers.find((p) => p.id === config.provider);
  const modelId =
    config.model.mode === 'explicit' ? config.model.modelId : provider?.defaultModelId;
  const model = provider?.models.find((m) => m.id === modelId);
  const name = model?.displayName ?? modelId ?? provider?.displayName ?? config.provider;
  const effort =
    config.reasoning.mode === 'explicit'
      ? config.reasoning.effort
      : config.reasoning.mode === 'disabled'
        ? 'no reasoning'
        : null;
  return effort ? `${name} · ${effort}` : name;
}

export function ModelSheetMobile({
  conversationId,
  config,
  configRevision,
  onClose,
}: {
  conversationId: string;
  config: ConversationConfig;
  configRevision: number;
  onClose: () => void;
}) {
  const { catalog, error, retry } = useProviderCatalog();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const apply = (patch: Parameters<typeof setConversationConfig>[0]['patch']) => {
    setConversationConfig({ conversationId, expectedRevision: configRevision, patch });
    onClose();
  };

  const providerEntry = catalog?.providers.find((p) => p.id === config.provider);
  const resolvedModelId =
    config.model.mode === 'explicit' ? config.model.modelId : providerEntry?.defaultModelId;
  const resolvedModel = providerEntry?.models.find((m) => m.id === resolvedModelId);

  return (
    <dialog
      ref={dialogRef}
      className="mobile-sheet"
      aria-label="Model settings"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="mobile-sheet__inner">
        <div className="mobile-sheet__grabber" aria-hidden="true" />
        <div className="mobile-sheet__header">
          <h2 className="mobile-sheet__title">Model</h2>
          <button
            type="button"
            className="mobile-sheet__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!catalog ? (
          <div className="mobile-sheet__note" role={error ? 'alert' : 'status'}>
            {error ? (
              <>
                Unable to load providers.{' '}
                <button type="button" className="mobile-chat__action" onClick={retry}>
                  Retry
                </button>
              </>
            ) : (
              'Loading providers…'
            )}
          </div>
        ) : (
          <>
            <div className="mobile-sheet__section-title">Provider</div>
            <div className="mobile-sheet__options">
              {catalog.providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    p.id === config.provider
                      ? 'mobile-sheet__option mobile-sheet__option--selected'
                      : 'mobile-sheet__option'
                  }
                  aria-pressed={p.id === config.provider}
                  onClick={() =>
                    apply({
                      kind: 'set_provider',
                      provider: p.id as ConversationConfig['provider'],
                    })
                  }
                >
                  {p.displayName}
                </button>
              ))}
            </div>

            {providerEntry && (
              <>
                <div className="mobile-sheet__section-title">Model</div>
                <div className="mobile-sheet__options">
                  <button
                    type="button"
                    className={
                      config.model.mode === 'default'
                        ? 'mobile-sheet__option mobile-sheet__option--selected'
                        : 'mobile-sheet__option'
                    }
                    aria-pressed={config.model.mode === 'default'}
                    onClick={() => apply({ kind: 'set_model', model: { mode: 'default' } })}
                  >
                    Provider default
                    <span className="mobile-sheet__option-meta">
                      {providerEntry.defaultModelId}
                    </span>
                  </button>
                  {providerEntry.models.map((m) => {
                    const selected =
                      config.model.mode === 'explicit' && config.model.modelId === m.id;
                    const currentEffort =
                      config.reasoning.mode === 'explicit' ? config.reasoning.effort : null;
                    const supportsEffort =
                      !currentEffort || m.reasoning?.levels.includes(currentEffort);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={
                          selected
                            ? 'mobile-sheet__option mobile-sheet__option--selected'
                            : 'mobile-sheet__option'
                        }
                        aria-pressed={selected}
                        onClick={() => {
                          // Switching to a model that lacks the current effort must
                          // reset reasoning in the SAME patch, or the server rejects
                          // the pair as inconsistent.
                          if (!supportsEffort) {
                            apply({
                              kind: 'replace',
                              config: {
                                ...config,
                                model: { mode: 'explicit', modelId: m.id },
                                reasoning: { mode: 'default' },
                              },
                            });
                          } else {
                            apply({
                              kind: 'set_model',
                              model: { mode: 'explicit', modelId: m.id },
                            });
                          }
                        }}
                      >
                        {m.displayName}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {resolvedModel?.reasoning && (
              <>
                <div className="mobile-sheet__section-title">Reasoning</div>
                <div className="mobile-sheet__options">
                  <button
                    type="button"
                    className={
                      config.reasoning.mode === 'default'
                        ? 'mobile-sheet__option mobile-sheet__option--selected'
                        : 'mobile-sheet__option'
                    }
                    aria-pressed={config.reasoning.mode === 'default'}
                    onClick={() => apply({ kind: 'set_reasoning', reasoning: { mode: 'default' } })}
                  >
                    Model default
                    {resolvedModel.reasoning.defaultEffort ? (
                      <span className="mobile-sheet__option-meta">
                        {resolvedModel.reasoning.defaultEffort}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={
                      config.reasoning.mode === 'disabled'
                        ? 'mobile-sheet__option mobile-sheet__option--selected'
                        : 'mobile-sheet__option'
                    }
                    aria-pressed={config.reasoning.mode === 'disabled'}
                    onClick={() =>
                      apply({ kind: 'set_reasoning', reasoning: { mode: 'disabled' } })
                    }
                  >
                    No reasoning flag
                  </button>
                  {resolvedModel.reasoning.levels.map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      className={
                        config.reasoning.mode === 'explicit' && config.reasoning.effort === effort
                          ? 'mobile-sheet__option mobile-sheet__option--selected'
                          : 'mobile-sheet__option'
                      }
                      aria-pressed={
                        config.reasoning.mode === 'explicit' && config.reasoning.effort === effort
                      }
                      onClick={() =>
                        apply({ kind: 'set_reasoning', reasoning: { mode: 'explicit', effort } })
                      }
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
