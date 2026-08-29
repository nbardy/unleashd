import { useEffect, useState } from 'react';
import { formatMemoryWriteError, hasV2Memory, memoryDocument } from './memory';
import type { Buddy, BuddyMemory, BuddyMemoryDocumentKind, BuddyMemoryRecallResult } from './types';

type Variant = 'desktop' | 'mobile';

function prefix(variant: Variant): string {
  return variant === 'desktop' ? 'buddy-memory-v2' : 'mobile-memory-v2';
}

export interface BuddyMemoryPanelProps {
  buddy: Buddy;
  memory: BuddyMemory;
  variant: Variant;
  error: string | null;
  onRetry: () => void;
  onUpdate?: (
    documentKind: BuddyMemoryDocumentKind,
    content: string,
    reasoning: string,
    baseVersion: number
  ) => Promise<void>;
  onRememberLegacy?: (kind: 'journal' | 'curated', content: string) => Promise<void>;
  onRememberNote?: (input: {
    topic: string;
    kind: string;
    body: string;
    scope: 'current' | 'home' | 'all';
  }) => Promise<void>;
  onRecall?: (input: {
    pattern: string;
    scope: 'current' | 'home' | 'all';
  }) => Promise<BuddyMemoryRecallResult>;
}

export function BuddyMemoryPanel({
  buddy,
  memory,
  variant,
  error,
  onRetry,
  onUpdate,
  onRememberLegacy,
  onRememberNote,
  onRecall,
}: BuddyMemoryPanelProps) {
  const className = prefix(variant);
  const v2 = hasV2Memory(memory);
  const working = memoryDocument(memory, 'working');
  const longTerm = memoryDocument(memory, 'longTerm');
  const [workingBody, setWorkingBody] = useState(working.body);
  const [longTermBody, setLongTermBody] = useState(longTerm.body);
  const [reasoning, setReasoning] = useState('');
  const [legacyKind, setLegacyKind] = useState<'journal' | 'curated'>('journal');
  const [legacyContent, setLegacyContent] = useState('');
  const [noteTopic, setNoteTopic] = useState('memory');
  const [noteKind, setNoteKind] = useState('note');
  const [noteScope, setNoteScope] = useState<'current' | 'home' | 'all'>('current');
  const [noteBody, setNoteBody] = useState('');
  const [recallPattern, setRecallPattern] = useState('');
  const [recallScope, setRecallScope] = useState<'current' | 'home' | 'all'>('all');
  const [recallResult, setRecallResult] = useState<BuddyMemoryRecallResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setWorkingBody(working.body), [working.body]);
  useEffect(() => setLongTermBody(longTerm.body), [longTerm.body]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setLocalError(null);
    try {
      await action();
    } catch (cause) {
      setLocalError(formatMemoryWriteError(cause));
      throw cause;
    } finally {
      setBusy(null);
    }
  };

  const submitUpdate = (
    documentKind: BuddyMemoryDocumentKind,
    document: ReturnType<typeof memoryDocument>
  ) => {
    if (!onUpdate) return;
    const body = documentKind === 'working' ? workingBody : longTermBody;
    void run(`update-${documentKind}`, () =>
      onUpdate(documentKind, body, reasoning.trim(), document.revision)
    )
      .then(() => setReasoning(''))
      .catch(() => {});
  };

  return (
    <section
      className={`${className} ${variant === 'desktop' ? 'buddy-section' : 'mobile-buddy-section'}`}
      aria-label="Memory"
    >
      {(error || localError) && (
        <div className={`${className}__error`} role="alert">
          {error ?? localError}
          {error && (
            <button type="button" onClick={onRetry} disabled={busy !== null}>
              Retry
            </button>
          )}
        </div>
      )}
      <div className={`${className}__block`}>
        <span>Soul · {memory.soulPath ?? buddy.soul_path ?? 'Not configured'}</span>
        <pre>{memory.soul || 'Soul content is loaded into Buddy conversations by the server.'}</pre>
      </div>

      {v2 ? (
        <>
          <output className={`${className}__generation`}>
            Memory generation {memory.generation ?? 0} · independent document revisions
          </output>
          {(['working', 'longTerm'] as const).map((documentKind) => {
            const document = documentKind === 'working' ? working : longTerm;
            const body = documentKind === 'working' ? workingBody : longTermBody;
            const setBody = documentKind === 'working' ? setWorkingBody : setLongTermBody;
            return (
              <div className={`${className}__block`} key={documentKind}>
                <div className={`${className}__block-heading`}>
                  <span>{document.label}</span>
                  <small>Revision {document.revision}</small>
                </div>
                <textarea
                  aria-label={`${document.label} content`}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  disabled={!onUpdate || busy !== null}
                  rows={8}
                />
                {onUpdate && (
                  <form
                    className={`${className}__update-form`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitUpdate(documentKind, document);
                    }}
                  >
                    <label>
                      Reason for revision
                      <input
                        required
                        value={reasoning}
                        onChange={(event) => setReasoning(event.target.value)}
                        disabled={busy !== null}
                        placeholder="What changed and why?"
                      />
                    </label>
                    <button type="submit" disabled={busy !== null || !reasoning.trim()}>
                      {busy === `update-${documentKind}`
                        ? 'Saving…'
                        : `Update ${documentKind === 'working' ? 'working' : 'long-term'} memory`}
                    </button>
                  </form>
                )}
              </div>
            );
          })}

          {memory.notes && memory.notes.length > 0 && (
            <div className={`${className}__notes`}>
              <h3>Notes</h3>
              {memory.notes.map((note) => (
                <details key={note.id}>
                  <summary>
                    {note.topic} · {note.kind}
                  </summary>
                  <pre>{note.content}</pre>
                </details>
              ))}
            </div>
          )}

          {memory.operations?.rememberNote && onRememberNote && (
            <form
              className={`${className}__form`}
              onSubmit={(event) => {
                event.preventDefault();
                void run('remember-note', () =>
                  onRememberNote({
                    topic: noteTopic,
                    kind: noteKind,
                    body: noteBody,
                    scope: noteScope,
                  })
                )
                  .then(() => setNoteBody(''))
                  .catch(() => {});
              }}
            >
              <h3>Append note</h3>
              <input
                aria-label="Note topic"
                value={noteTopic}
                onChange={(event) => setNoteTopic(event.target.value)}
                placeholder="Topic"
                required
              />
              <input
                aria-label="Note kind"
                value={noteKind}
                onChange={(event) => setNoteKind(event.target.value)}
                placeholder="Kind"
                required
              />
              <select
                aria-label="Note scope"
                value={noteScope}
                onChange={(event) => setNoteScope(event.target.value as typeof noteScope)}
              >
                <option value="current">Current workspace</option>
                <option value="home">Buddy home</option>
                <option value="all">Current and home</option>
              </select>
              <textarea
                aria-label="Note body"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                placeholder="Evidence or lesson to retain"
                required
                rows={4}
              />
              <button type="submit" disabled={busy !== null}>
                {busy === 'remember-note' ? 'Saving…' : 'Append note'}
              </button>
            </form>
          )}

          {memory.operations?.recall && onRecall && (
            <form
              className={`${className}__form`}
              onSubmit={(event) => {
                event.preventDefault();
                void run('recall', async () => {
                  setRecallResult(await onRecall({ pattern: recallPattern, scope: recallScope }));
                }).catch(() => {});
              }}
            >
              <h3>Recall notes</h3>
              <input
                aria-label="Recall pattern"
                value={recallPattern}
                onChange={(event) => setRecallPattern(event.target.value)}
                placeholder="Search pattern"
                required
              />
              <select
                aria-label="Recall scope"
                value={recallScope}
                onChange={(event) => setRecallScope(event.target.value as typeof recallScope)}
              >
                <option value="all">Current and home</option>
                <option value="current">Current workspace</option>
                <option value="home">Buddy home</option>
              </select>
              <button type="submit" disabled={busy !== null}>
                {busy === 'recall' ? 'Searching…' : 'Recall'}
              </button>
              {recallResult && (
                <div className={`${className}__recall-results`} aria-live="polite">
                  {recallResult.matches.length === 0 ? (
                    <p>No matching notes.</p>
                  ) : (
                    recallResult.matches.map((match) => (
                      <details key={`${match.workspace_id}:${match.path}`}>
                        <summary>{match.path}</summary>
                        <pre>{match.content}</pre>
                      </details>
                    ))
                  )}
                  {recallResult.truncated && <p>Results were capped; narrow the pattern.</p>}
                </div>
              )}
            </form>
          )}
        </>
      ) : (
        <>
          <div className={`${className}__block`}>
            <span>Curated memory</span>
            <pre>{memory.summary || 'No curated memory yet.'}</pre>
          </div>
          {onRememberLegacy && (
            <form
              className={`${className}__form`}
              onSubmit={(event) => {
                event.preventDefault();
                void run('remember', () => onRememberLegacy(legacyKind, legacyContent))
                  .then(() => setLegacyContent(''))
                  .catch(() => {});
              }}
            >
              <h3>Remember</h3>
              <select
                aria-label="Memory kind"
                value={legacyKind}
                onChange={(event) => setLegacyKind(event.target.value as typeof legacyKind)}
              >
                <option value="journal">Journal</option>
                <option value="curated">Curated</option>
              </select>
              <textarea
                aria-label="Memory content"
                value={legacyContent}
                onChange={(event) => setLegacyContent(event.target.value)}
                required
                placeholder="What should this employee retain?"
                rows={4}
              />
              <button type="submit" disabled={busy !== null}>
                {busy === 'remember' ? 'Saving…' : 'Remember'}
              </button>
            </form>
          )}
          {memory.recentJournal.length > 0 && (
            <div className={`${className}__notes`}>
              <h3>Recent journal</h3>
              {memory.recentJournal.map((entry) => (
                <details key={entry.path}>
                  <summary>{entry.path}</summary>
                  <pre>{entry.content}</pre>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
