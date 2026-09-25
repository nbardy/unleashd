import { useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddySoulConflict } from './BuddySoulConflict';
import { BuddyApiError, buddyApi, buddyWrite, errorText } from './api';
import { type SoulMergeBlock, mergeSoulDraft } from './soul-merge';
import type { Doc, DocKind } from './types';
import './BuddySoulConflict.css';

/** The server's DocWriteSchema bound (server/src/buddies/routes.ts). */
const DOC_MAX_CHARACTERS = 40_000;

/**
 * What a draft is based on. A doc that was never written is revision 0 with no
 * content — the contract's base for a first write, not a default.
 */
type DocBase = { revision: number; content: string };
const baseOf = (doc: Doc | null): DocBase =>
  doc === null ? { revision: 0, content: '' } : { revision: doc.revision, content: doc.content };

type Draft = { base: DocBase; content: string };

const docUrl = (buddyId: string, kind: DocKind) =>
  `/api/buddies/${encodeURIComponent(buddyId)}/docs/${kind}`;

/**
 * One Buddy-scoped doc (soul, working or long-term memory) with optimistic
 * concurrency: a stale base answers 409 `[revision_conflict]`, and the draft
 * is three-way merged against the saved text instead of being overwritten or
 * thrown away. Mounted with a Buddy key so a switched Buddy cannot inherit a draft.
 */
function BuddyDocEditor({
  buddyId,
  kind,
  label,
  hint,
}: {
  buddyId: string;
  kind: DocKind;
  label: string;
  hint: string;
}) {
  const url = docUrl(buddyId, kind);
  const doc = usePolledFetch<Doc | null>(url, 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState<{ saved: DocBase; blocks: SoulMergeBlock[] } | null>(
    null
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loaded = doc.kind === 'ready' || doc.kind === 'stale';
  const current: Draft | null =
    draft ?? (loaded ? { base: baseOf(doc.data), content: baseOf(doc.data).content } : null);
  const dirty = current !== null && current.content !== current.base.content;
  const tooLong = (current?.content.length ?? 0) > DOC_MAX_CHARACTERS;

  async function save(edited: Draft) {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await buddyWrite<Doc>(url, 'PUT', {
        content: edited.content,
        baseRevision: edited.base.revision,
        reason,
      });
      setDraft({ base: baseOf(saved), content: saved.content });
      setReason('');
      setNotice(`${label} saved as revision ${saved.revision}.`);
      await doc.refetch();
    } catch (cause) {
      if (cause instanceof BuddyApiError && cause.status === 409) {
        const saved = baseOf(await buddyApi<Doc | null>(url));
        setDraft(edited);
        setConflict({
          saved,
          blocks: mergeSoulDraft(edited.base.content, edited.content, saved.content),
        });
      } else {
        setNotice(errorText(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="buddy-doc">
      <div className="buddy-doc__heading">
        <h3>{label}</h3>
        {current && <small>Revision {current.base.revision}</small>}
      </div>
      <p className="buddy-panel__hint">{hint}</p>
      {doc.kind === 'failed' && (
        <p className="buddy-panel__error" role="alert">
          {doc.error.message}
        </p>
      )}
      {doc.kind === 'stale' && (
        <p className="buddy-panel__error" role="alert">
          Could not refresh: {doc.error.message}
        </p>
      )}
      {current === null && doc.kind !== 'failed' && <p className="buddy-panel__empty">Loading…</p>}
      {current && conflict && (
        <BuddySoulConflict
          label={label}
          maxCharacters={DOC_MAX_CHARACTERS}
          blocks={conflict.blocks}
          baseRevision={current.base.revision}
          savedRevision={conflict.saved.revision}
          onContinue={(content) => {
            setDraft({ base: conflict.saved, content });
            setConflict(null);
            setNotice('Combined draft ready. Review or edit it, then save.');
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
          className="buddy-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(current);
          }}
        >
          <textarea
            aria-label={`${label} content`}
            rows={10}
            value={current.content}
            disabled={busy}
            onChange={(event) => setDraft({ ...current, content: event.target.value })}
          />
          <small role={tooLong ? 'alert' : undefined}>
            {current.content.length.toLocaleString()} / {DOC_MAX_CHARACTERS.toLocaleString()}{' '}
            characters
          </small>
          <label>
            Reason for change
            <input
              aria-label={`${label} change reason`}
              required
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !dirty || tooLong || !reason.trim()}>
            {busy ? 'Saving…' : `Save ${label.toLowerCase()}`}
          </button>
        </form>
      )}
      {notice && <output>{notice}</output>}
    </div>
  );
}

/** The Buddy's portable docs: its soul and its private working / long-term memory. */
export function BuddyMemory({ buddyId }: { buddyId: string }) {
  return (
    <section className="buddy-panel" aria-label="Memory">
      <BuddyDocEditor
        key={`${buddyId}:soul`}
        buddyId={buddyId}
        kind="soul"
        label="Soul"
        hint="Who this Buddy is. New turns read the saved revision."
      />
      <BuddyDocEditor
        key={`${buddyId}:working`}
        buddyId={buddyId}
        kind="working"
        label="Working memory"
        hint="What the Buddy is in the middle of."
      />
      <BuddyDocEditor
        key={`${buddyId}:long_term`}
        buddyId={buddyId}
        kind="long_term"
        label="Long-term memory"
        hint="What the Buddy keeps across work."
      />
    </section>
  );
}
