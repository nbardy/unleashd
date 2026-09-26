import type { ConversationConfig } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { queueMessage, setConversationDone } from '../../atoms/actions';
import {
  detailOf,
  groupsFamily,
  messagesOf,
  queueOf,
  rowFamily,
  streamFamily,
  transcriptFamily,
} from '../../atoms/conversations';
import { useConversationBodies } from '../../hooks/useConversationBodies';
import { useConversationDraft } from '../../hooks/useConversationDraft';
import { uploadFilesWithDrainRetry } from '../../hooks/usePendingAttachments';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { useTurnDiagnostics } from '../../hooks/useTurnDiagnostics';
import { BuddySigil } from './BuddySigil';
import type { ComposerSubmit } from './ChannelComposer';
import { ChannelLoader } from './ChannelLoader';
import { ChannelMarkdown, TypingDots } from './ChannelMarkdown';
import { CopyLinkButton } from './CopyLinkButton';
import { HarnessPicker } from './HarnessPicker';
import { buddyWrite, errorText } from './api';
import { clockTime, useFollowBottom } from './channel-data';
import { type DmRow, dmRows, lastOwnerText } from './channel-dm';
import { type ChannelTask, mediaMarkdown } from './channel-text';
import './ChannelComposer.css';

// A Buddy DM inside Channels (493c1c7), drawn as a thread: sigil, name, time and ChannelMarkdown
// for both sides, and a channel-style composer. It is still the Buddy's ongoing owner
// conversation. "New chat" starts the next generation without a handoff; earlier generations
// stay above a divider, and a link to an earlier one offers "Latest". An out-of-tokens turn offers
// a retry: a new chat on another harness that resends the owner's last message.
// Desktop and phone differ only in class names (the channel pane vs the phone channel screen).

export type DmFrame = 'desktop' | 'mobile';

// Pattern: table-driven (docs/patterns.md#table-driven)
const FRAMES = {
  desktop: {
    pane: 'channel-browser-pane ui-stack',
    header: 'channel-browser-pane-header ui-row',
    heading: 'channel-browser-pane-title',
    link: 'channel-browser-header-action',
    scroll: 'channel-browser-scroll ui-stack',
    error: 'channel-browser-error',
    list: 'channel-browser-messages',
    day: 'channel-browser-day ui-row',
    lead: 'channel-browser-message channel-browser-message--lead',
    continuation: 'channel-browser-message channel-browser-message--continuation',
    avatar: 'channel-browser-avatar',
    content: 'channel-browser-message-content',
    meta: 'channel-browser-message-heading',
    author: 'channel-browser-author',
    divider: 'channel-thread-divider ui-muted ui-row',
    note: 'channel-thread-replying',
  },
  mobile: {
    pane: 'mobile-channel ui-stack',
    header: 'mobile-channel-header ui-row',
    heading: 'mobile-channel-header__heading',
    link: 'mobile-channel-header__link ui-muted',
    scroll: 'mobile-channel__scroll',
    error: 'mobile-channel__error',
    list: 'mobile-channel__posts',
    day: 'mobile-channel-day',
    lead: 'mobile-channel-post mobile-channel-post--lead',
    continuation: 'mobile-channel-post mobile-channel-post--continuation',
    avatar: 'mobile-channel-post__avatar',
    content: 'mobile-channel-post__content',
    meta: 'mobile-channel-post__heading',
    author: 'mobile-channel-post__author',
    divider: 'mobile-channel-divider ui-row ui-muted',
    note: 'mobile-channel__replying',
  },
} as const;
type Frame = (typeof FRAMES)[DmFrame];

/** GET /api/buddies/:buddyId/direct/chain: live DM generations, oldest first. */
export type DirectChain = { buddyId: string; generations: string[] };

export const directChainUrl = (buddyId: string) =>
  `/api/buddies/${encodeURIComponent(buddyId)}/direct/chain`;

/**
 * "New chat" (or the out-of-tokens retry): the DM's next generation. The earlier ones are marked
 * done, so the sidebar lists only the current chat, as the snapshot's chain filter did; they stay
 * live, so the DM still draws them above the divider and `/chat/:id` still opens them.
 */
export async function startNewDirectChat(
  buddyId: string,
  earlier: readonly string[],
  input: { config: ConversationConfig; message?: string }
): Promise<string> {
  const { conversationId } = await buddyWrite<{ conversationId: string }>(
    `/api/buddies/${encodeURIComponent(buddyId)}/direct/new-chat`,
    'POST',
    input
  );
  for (const id of earlier) setConversationDone(id, true);
  return conversationId;
}

export function ChannelDm({
  conversationId,
  buddyId,
  buddyName,
  buddyRole,
  buddyNames,
  tasks,
  frame,
  linkPath,
  backTo,
  onConversation,
  composeShell,
}: {
  conversationId: string;
  buddyId: string;
  buddyName: string;
  buddyRole: string;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
  frame: DmFrame;
  linkPath: string;
  /** The phone's Back; the desktop pane has the rail instead. */
  backTo: string | null;
  onConversation(nextId: string): void;
  /** The phone wraps the composer in its fullscreen frame. */
  composeShell(composer: ReactNode): ReactNode;
}) {
  const f = FRAMES[frame];
  const row = useAtomValue(rowFamily(conversationId));
  const transcript = useAtomValue(transcriptFamily(conversationId));
  const bodies = useConversationBodies(conversationId);
  const stream = useAtomValue(streamFamily(conversationId));
  const groups = useAtomValue(groupsFamily(conversationId));
  const chain = usePolledFetch<DirectChain>(directChainUrl(buddyId), 15_000);
  const running = row !== null && row.run !== 'idle';
  const diagnostics = useTurnDiagnostics(conversationId, running);
  const queue = queueOf(transcript);
  const messages = messagesOf(transcript);
  const follow = useFollowBottom(messages.length + queue.length, groups, null);
  const generations = chain.data?.generations ?? [conversationId];
  const latest = generations.at(-1) ?? conversationId;
  // An earlier generation shows alone, with a way to the latest; the latest shows every one.
  const shown = latest === conversationId ? generations : [conversationId];
  const newChat = async (input: { config: ConversationConfig; message?: string }) => {
    const next = await startNewDirectChat(buddyId, generations, input);
    await chain.refetch();
    onConversation(next);
  };
  const retryText = lastOwnerText(messages);
  const outOfTokens =
    !running && diagnostics.attempt?.terminalCause === 'out_of_tokens' && retryText !== null;
  return (
    <section className={f.pane} aria-label={`Direct message with ${buddyName}`}>
      <header className={f.header}>
        {backTo !== null && (
          <Link className="mobile-channel-header__back" to={backTo} aria-label="Back">
            ‹
          </Link>
        )}
        <div className={f.heading}>
          {frame === 'desktop' ? <h2>{buddyName}</h2> : <h1>{buddyName}</h1>}
          <p>{buddyRole}</p>
        </div>
        <CopyLinkButton className={f.link} path={linkPath} label="Copy link to DM" />
      </header>
      <div className={f.scroll} ref={follow.scrollRef} onScroll={follow.onScroll}>
        {bodies.error && (
          <p className={f.error} role="alert">
            {bodies.error}
          </p>
        )}
        {row === null ? (
          <ChannelLoader label="Opening DM…" />
        ) : (
          shown.map((id, index) => (
            <DmGeneration
              key={id}
              conversationId={id}
              divider={index > 0}
              frame={f}
              buddyName={buddyName}
              buddyNames={buddyNames}
              tasks={tasks}
            />
          ))
        )}
        {running && stream.length === 0 && (
          <p className={f.note}>
            <TypingDots /> {buddyName} is replying…
          </p>
        )}
        {outOfTokens && (
          <HarnessPicker
            label="Retry with a different harness"
            note="This harness is out of tokens. The retry opens a new chat on the one you pick and resends your last message."
            confirm="Retry"
            seed={null}
            excluded={row?.provider ?? null}
            buddy
            onConfirm={(config) => newChat({ config, message: retryText })}
          />
        )}
        {latest !== conversationId ? (
          <button
            type="button"
            className="channel-inline-action"
            onClick={() => onConversation(latest)}
          >
            Latest chat
          </button>
        ) : (
          messages.length + queue.length > 0 && (
            <HarnessPicker
              label="New chat"
              note={`A new chat with ${buddyName}, with no handoff. This one stays above it.`}
              confirm="Start"
              seed={detailOf(transcript)?.config.config ?? null}
              excluded={null}
              buddy
              onConfirm={(config) => newChat({ config })}
            />
          )
        )}
      </div>
      {composeShell(
        <DmComposer
          conversationId={conversationId}
          placeholder={`Message ${buddyName}`}
          submit={frame === 'desktop' ? 'enter' : 'button'}
          ready={row !== null}
          onSent={follow.pin}
        />
      )}
    </section>
  );
}

function DmGeneration({
  conversationId,
  divider,
  frame,
  buddyName,
  buddyNames,
  tasks,
}: {
  conversationId: string;
  divider: boolean;
  frame: Frame;
  buddyName: string;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
}) {
  useConversationBodies(conversationId);
  const groups = useAtomValue(groupsFamily(conversationId));
  const queue = queueOf(useAtomValue(transcriptFamily(conversationId)));
  const provider = useAtomValue(rowFamily(conversationId))?.provider ?? null;
  const rows = dmRows(groups, queue);
  return (
    <>
      {divider && (
        <div className={frame.divider} title={provider ?? undefined}>
          <span>New chat</span>
        </div>
      )}
      {rows.length === 0 && !divider ? (
        <p className={frame.note}>Send a message to start the conversation.</p>
      ) : (
        <ol className={frame.list}>
          {rows.map((row) => (
            <DmRowView
              key={row.key}
              row={row}
              frame={frame}
              name={row.kind !== 'day' && row.author === 'buddy' ? buddyName : 'You'}
              buddyNames={buddyNames}
              tasks={tasks}
            />
          ))}
        </ol>
      )}
    </>
  );
}

function DmRowView({
  row,
  frame,
  name,
  buddyNames,
  tasks,
}: {
  row: DmRow;
  frame: Frame;
  name: string;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
}) {
  switch (row.kind) {
    case 'day':
      return (
        <li className={frame.day}>
          <span>{row.label}</span>
        </li>
      );
    case 'lead':
      return (
        <li className={frame.lead}>
          <BuddySigil className={frame.avatar} name={name} />
          <div className={frame.content}>
            <div className={frame.meta}>
              <span className={frame.author}>{name}</span>
              <time dateTime={row.at}>{clockTime(row.at)}</time>
            </div>
            <ChannelMarkdown body={row.body} buddyNames={buddyNames} tasks={tasks} />
          </div>
        </li>
      );
    case 'continuation':
      return (
        <li className={frame.continuation}>
          <div className={frame.content}>
            <ChannelMarkdown body={row.body} buddyNames={buddyNames} tasks={tasks} />
          </div>
        </li>
      );
  }
}

const MAX_TEXTAREA_HEIGHT = 240;

// The thread's chat box, sending into the DM conversation instead of posting to a channel. Same
// field, attach and Send; attachments land as the image markdown a post uses.
function DmComposer({
  conversationId,
  placeholder,
  submit,
  ready,
  onSent,
}: {
  conversationId: string;
  placeholder: string;
  submit: ComposerSubmit;
  ready: boolean;
  onSent(): void;
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const change = (next: string) => {
    setText(next);
    draft.setDraft(next);
  };
  const upload = (files: File[]) => {
    if (files.length === 0) return;
    setProblem(null);
    setUploading((count) => count + 1);
    uploadFilesWithDrainRetry(conversationId, files)
      .then((result) => {
        const media = result.files.map(mediaMarkdown).join('\n');
        change(text.trim() ? `${text}\n${media}` : media);
      })
      .catch((cause: unknown) => setProblem(errorText(cause)))
      .finally(() => setUploading((count) => count - 1));
  };
  const send = () => {
    const body = text.trim();
    if (!body || uploading > 0 || !ready) return;
    draft.clear();
    setText('');
    setProblem(null);
    onSent();
    queueMessage(conversationId, body).catch((cause: unknown) => {
      setProblem(errorText(cause));
      change(body);
    });
  };
  return (
    <div className="channel-composer">
      <div className="channel-composer-field">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => change(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            upload(files);
          }}
          onKeyDown={(event) => {
            if (submit !== 'enter' || event.key !== 'Enter' || event.shiftKey) return;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
      </div>
      <div className="channel-composer-bar ui-row">
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
        <span className="channel-composer-hint ui-truncate ui-muted">
          {problem ? (
            <span className="channel-composer-problem" role="alert">
              {problem}
            </span>
          ) : uploading > 0 ? (
            'Uploading…'
          ) : null}
        </span>
        <button
          type="button"
          className="channel-composer-send"
          onClick={send}
          disabled={!ready || uploading > 0 || text.trim().length === 0}
        >
          Send
        </button>
      </div>
    </div>
  );
}
