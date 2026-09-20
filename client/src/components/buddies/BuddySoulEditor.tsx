import {
  BUDDY_SOUL_MAX_CHARACTERS,
  type BuddySoul,
  BuddySoulConflictSchema,
  BuddySoulSchema,
  BuddySoulUpdateSchema,
} from '@unleashd/shared';
import { useMemo, useState } from 'react';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddySoulConflict } from './BuddySoulConflict';
import { BuddyApiError, buddyApi } from './api';
import { type SoulMergeBlock, mergeSoulDraft } from './soul-merge';

/** Mounted with a Buddy key so a switched profile cannot inherit another draft. */
export function BuddySoulEditor({ buddyId, className }: { buddyId: string; className: string }) {
  const url = `/api/buddies/${encodeURIComponent(buddyId)}/soul`;
  const source = useMemo(
    () =>
      resource(url, async (signal: AbortSignal) =>
        BuddySoulSchema.parse(await buddyApi(url, { signal }))
      ),
    [url]
  );
  const { data, error, loading, refetch } = usePolledFetch(source, 0);
  const [draft, setDraft] = useState<{ base: BuddySoul; content: string } | null>(null);
  const [conflict, setConflict] = useState<{
    saved: BuddySoul;
    blocks: SoulMergeBlock[];
  } | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const current = draft ?? (data ? { base: data, content: data.body } : null);
  const dirty = current !== null && current.content !== current.base.body;
  const tooLong = (current?.content.trim().length ?? 0) > BUDDY_SOUL_MAX_CHARACTERS;

  function reviewChanges(saved: BuddySoul, edited: NonNullable<typeof current>) {
    setDraft(edited);
    setConflict({
      saved,
      blocks: mergeSoulDraft(edited.base.body, edited.content, saved.body),
    });
    setNotice(null);
  }

  return (
    <div className={`${className}__block`}>
      <div className={`${className}__block-heading`}>
        <span>Soul</span>
        {current && <small>Based on revision {current.base.revision}</small>}
      </div>
      {error && (
        <p role="alert">
          Could not load soul.{' '}
          <button type="button" onClick={refetch}>
            Retry
          </button>
        </p>
      )}
      {!current && loading && <p>Loading soul…</p>}
      {current && conflict && (
        <BuddySoulConflict
          blocks={conflict.blocks}
          baseRevision={current.base.revision}
          savedRevision={conflict.saved.revision}
          onContinue={(content) => {
            setDraft({ base: conflict.saved, content });
            setConflict(null);
            setNotice(
              content === conflict.saved.body
                ? 'Your changes are already in the saved soul. No new save is needed.'
                : 'Combined draft ready. Review or edit it, then save.'
            );
          }}
          onCancel={() => {
            setConflict(null);
            setNotice(
              'Your original draft is preserved. Saving will check for newer changes again.'
            );
          }}
        />
      )}
      {current && !conflict && (
        <form
          className={`${className}__update-form`}
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = BuddySoulUpdateSchema.safeParse({
              content: current.content,
              baseVersion: current.base.revision,
              reasoning,
            });
            if (!parsed.success) {
              setNotice(parsed.error.issues.map((issue) => issue.message).join(' '));
              return;
            }
            setBusy(true);
            setNotice(null);
            void buddyApi(url, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(parsed.data),
            })
              .then((response) => {
                const saved = BuddySoulSchema.parse(response);
                setDraft({ base: saved, content: saved.body });
                setReasoning('');
                setNotice('Soul saved. New conversations use this revision.');
                refetch();
              })
              .catch((cause) => {
                if (cause instanceof BuddyApiError && cause.status === 409) {
                  const stale = BuddySoulConflictSchema.safeParse(cause.payload);
                  if (stale.success && stale.data.details.supplied_base === current.base.revision) {
                    reviewChanges(
                      {
                        body: stale.data.details.current_content,
                        revision: stale.data.details.current_version,
                      },
                      current
                    );
                    return;
                  }
                  setNotice(
                    'The saved version could not be read. Your draft is preserved. Check for newer changes to try again.'
                  );
                  return;
                }
                setNotice(cause instanceof Error ? cause.message : 'Could not save soul.');
              })
              .finally(() => setBusy(false));
          }}
        >
          <textarea
            aria-label="Soul content"
            rows={10}
            maxLength={BUDDY_SOUL_MAX_CHARACTERS}
            value={current.content}
            disabled={busy}
            onChange={(event) => setDraft({ ...current, content: event.target.value })}
          />
          <small role={tooLong ? 'alert' : undefined}>
            {current.content.length.toLocaleString()} / {BUDDY_SOUL_MAX_CHARACTERS.toLocaleString()}{' '}
            characters
            {tooLong && ' — shorten the combined draft before saving.'}
          </small>
          <label>
            Reason for change
            <input
              aria-label="Soul change reason"
              required
              maxLength={2_000}
              value={reasoning}
              disabled={busy}
              onChange={(event) => setReasoning(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !dirty || tooLong || !reasoning.trim() || !current.content.trim()}
          >
            {busy ? 'Saving…' : 'Save soul'}
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => {
              setBusy(true);
              setNotice(null);
              void buddyApi(url)
                .then((response) => {
                  const saved = BuddySoulSchema.parse(response);
                  if (dirty) {
                    if (saved.revision === current.base.revision) {
                      setNotice('Your draft is based on the latest saved revision.');
                    } else {
                      reviewChanges(saved, current);
                    }
                  } else {
                    setDraft({ base: saved, content: saved.body });
                    setNotice('Loaded the latest saved soul.');
                  }
                })
                .catch((cause) =>
                  setNotice(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not load soul. Your draft is preserved.'
                  )
                )
                .finally(() => setBusy(false));
            }}
          >
            {dirty ? 'Check for newer changes' : 'Reload saved soul'}
          </button>
        </form>
      )}
      {notice && <output>{notice}</output>}
    </div>
  );
}
