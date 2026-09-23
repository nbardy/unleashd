import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../utils/ids';
import type { BuddyMailingListPost } from './BuddyMessages';
import { BuddySigil } from './BuddySigil';
import { buddyApi } from './api';
import {
  type ChannelReference,
  activeReferenceQuery,
  encodeReferences,
  insertReference,
  mediaMarkdown,
  rankReferences,
} from './channel-text';
import './ChannelComposer.css';

export type MentionDispatch =
  | { buddyId: string; status: 'started'; conversationId: string }
  | { buddyId: string; status: 'rejected'; reason: string };

export type PostResult = { post: BuddyMailingListPost; mentions: MentionDispatch[] };

type UploadedFile = { originalName: string; absolutePath: string };

const MAX_TEXTAREA_HEIGHT = 240;

// The owner's composer. Posts as the owner (never a stand-in Buddy). One
// universal @ menu fuzzy-finds Buddies and Tasks: a Buddy becomes a mention
// (which starts that Buddy's reply), a Task becomes a live chip. Pasted or
// dropped images/videos upload into the channel and are inserted as inline
// markdown at the caret.
//
// submit: 'enter' (desktop — Enter sends, Shift+Enter breaks a line) or
// 'button' (touch — Return is a newline, as in Slack mobile; Send sends).
export type ComposerSubmit = 'enter' | 'button';

export function ChannelComposer({
  listId,
  placeholder,
  threadRootId,
  references,
  submit,
  onPosted,
}: {
  listId: string;
  placeholder: string;
  threadRootId: string | null;
  references: readonly ChannelReference[];
  submit: ComposerSubmit;
  onPosted(result: PostResult): void;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<ChannelReference[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trigger = activeReferenceQuery(text, caret);
  const open = trigger !== null && trigger.start !== dismissedAt;
  const query = open && trigger ? trigger.query : null;
  const matches = useMemo(
    () => (query === null ? [] : rankReferences(query, references)),
    [query, references]
  );
  const showPicker = open && matches.length > 0;
  const selected = matches[Math.min(highlight, matches.length - 1)];

  // Grow with the text up to a cap, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text is the re-measure trigger
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  const edit = (next: string, nextCaret: number) => {
    setText(next);
    setCaret(nextCaret);
    setHighlight(0);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node) node.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const pick = (reference: ChannelReference) => {
    if (!trigger) return;
    const result = insertReference(text, trigger, reference);
    setPicked((current) => [...current, reference]);
    edit(result.text, result.caret);
    textareaRef.current?.focus();
  };

  const insertAtCaret = (snippet: string) => {
    const node = textareaRef.current;
    const at = node?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const spacer = before.length === 0 || /\s$/.test(before) ? '' : '\n';
    const inserted = `${spacer}${snippet}\n`;
    edit(before + inserted + text.slice(at), at + inserted.length);
  };

  const upload = (files: readonly File[]) => {
    if (files.length === 0) return;
    setProblem(null);
    setUploading((count) => count + 1);
    const form = new FormData();
    for (const file of files) form.append('files', file);
    void buddyApi<{ files: UploadedFile[] }>(
      `/api/buddies/lists/${encodeURIComponent(listId)}/media`,
      { method: 'POST', body: form }
    )
      .then((result) => insertAtCaret(result.files.map(mediaMarkdown).join('\n')))
      .catch((cause: unknown) => setProblem(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setUploading((count) => count - 1));
  };

  const send = () => {
    const body = encodeReferences(text, picked).trim();
    if (!body || sending || uploading > 0) return;
    setSending(true);
    setProblem(null);
    void buddyApi<PostResult>(`/api/buddies/lists/${encodeURIComponent(listId)}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        author: { kind: 'owner' },
        key: newId(),
        purpose: 'message',
        body,
        threadRootId,
      }),
    })
      .then((result) => {
        setText('');
        setCaret(0);
        setPicked([]);
        onPosted(result);
      })
      .catch((cause: unknown) => setProblem(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSending(false));
  };

  return (
    <div
      className="channel-composer"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setDragging(false);
        upload([...event.dataTransfer.files]);
      }}
    >
      {showPicker && (
        <ul className="channel-composer-picker" aria-label="Mention a Buddy or Task">
          {matches.map((reference, index) => (
            <li key={`${reference.kind}:${reference.id}`}>
              <button
                type="button"
                data-selected={reference === selected || undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(reference);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <ReferenceIcon reference={reference} />
                <span className="channel-composer-picker-label">{reference.label}</span>
                <span className="channel-composer-picker-detail">{reference.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart);
          setHighlight(0);
          setDismissedAt(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (files.length === 0) return;
          event.preventDefault();
          upload(files);
        }}
        onKeyDown={(event) => {
          if (showPicker) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setHighlight((index) => (index + step + matches.length) % matches.length);
              return;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && selected) {
              event.preventDefault();
              pick(selected);
              return;
            }
            if (event.key === 'Escape' && trigger) {
              event.preventDefault();
              setDismissedAt(trigger.start);
              return;
            }
          }
          if (
            submit === 'enter' &&
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="channel-composer-bar">
        <button
          type="button"
          className="channel-composer-attach"
          onClick={() => fileInputRef.current?.click()}
          title="Attach images or video"
          aria-label="Attach images or video"
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          hidden
          onChange={(event) => {
            upload([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <span className="channel-composer-hint">
          {problem ? (
            <span className="channel-composer-problem" role="alert">
              {problem}
            </span>
          ) : uploading > 0 ? (
            'Uploading…'
          ) : (
            <SubmitHint submit={submit} />
          )}
        </span>
        <button
          type="button"
          className="channel-composer-send"
          onClick={send}
          disabled={sending || uploading > 0 || text.trim().length === 0}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function ReferenceIcon({ reference }: { reference: ChannelReference }) {
  switch (reference.kind) {
    case 'buddy':
      return <BuddySigil className="channel-composer-picker-icon" name={reference.label} />;
    case 'task':
      return (
        <span
          className="channel-composer-picker-icon channel-composer-picker-task"
          aria-hidden="true"
        >
          {reference.status === 'done' ? '✓' : '◇'}
        </span>
      );
  }
}

function SubmitHint({ submit }: { submit: ComposerSubmit }) {
  switch (submit) {
    case 'enter':
      return (
        <>
          <kbd>@</kbd> mention a Buddy or Task · <kbd>⇧⏎</kbd> new line
        </>
      );
    case 'button':
      return (
        <>
          <kbd>@</kbd> mention a Buddy or Task
        </>
      );
  }
}
