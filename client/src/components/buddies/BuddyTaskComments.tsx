import { type BuddyTaskComment, BuddyTaskCommentsPageSchema } from '@unleashd/shared';
import { useCallback, useRef, useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { buddyApi } from './api';

export function BuddyTaskComments({ projectId }: { projectId: string }) {
  return <BuddyTaskCommentsScope key={projectId} projectId={projectId} />;
}

function BuddyTaskCommentsScope({ projectId }: { projectId: string }) {
  const path = `/api/buddies/projects/${encodeURIComponent(projectId)}/comments`;
  const [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const command = useRef<{ payload: string; key: string } | null>(null);
  const submitting = useRef(false);
  const source = useCallback(
    async (signal: AbortSignal) => ({
      cursor,
      page: BuddyTaskCommentsPageSchema.parse(
        await buddyApi(`${path}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {
          signal,
        })
      ),
    }),
    [path, cursor]
  );
  const { data, loading, error, refetch } = usePolledFetch(source, 5000);
  const page = data?.cursor === cursor ? data.page : null;

  async function append() {
    if (submitting.current || !body.trim()) return;
    submitting.current = true;
    setSaving(true);
    setFailure(null);
    setNotice(null);
    const input = {
      body: body.trim(),
      evidence: evidence
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
    const payload = JSON.stringify(input);
    if (command.current?.payload !== payload) command.current = { payload, key: newId() };
    try {
      await buddyApi(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, key: command.current.key }),
      });
      command.current = null;
      setBody('');
      setEvidence('');
      setNotice('Comment added.');
      setCursor(null);
      refetch();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="buddy-task-comments" aria-label="Task comments">
      <h3>Task comments</h3>
      {error && (
        <p role="alert">
          {error.message}{' '}
          <button type="button" onClick={refetch}>
            Retry loading comments
          </button>
        </p>
      )}
      {!page && loading && <p>Loading comments…</p>}
      {page && <BuddyTaskCommentList comments={page.items} />}
      <nav aria-label="Comment pages">
        {cursor && (
          <button type="button" onClick={() => setCursor(null)}>
            Latest comments
          </button>
        )}
        {page?.nextCursor && (
          <button type="button" disabled={loading} onClick={() => setCursor(page.nextCursor)}>
            Older comments
          </button>
        )}
      </nav>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void append();
        }}
      >
        <fieldset disabled={saving}>
          <label>
            Comment
            <textarea
              required
              maxLength={32000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <label>
            Evidence or file references (one per line)
            <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} />
          </label>
          <button type="submit" disabled={!body.trim()}>
            {saving ? 'Adding comment…' : 'Add comment'}
          </button>
        </fieldset>
      </form>
      {failure && <p role="alert">{failure}</p>}
      {notice && <output>{notice}</output>}
    </section>
  );
}

export function BuddyTaskCommentList({ comments }: { comments: readonly BuddyTaskComment[] }) {
  return comments.length ? (
    <ol className="buddy-task-comments-list">
      {comments.map((comment) => (
        <li key={comment.id}>
          <p>
            <strong>{comment.author}</strong> ·{' '}
            <time dateTime={comment.created_at}>
              {new Date(comment.created_at).toLocaleString()}
            </time>
          </p>
          <p className="buddy-task-comments-body">{comment.body}</p>
          {comment.evidence.length > 0 && (
            <ul aria-label="Comment evidence">
              {comment.evidence.map((ref, index) => (
                <li key={`${index}:${ref}`}>{ref}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  ) : (
    <p>No comments yet.</p>
  );
}
