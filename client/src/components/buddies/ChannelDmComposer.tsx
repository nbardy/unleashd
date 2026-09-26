import { useLayoutEffect, useRef, useState } from 'react';
import { queueMessage } from '../../atoms/actions';
import { uploadFilesWithDrainRetry } from '../../hooks/usePendingAttachments';
import { useConversationDraft } from '../../hooks/useConversationDraft';
import { mediaMarkdown } from './channel-text';
import type { ComposerSubmit } from './ChannelComposer';
import './ChannelComposer.css';

const MAX_TEXTAREA_HEIGHT = 240;

// The thread chat box, sending into a Buddy DM instead of posting to a channel.
// Same field, attach button and Send button as ChannelComposer. Attachments
// upload on the conversation and land in the message as the same image markdown
// a thread post uses, so ChannelMarkdown renders them.
export function ChannelDmComposer({
  conversationId,
  placeholder,
  submit,
  confirmed,
  onSent,
}: {
  conversationId: string;
  placeholder: string;
  submit: ComposerSubmit;
  confirmed: boolean;
  onSent(): void;
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const draft = useConversationDraft({
    conversationId,
    textareaRef,
    controlled: true,
    autoFocus: false,
    maxHeight: MAX_TEXTAREA_HEIGHT,
    onDraftLoaded: setText,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: text is the re-measure trigger
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  const edit = (next: string, caret: number) => {
    setText(next);
    draft.setDraft(next);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(caret, caret));
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
    void uploadFilesWithDrainRetry(conversationId, [...files])
      .then((result) => insertAtCaret(result.files.map(mediaMarkdown).join('\n')))
      .catch((cause: unknown) => setProblem(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setUploading((count) => count - 1));
  };

  const send = () => {
    const body = text.trim();
    if (!body || uploading > 0 || !confirmed) return;
    const unsent = text;
    draft.clear();
    setText('');
    setProblem(null);
    onSent();
    void queueMessage(conversationId, body).catch((cause: unknown) => {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      if (textRef.current.trim().length > 0) return;
      setText(unsent);
      draft.setDraft(unsent);
    });
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
      <div className="channel-composer-field">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            draft.setDraft(event.target.value);
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            upload(files);
          }}
          onKeyDown={(event) => {
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
      </div>
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
          ) : !confirmed ? (
            'Starting…'
          ) : uploading > 0 ? (
            'Uploading…'
          ) : submit === 'enter' ? (
            <>
              <kbd>⇧⏎</kbd> new line
            </>
          ) : null}
        </span>
        <button
          type="button"
          className="channel-composer-send"
          onClick={send}
          disabled={!confirmed || uploading > 0 || text.trim().length === 0}
        >
          Send
        </button>
      </div>
    </div>
  );
}
