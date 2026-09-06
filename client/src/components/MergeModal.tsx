import { type ConversationConfig, createDefaultConversationConfig } from '@unleashd/shared';
import { useAtom, useAtomValue } from 'jotai';
import { useState } from 'react';
import { createMergeConversations } from '../atoms/actions';
import { defaultCwdAtom } from '../atoms/conversations';
import { mergeModeAtom, mergeSelectionAtom } from '../atoms/mergeAtoms';
import { useProviderCatalog } from '../hooks/useProviderCatalog';
import { ConversationConfigPicker } from './ConversationConfigPicker';
import './MergeModal.css';

// Slim merge modal: positioned over the main-content area (not covering
// the sidebar) so sidebar selection stays interactive. Shows selected count
// + provider/model picker + confirm. No conversation list — selection is
// done via the sidebar checkmarks.
export function MergeModal({ onComplete }: { onComplete: (parentId: string) => void }) {
  const defaultCwd = useAtomValue(defaultCwdAtom);
  const [, setMergeMode] = useAtom(mergeModeAtom);
  const [mergeSelection, setMergeSelection] = useAtom(mergeSelectionAtom);

  const [parentConfig, setParentConfig] = useState<ConversationConfig>(() =>
    createDefaultConversationConfig('claude')
  );
  const { catalog, isLoading: isCatalogLoading, error: catalogError, retry } = useProviderCatalog();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState(defaultCwd);

  const canSubmit = mergeSelection.size > 0 && !!workingDirectory && !isSubmitting;

  const handleCancel = () => {
    setMergeMode(false);
    setMergeSelection(new Set());
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createMergeConversations({
        parentConfig,
        workingDirectory,
        sourceIds: Array.from(mergeSelection),
      });
      setMergeMode(false);
      setMergeSelection(new Set());
      onComplete(result.parentId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="merge-modal">
      <h3 className="merge-modal__title">Merge Conversations</h3>
      <p className="merge-modal__hint">
        {mergeSelection.size === 0
          ? 'Select conversations in the sidebar to merge.'
          : `${mergeSelection.size} conversation${mergeSelection.size !== 1 ? 's' : ''} selected. Each will be forked with a review prompt.`}
      </p>

      <label className="merge-modal__label" htmlFor="merge-modal-cwd">
        Working Directory
      </label>
      <input
        id="merge-modal-cwd"
        type="text"
        className="merge-modal__input"
        value={workingDirectory}
        onChange={(e) => setWorkingDirectory(e.target.value)}
        placeholder="/path/to/project"
      />

      {catalog ? (
        <ConversationConfigPicker
          value={parentConfig}
          onChange={setParentConfig}
          catalog={catalog}
        />
      ) : (
        <div className="config-picker-status" role={catalogError ? 'alert' : 'status'}>
          {catalogError ? (
            <>
              Unable to load providers.{' '}
              <button type="button" onClick={retry}>
                Retry
              </button>
            </>
          ) : isCatalogLoading ? (
            'Loading providers…'
          ) : null}
        </div>
      )}

      {error && <div className="merge-modal__error">{error}</div>}

      <div className="merge-modal__actions">
        <button
          type="button"
          className="merge-modal__cancel"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="merge-modal__confirm"
          onClick={handleConfirm}
          disabled={!canSubmit}
        >
          {isSubmitting ? 'Forking...' : `Fork & Merge ${mergeSelection.size}`}
        </button>
      </div>
    </div>
  );
}
