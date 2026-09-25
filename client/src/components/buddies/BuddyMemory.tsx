import { useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddySoulConflict } from './BuddySoulConflict';
import { BuddyApiError, buddyApi, buddyWrite, errorText } from './api';
import { type SoulMergeBlock, mergeSoulDraft } from './soul-merge';
import type { Doc, DocKind, DocRevision, DocScope } from './types';
import { ActionError, useBuddyAction } from './useBuddyAction';
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

/** Which doc an editor reads and writes, as the route names it (`scope`, `scopeId`, `name`). */
type DocAddress = { scope: DocScope['kind']; scopeId?: string; name: string };
const PORTABLE: DocAddress = { scope: 'buddy', name: '' };

/** A stored doc's address. Buddy scope has no id; the others carry theirs. */
export function addressOf(doc: Doc): DocAddress {
  switch (doc.scope.kind) {
    case 'buddy':
      return { scope: 'buddy', name: doc.name };
    case 'workspace':
      return { scope: 'workspace', scopeId: doc.scope.workspaceId, name: doc.name };
    case 'task':
      return { scope: 'task', scopeId: doc.scope.taskId, name: doc.name };
    case 'thread':
      return { scope: 'thread', scopeId: doc.scope.threadId, name: doc.name };
  }
}

const SCOPE_LABEL: { [K in DocScope['kind']]: string } = {
  buddy: 'This Buddy',
  workspace: 'Workspace',
  task: 'Task',
  thread: 'Thread',
};

export const readUrl = (buddyId: string, kind: DocKind, address: DocAddress) =>
  `${docUrl(buddyId, kind)}?${new URLSearchParams(Object.entries(address)).toString()}`;

/** A doc's saved revisions, newest first; read only while the disclosure is open. */
function DocRevisions({ docId }: { docId: string }) {
  const revisions = usePolledFetch<DocRevision[]>(
    `/api/buddies/docs/${encodeURIComponent(docId)}/revisions`,
    0
  );
  switch (revisions.kind) {
    case 'idle':
    case 'loading':
      return <p className="buddy-panel__empty">Loading history…</p>;
    case 'failed':
      return (
        <p className="buddy-panel__error" role="alert">
          {revisions.error.message}
        </p>
      );
    case 'ready':
    case 'stale':
      return <DocRevisionList revisions={revisions.data} />;
  }
}

export function DocRevisionList({ revisions }: { revisions: readonly DocRevision[] }) {
  return (
    <ol className="buddy-post-list" aria-label="Revision history">
      {[...revisions].reverse().map((revision) => (
        <li key={revision.revision}>
          <div className="buddy-post-list__meta">
            <strong>Revision {revision.revision}</strong>
            <span>{revision.reason}</span>
            <span>{revision.author}</span>
            <time dateTime={revision.createdAt}>
              {new Date(revision.createdAt).toLocaleString()}
            </time>
          </div>
          <details>
            <summary>Content</summary>
            <p className="buddy-post-list__body">{revision.content}</p>
          </details>
        </li>
      ))}
    </ol>
  );
}

function DocHistory({ docId }: { docId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>History</summary>
      {open && <DocRevisions docId={docId} />}
    </details>
  );
}

/**
 * One Buddy-scoped doc (soul, working or long-term memory) with optimistic
 * concurrency: a stale base answers 409 `[revision_conflict]`, and the draft
 * is three-way merged against the saved text instead of being overwritten or
 * thrown away. Mounted with a Buddy key so a switched Buddy cannot inherit a draft.
 */
function BuddyDocEditor({
  buddyId,
  kind,
  address,
  label,
  hint,
}: {
  buddyId: string;
  kind: DocKind;
  address: DocAddress;
  label: string;
  hint: string;
}) {
  const url = readUrl(buddyId, kind, address);
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
      const saved = await buddyWrite<Doc>(docUrl(buddyId, kind), 'PUT', {
        ...address,
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
      {doc.data && <DocHistory key={doc.data.id} docId={doc.data.id} />}
    </div>
  );
}

/** Shared docs (named, any scope): each opens into its editor. */
function DocList({ buddyId, kind, label }: { buddyId: string; kind: DocKind; label: string }) {
  const docs = usePolledFetch<Doc[]>(`${docUrl(buddyId, kind)}?all=1`, 0);
  return (
    <>
      <h3 className="buddy-panel__heading">{label}</h3>
      {docs.kind === 'failed' && (
        <p className="buddy-panel__error" role="alert">
          {docs.error.message}
        </p>
      )}
      {docs.data?.length === 0 && <p className="buddy-panel__empty">None yet.</p>}
      {docs.data?.map((doc) => (
        <DocCard key={doc.id} buddyId={buddyId} doc={doc} />
      ))}
    </>
  );
}

export function DocCard({ buddyId, doc }: { buddyId: string; doc: Doc }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="buddy-work-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{doc.name}</strong>
        <span>
          {SCOPE_LABEL[doc.scope.kind]} · Revision {doc.revision} ·{' '}
          {new Date(doc.updatedAt).toLocaleString()}
        </span>
      </summary>
      {open && (
        <BuddyDocEditor
          buddyId={buddyId}
          kind={doc.kind}
          address={addressOf(doc)}
          label={doc.name}
          hint={`${SCOPE_LABEL[doc.scope.kind]} doc.`}
        />
      )}
    </details>
  );
}

/** A first write: a shared doc for this Buddy or its whole workspace. */
function NewDocForm({ buddyId, workspaceId }: { buddyId: string; workspaceId: string }) {
  const [shareWith, setShareWith] = useState<'buddy' | 'workspace'>('buddy');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const action = useBuddyAction(async () => {});
  const scope: DocAddress =
    shareWith === 'workspace'
      ? { scope: 'workspace', scopeId: workspaceId, name: name.trim() }
      : { scope: 'buddy', name: name.trim() };
  return (
    <form
      className="buddy-panel__form"
      aria-label="New doc"
      onSubmit={(event) => {
        event.preventDefault();
        void action
          .run('create', () =>
            buddyWrite(docUrl(buddyId, 'shared'), 'PUT', {
              ...scope,
              content,
              baseRevision: 0,
              reason: 'Created by the owner',
            })
          )
          .then((ok) => {
            if (!ok) return;
            setName('');
            setContent('');
          });
      }}
    >
      <label>
        Shared with
        <select
          value={shareWith}
          onChange={(event) => setShareWith(event.target.value as typeof shareWith)}
        >
          <option value="buddy">This Buddy</option>
          <option value="workspace">The workspace</option>
        </select>
      </label>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <textarea
        aria-label="New doc content"
        rows={4}
        maxLength={DOC_MAX_CHARACTERS}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <button type="submit" disabled={action.busy || !name.trim()}>
        Create
      </button>
      <ActionError state={action.state} />
    </form>
  );
}

/**
 * The Buddy's portable docs (soul, working and long-term memory), then its shared docs. Every
 * doc keeps its revision history. Detailed notes are agent_notes/*.md files in the workspace.
 */
export function BuddyMemory({ buddyId, workspaceId }: { buddyId: string; workspaceId: string }) {
  return (
    <section className="buddy-panel" aria-label="Memory">
      <BuddyDocEditor
        key={`${buddyId}:soul`}
        buddyId={buddyId}
        kind="soul"
        address={PORTABLE}
        label="Soul"
        hint="Who this Buddy is. New turns read the saved revision."
      />
      <BuddyDocEditor
        key={`${buddyId}:working`}
        buddyId={buddyId}
        kind="working"
        address={PORTABLE}
        label="Working memory"
        hint="What the Buddy is in the middle of."
      />
      <BuddyDocEditor
        key={`${buddyId}:long_term`}
        buddyId={buddyId}
        kind="long_term"
        address={PORTABLE}
        label="Long-term memory"
        hint="What the Buddy keeps across work."
      />
      <DocList key={`${buddyId}:shared`} buddyId={buddyId} kind="shared" label="Shared docs" />
      <NewDocForm key={buddyId} buddyId={buddyId} workspaceId={workspaceId} />
    </section>
  );
}
