import { BUDDY_SOUL_MAX_CHARACTERS } from '@unleashd/shared';
import { useState } from 'react';
import { type SoulMergeBlock, resolveSoulMerge } from './soul-merge';

export function BuddySoulConflict({
  blocks,
  baseRevision,
  savedRevision,
  onContinue,
  onCancel,
}: {
  blocks: SoulMergeBlock[];
  baseRevision: number;
  savedRevision: number;
  onContinue: (content: string) => void;
  onCancel: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<number, string[] | undefined>>({});
  const merged = resolveSoulMerge(blocks, resolutions);
  const conflicts = blocks.flatMap((block, index) =>
    block.kind === 'conflict' ? [{ block, index }] : []
  );
  const remaining = conflicts.filter(({ index }) => resolutions[index] === undefined).length;

  return (
    <section className="buddy-soul-conflict" aria-label="Resolve soul changes">
      <div aria-live="polite">
        <strong>Another edit was saved. Your draft is preserved.</strong>
        <p>
          Your draft started at revision {baseRevision}; the saved soul is revision {savedRevision}.
          Separate changes have been combined. Nothing has been saved from this review.
        </p>
      </div>
      {conflicts.map(({ block, index }, number) => (
        <fieldset key={index} className="buddy-soul-conflict__region">
          <legend>Overlapping change {number + 1}</legend>
          <div className="buddy-soul-conflict__versions">
            <div>
              <strong>Your edit</strong>
              <pre>{block.mine.length ? block.mine.join('\n') : '(Region removed)'}</pre>
              <button
                type="button"
                onClick={() => setResolutions((previous) => ({ ...previous, [index]: block.mine }))}
              >
                Use my edit for change {number + 1}
              </button>
            </div>
            <div>
              <strong>Saved edit</strong>
              <pre>{block.saved.length ? block.saved.join('\n') : '(Region removed)'}</pre>
              <button
                type="button"
                onClick={() =>
                  setResolutions((previous) => ({ ...previous, [index]: block.saved }))
                }
              >
                Use saved edit for change {number + 1}
              </button>
            </div>
          </div>
          <details>
            <summary>Original text at revision {baseRevision}</summary>
            <pre>{block.original.length ? block.original.join('\n') : '(Empty region)'}</pre>
          </details>
          <label>
            Resolution for change {number + 1}
            <textarea
              rows={3}
              value={resolutions[index]?.join('\n') ?? ''}
              placeholder="Choose an edit above, or write a replacement here"
              onChange={(event) => {
                const content = event.target.value;
                setResolutions((previous) => ({
                  ...previous,
                  [index]: content === '' ? [] : content.split('\n'),
                }));
              }}
            />
          </label>
          <small>
            {resolutions[index] === undefined
              ? 'Choose or write a resolution. Separate changes will be kept.'
              : 'Resolved. You can edit the replacement; clearing it removes this region.'}
          </small>
        </fieldset>
      ))}
      <output>
        {remaining > 0
          ? `${remaining} overlapping ${remaining === 1 ? 'change needs' : 'changes need'} a resolution.`
          : 'All changes are combined. Review the wording before saving.'}
      </output>
      {merged !== null && (
        <label>
          Combined soul preview
          <textarea readOnly rows={10} value={merged} />
          {merged.length > BUDDY_SOUL_MAX_CHARACTERS && (
            <small>
              The combined soul exceeds {BUDDY_SOUL_MAX_CHARACTERS.toLocaleString()} characters.
              Continue to the editor to shorten it before saving.
            </small>
          )}
        </label>
      )}
      <div className="buddy-soul-conflict__actions">
        <button
          type="button"
          disabled={merged === null}
          onClick={() => {
            if (merged !== null) onContinue(merged);
          }}
        >
          Continue with combined draft
        </button>
        <button type="button" onClick={onCancel}>
          Back to my original draft
        </button>
      </div>
    </section>
  );
}
