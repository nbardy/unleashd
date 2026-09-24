import {
  type BuddyOwnerPostResult,
  BuddyOwnerPostResultSchema,
  type ConversationConfig,
  type OwnerPostMentionConfig,
  type ProviderCatalog,
} from '@unleashd/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { newId } from '../../utils/ids';
import { ConversationConfigPicker } from '../ConversationConfigPicker';
import { BuddySigil } from './BuddySigil';
import { buddyApi } from './api';
import {
  type BuddyReference,
  type ChannelReference,
  activeReferenceQuery,
  completesPickedReference,
  encodeReferences,
  insertReference,
  mediaMarkdown,
  mentionedBuddies,
  rankReferences,
} from './channel-text';
import './ChannelComposer.css';

type UploadedFile = { originalName: string; absolutePath: string };

const MAX_TEXTAREA_HEIGHT = 240;

const NO_CHOICES: ReadonlyMap<string, ConversationConfig> = new Map();

// The owner's composer. Posts as the owner (never a stand-in Buddy). One
// universal @ menu fuzzy-finds Buddies and Tasks: a Buddy becomes a mention
// (which starts that Buddy's reply), a Task becomes a live chip. Pasted or
// dropped images/videos upload into the channel and are inserted as inline
// markdown at the caret.
//
// Every Buddy the text mentions gets a chip on the bar; clicking it opens the
// chat's harness/model picker for that Buddy's reply. The choice is sent
// beside the post (mentionConfigs) and applies to that one reply: every
// mention starts a fresh conversation (channel-responder.ts).
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
  onPosted(result: BuddyOwnerPostResult): void;
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
  const [choices, setChoices] = useState(NO_CHOICES);
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  const { catalog } = useProviderCatalog();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trigger = activeReferenceQuery(text, caret);
  const open =
    trigger !== null &&
    trigger.start !== dismissedAt &&
    !completesPickedReference(trigger.query, picked, references);
  const query = open && trigger ? trigger.query : null;
  const matches = useMemo(
    () => (query === null ? [] : rankReferences(query, references)),
    [query, references]
  );
  const selected = matches[Math.min(highlight, matches.length - 1)];
  const mentions = useMemo(() => mentionedBuddies(text, picked), [text, picked]);
  const choosing = mentions.find((buddy) => buddy.id === choosingFor);
  // The model picker and the @ menu share the space above the composer.
  const showPicker = open && matches.length > 0 && !choosing;

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
    // React's onSelect fires during the same keydown (Enter in the @ menu)
    // with the DOM caret from BEFORE the edit, overwriting the caret set
    // above; the menu then saw an empty query and stayed open after a pick.
    // Re-assert the caret once the DOM selection matches.
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
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
    const mentionConfigs = mentions.flatMap((buddy): OwnerPostMentionConfig[] => {
      const config = choices.get(buddy.id);
      return config ? [{ buddyId: buddy.id, config }] : [];
    });
    setSending(true);
    setProblem(null);
    void buddyApi(`/api/buddies/lists/${encodeURIComponent(listId)}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        author: { kind: 'owner' },
        key: newId(),
        purpose: 'message',
        body,
        threadRootId,
        mentionConfigs,
      }),
    })
      .then((response) => {
        const result = BuddyOwnerPostResultSchema.parse(response);
        setText('');
        setCaret(0);
        setPicked([]);
        setChoices(NO_CHOICES);
        setChoosingFor(null);
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
      {choosing && (
        <MentionModelPopover
          buddy={choosing}
          choice={mentionChoice(choosing, choices)}
          catalog={catalog}
          onChange={(config) => setChoices(new Map(choices).set(choosing.id, config))}
          onReset={() => {
            const next = new Map(choices);
            next.delete(choosing.id);
            setChoices(next);
          }}
          onClose={() => {
            setChoosingFor(null);
            textareaRef.current?.focus();
          }}
        />
      )}
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
        {mentions.length > 0 && (
          <div className="channel-composer-mentions">
            {mentions.map((buddy) => (
              <MentionChip
                key={buddy.id}
                buddy={buddy}
                choice={mentionChoice(buddy, choices)}
                catalog={catalog}
                open={buddy.id === choosingFor}
                onOpen={() => setChoosingFor(buddy.id === choosingFor ? null : buddy.id)}
              />
            ))}
          </div>
        )}
        <span className="channel-composer-hint">
          {problem ? (
            <span className="channel-composer-problem" role="alert">
              {problem}
            </span>
          ) : uploading > 0 ? (
            'Uploading…'
          ) : mentions.length > 0 ? null : (
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

// What a mentioned Buddy's reply will run on, as the chip and picker see it.
// `profile` is the Buddy's profile default: every mention starts a fresh
// conversation, so an unchosen reply runs on it even inside a thread. `unreported` is a backend that predates
// execution on members; there is nothing honest to open the picker at.
type MentionChoice =
  | { kind: 'chosen'; config: ConversationConfig }
  | { kind: 'profile'; profile: ConversationConfig }
  | { kind: 'unreported' };

function mentionChoice(
  buddy: BuddyReference,
  choices: ReadonlyMap<string, ConversationConfig>
): MentionChoice {
  const chosen = choices.get(buddy.id);
  if (chosen) return { kind: 'chosen', config: chosen };
  switch (buddy.execution.kind) {
    case 'profile':
      return { kind: 'profile', profile: buddy.execution.config };
    case 'unreported':
      return { kind: 'unreported' };
  }
}

function configLabel(config: ConversationConfig, catalog: ProviderCatalog | null): string {
  const provider = catalog?.providers.find((candidate) => candidate.id === config.provider);
  const modelId =
    config.model.mode === 'explicit' ? config.model.modelId : provider?.defaultModelId;
  const model = provider?.models.find((candidate) => candidate.id === modelId);
  // Model names already carry their family ("Claude Opus 5.5"); the picker
  // shows the harness.
  return model?.displayName ?? modelId ?? `${config.provider} default`;
}

function choiceLabel(choice: MentionChoice, catalog: ProviderCatalog | null): string {
  switch (choice.kind) {
    case 'chosen':
      return configLabel(choice.config, catalog);
    case 'profile':
      return configLabel(choice.profile, catalog);
    case 'unreported':
      return 'default';
  }
}

// Where the picker opens: the pick so far, else the profile default. Null
// only for `unreported`, whose chip is disabled.
function pickerValue(choice: MentionChoice): ConversationConfig | null {
  switch (choice.kind) {
    case 'chosen':
      return choice.config;
    case 'profile':
      return choice.profile;
    case 'unreported':
      return null;
  }
}

function MentionChip({
  buddy,
  choice,
  catalog,
  open,
  onOpen,
}: {
  buddy: BuddyReference;
  choice: MentionChoice;
  catalog: ProviderCatalog | null;
  open: boolean;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      className="channel-composer-mention"
      data-chosen={choice.kind === 'chosen' || undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={choice.kind === 'unreported'}
      title={
        choice.kind === 'unreported'
          ? 'Model choice needs a server restart'
          : `Choose the harness and model for ${buddy.label}’s reply`
      }
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      <BuddySigil className="channel-composer-mention-sigil" name={buddy.label} />
      <span className="channel-composer-mention-name">{buddy.label}</span>
      <span className="channel-composer-mention-model">{choiceLabel(choice, catalog)}</span>
    </button>
  );
}

function MentionModelPopover({
  buddy,
  choice,
  catalog,
  onChange,
  onReset,
  onClose,
}: {
  buddy: BuddyReference;
  choice: MentionChoice;
  catalog: ProviderCatalog | null;
  onChange(config: ConversationConfig): void;
  onReset(): void;
  onClose(): void;
}) {
  const value = pickerValue(choice);
  return (
    <>
      <button
        type="button"
        className="channel-composer-model-backdrop"
        aria-label="Close model picker"
        tabIndex={-1}
        onClick={onClose}
      />
      <dialog
        open
        className="channel-composer-model"
        aria-label={`Model for ${buddy.label}`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onClose();
        }}
      >
        <div className="channel-composer-model-head">
          <BuddySigil className="channel-composer-mention-sigil" name={buddy.label} />
          <strong>{buddy.label}</strong>
          <span>replies on</span>
        </div>
        {catalog && value ? (
          <ConversationConfigPicker
            value={value}
            catalog={catalog}
            // Buddy turns need the Buddy MCP tools.
            providerFilter={(providerId) =>
              catalog.providers.some(
                (provider) => provider.id === providerId && provider.supportsRequiredMcp
              )
            }
            onChange={onChange}
          />
        ) : (
          <p className="channel-composer-model-note">Loading harness options…</p>
        )}
        <p className="channel-composer-model-note">
          {`Applies to ${buddy.label}’s reply to this message. Each mention starts a fresh conversation from the thread.`}
        </p>
        <div className="channel-composer-model-actions">
          <button type="button" onClick={onReset} disabled={choice.kind !== 'chosen'}>
            Use default
          </button>
          <button type="button" className="channel-composer-model-done" onClick={onClose}>
            Done
          </button>
        </div>
      </dialog>
    </>
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
