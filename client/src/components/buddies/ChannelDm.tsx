import {
  type ConversationConfig,
  type ProviderCatalog,
  getBuddyContext,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type ReactNode, type RefObject, type UIEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadConversationDetails, setActiveConversationId } from '../../atoms/actions';
import { setConversationConfig } from '../../atoms/config-actions';
import { dmTranscriptGroupsAtomFamily } from '../../atoms/dm-chain';
import {
  conversationAtomFamily,
  conversationDetailsLoadedAtomFamily,
  pendingConfigCommandAtomFamily,
  streamingAtomFamily,
} from '../../atoms/conversations';
import { markMessagesSeen, setSavedActiveConversationId } from '../../atoms/ui';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { useRestartRecovery } from '../../hooks/useRestartRecovery';
import { useTurnDiagnostics } from '../../hooks/useTurnDiagnostics';
import { RestartRecoveryPrompt } from '../../restart/RestartRecoveryPrompt';
import { ConversationConfigPicker } from '../ConversationConfigPicker';
import { ChannelDmComposer } from './ChannelDmComposer';
import { DmTranscript, type DmFrame } from './ChannelDmTranscript';
import { CopyLinkButton } from './CopyLinkButton';
import { OutOfTokensChatRetry } from './HarnessRetry';
import { ChannelLoader } from './ChannelLoader';
import { TypingDots } from './ChannelMarkdown';
import { useDmSplit } from './buddy-direct-actions';
import { type DmQueued, dmTranscriptRows } from './channel-dm';
import { useFollowBottom } from './channel-data';
import { channelLinkPath } from './channel-link';
import type { ChannelTask } from './channel-text';
import './DmNewChat.css';

const EMPTY_QUEUE: readonly DmQueued[] = [];

// A Buddy DM inside Channels. The transcript and the chat box are the thread's,
// not the conversation page: sigil, name, time, ChannelMarkdown, ChannelComposer.
// The messages are still that Buddy's one ongoing owner conversation.
export function ChannelDm({
  conversationId,
  workspaceId,
  buddyName,
  buddyRole,
  buddyNames,
  tasks,
  frame,
  backTo,
  onConversation,
  composeShell,
}: {
  conversationId: string;
  workspaceId: string;
  buddyName: string;
  buddyRole: string;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
  frame: DmFrame;
  backTo?: string;
  onConversation(nextId: string): void;
  composeShell?: (composer: ReactNode) => ReactNode;
}) {
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const detailsLoaded = useAtomValue(conversationDetailsLoadedAtomFamily(conversationId));
  const groups = useAtomValue(dmTranscriptGroupsAtomFamily(conversationId));
  const streamingText = useAtomValue(streamingAtomFamily(conversationId));
  const pendingConfig = useAtomValue(pendingConfigCommandAtomFamily(conversationId));
  const dmSplit = useDmSplit(conversationId);
  const { catalog } = useProviderCatalog();
  const [detailError, setDetailError] = useState<string | null>(null);
  const isRunning = conversation?.isRunning ?? false;
  const isStreaming = conversation?.isStreaming ?? false;
  const runtimeTurnActive = isRunning || isStreaming;
  const { attempt } = useTurnDiagnostics(conversationId, runtimeTurnActive);
  const restartRecovery = useRestartRecovery(conversationId, attempt, runtimeTurnActive);
  const queue = conversation?.queue ?? EMPTY_QUEUE;
  const liveTail =
    streamingText.length > 0 && groups.at(-1)?.type !== 'assistant' ? streamingText : null;
  const rows = useMemo(
    () => dmTranscriptRows(groups, queue, liveTail),
    [groups, queue, liveTail]
  );
  const follow = useFollowBottom(rows.length + (runtimeTurnActive ? 1 : 0), groups, null);
  const messageCount = conversation?.messages.length ?? 0;
  const confirmed = conversation?.confirmed ?? false;
  const showHarness =
    dmSplit.role === 'current' &&
    dmSplit.priorIds.length > 0 &&
    confirmed &&
    messageCount === 0 &&
    queue.length === 0 &&
    !runtimeTurnActive;
  const showNewChat =
    dmSplit.role === 'current' &&
    (messageCount > 0 || queue.length > 0 || dmSplit.priorIds.length > 0);

  useEffect(() => {
    setActiveConversationId(conversationId);
    setSavedActiveConversationId(conversationId);
    return () => setActiveConversationId(null);
  }, [conversationId]);

  useEffect(() => {
    if (!conversation || detailsLoaded) {
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    void loadConversationDetails(conversationId).catch((cause: unknown) => {
      if (!cancelled) setDetailError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [conversation, conversationId, detailsLoaded]);

  useEffect(() => {
    if (!detailsLoaded || messageCount === 0) return;
    markMessagesSeen(conversationId, messageCount - 1);
  }, [conversationId, detailsLoaded, messageCount]);

  const desktop = frame === 'desktop';
  const shell = composeShell ?? ((node: ReactNode) => node);
  const linkPath = channelLinkPath(workspaceId, { kind: 'dm', conversationId });
  const showTranscript = conversation !== null && detailsLoaded;
  const replying =
    runtimeTurnActive && streamingText.length === 0 ? `${buddyName} is replying…` : null;

  return desktop ? (
    <section className="channel-browser-pane" aria-label={`Direct message with ${buddyName}`}>
      <header className="channel-browser-pane-header">
        <div className="channel-browser-pane-title">
          <h2>{buddyName}</h2>
          <p>{buddyRole}</p>
        </div>
        <DmHeaderActions
          desktop
          showNewChat={showNewChat}
          pending={dmSplit.pending}
          latestId={dmSplit.role === 'prior' ? dmSplit.currentId : null}
          linkPath={linkPath}
          onNewChat={() => {
            void dmSplit.startNewChat().then((nextId) => {
              if (nextId) onConversation(nextId);
            });
          }}
          onConversation={onConversation}
        />
      </header>
      <DmScroll
        desktop
        scrollRef={follow.scrollRef}
        onScroll={follow.onScroll}
        detailError={detailError}
        showTranscript={showTranscript}
        opening={conversation === null}
        rows={rows}
        buddyName={buddyName}
        buddyNames={buddyNames}
        tasks={tasks}
        replying={replying}
        retry={
          conversation ? (
            <OutOfTokensChatRetry
              conversationId={conversation.id}
              terminalCause={attempt?.terminalCause ?? null}
              turnActive={runtimeTurnActive}
              messages={conversation.messages}
              workingDirectory={conversation.workingDirectory}
              provider={conversation.provider ?? null}
              requiresBuddyMcp={Boolean(getBuddyContext(conversation))}
              swarmDebugPrefix={conversation.swarmDebugPrefix ?? undefined}
              buddyContext={getBuddyContext(conversation) ?? undefined}
              onStarted={onConversation}
            />
          ) : null
        }
      />
      {dmSplit.error ? (
        <p className="channel-browser-error" role="alert">
          {dmSplit.error}
        </p>
      ) : null}
      {showHarness && conversation ? (
        <DmHarness
          catalog={catalog}
          config={conversation.config ?? null}
          disabled={Boolean(pendingConfig && !pendingConfig.error)}
          onChange={(config) =>
            saveHarness(conversation.id, conversation.configRevision, config, catalog)
          }
        />
      ) : null}
      {restartRecovery ? <RestartRecoveryPrompt recovery={restartRecovery} /> : null}
      {shell(
        <ChannelDmComposer
          conversationId={conversationId}
          placeholder={`Message ${buddyName}`}
          submit="enter"
          confirmed={confirmed}
          onSent={follow.pin}
        />
      )}
    </section>
  ) : (
    <div className="mobile-channel" aria-label={`Direct message with ${buddyName}`}>
      <header className="mobile-channel-header">
        {backTo ? (
          <Link className="mobile-channel-header__back" to={backTo} aria-label="Back">
            ‹
          </Link>
        ) : null}
        <div className="mobile-channel-header__heading mobile-channel-dm-heading">
          <h1>{buddyName}</h1>
          <p>{buddyRole}</p>
        </div>
        <DmHeaderActions
          desktop={false}
          showNewChat={showNewChat}
          pending={dmSplit.pending}
          latestId={dmSplit.role === 'prior' ? dmSplit.currentId : null}
          linkPath={linkPath}
          onNewChat={() => {
            void dmSplit.startNewChat().then((nextId) => {
              if (nextId) onConversation(nextId);
            });
          }}
          onConversation={onConversation}
        />
      </header>
      <DmScroll
        desktop={false}
        scrollRef={follow.scrollRef}
        onScroll={follow.onScroll}
        detailError={detailError}
        showTranscript={showTranscript}
        opening={conversation === null}
        rows={rows}
        buddyName={buddyName}
        buddyNames={buddyNames}
        tasks={tasks}
        replying={replying}
        retry={
          conversation ? (
            <OutOfTokensChatRetry
              conversationId={conversation.id}
              terminalCause={attempt?.terminalCause ?? null}
              turnActive={runtimeTurnActive}
              messages={conversation.messages}
              workingDirectory={conversation.workingDirectory}
              provider={conversation.provider ?? null}
              requiresBuddyMcp={Boolean(getBuddyContext(conversation))}
              swarmDebugPrefix={conversation.swarmDebugPrefix ?? undefined}
              buddyContext={getBuddyContext(conversation) ?? undefined}
              onStarted={onConversation}
            />
          ) : null
        }
      />
      {dmSplit.error ? (
        <p className="mobile-channel__error" role="alert">
          {dmSplit.error}
        </p>
      ) : null}
      {showHarness && conversation ? (
        <DmHarness
          catalog={catalog}
          config={conversation.config ?? null}
          disabled={Boolean(pendingConfig && !pendingConfig.error)}
          onChange={(config) =>
            saveHarness(conversation.id, conversation.configRevision, config, catalog)
          }
        />
      ) : null}
      {restartRecovery ? <RestartRecoveryPrompt recovery={restartRecovery} /> : null}
      {shell(
        <ChannelDmComposer
          conversationId={conversationId}
          placeholder={`Message ${buddyName}`}
          submit="button"
          confirmed={confirmed}
          onSent={follow.pin}
        />
      )}
    </div>
  );
}

function DmHarness({
  catalog,
  config,
  disabled,
  onChange,
}: {
  catalog: ProviderCatalog | null;
  config: ConversationConfig | null;
  disabled: boolean;
  onChange(config: ConversationConfig): void;
}) {
  return (
    <div className="dm-new-chat__harness">
      <p className="dm-new-chat__harness-label">Harness for this chat</p>
      {catalog && config ? (
        <ConversationConfigPicker
          value={config}
          catalog={catalog}
          disabled={disabled}
          inlineDefaults
          providerFilter={(providerId) =>
            providerId === config.provider ||
            catalog.providers.some(
              (provider) => provider.id === providerId && provider.supportsRequiredMcp
            )
          }
          onChange={onChange}
        />
      ) : (
        <p className="dm-new-chat__harness-label">Loading harness options…</p>
      )}
    </div>
  );
}

function saveHarness(
  conversationId: string,
  expectedRevision: number,
  config: ConversationConfig,
  catalog: ProviderCatalog | null
) {
  const provider = catalog?.providers.find((item) => item.id === config.provider);
  const modelId =
    config.model.mode === 'explicit' ? config.model.modelId : provider?.defaultModelId;
  const model = provider?.models.find((item) => item.id === modelId);
  setConversationConfig({
    conversationId,
    expectedRevision,
    patch: {
      kind: 'replace',
      config: {
        ...config,
        reasoning:
          config.reasoning.mode === 'explicit' &&
          !model?.reasoning?.levels.includes(config.reasoning.effort)
            ? { mode: 'default' }
            : config.reasoning,
      },
    },
  });
}

function DmHeaderActions({
  desktop,
  showNewChat,
  pending,
  latestId,
  linkPath,
  onNewChat,
  onConversation,
}: {
  desktop: boolean;
  showNewChat: boolean;
  pending: boolean;
  latestId: string | null;
  linkPath: string;
  onNewChat(): void;
  onConversation(nextId: string): void;
}) {
  const buttonClass = desktop ? 'channel-dm-new' : 'mobile-channel-dm-new';
  return (
    <div className={desktop ? 'channel-thread-header-actions' : 'mobile-channel-dm-actions'}>
      {latestId ? (
        <button type="button" className={buttonClass} onClick={() => onConversation(latestId)}>
          Latest
        </button>
      ) : showNewChat ? (
        <button type="button" className={buttonClass} disabled={pending} onClick={onNewChat}>
          {pending ? 'Starting…' : 'New chat'}
        </button>
      ) : null}
      <CopyLinkButton
        className={desktop ? 'channel-browser-header-action' : 'mobile-channel-header__link'}
        path={linkPath}
        label="Copy link to DM"
      />
    </div>
  );
}

function DmScroll({
  desktop,
  scrollRef,
  onScroll,
  detailError,
  showTranscript,
  opening,
  rows,
  buddyName,
  buddyNames,
  tasks,
  replying,
  retry,
}: {
  desktop: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  detailError: string | null;
  showTranscript: boolean;
  opening: boolean;
  rows: ReturnType<typeof dmTranscriptRows>;
  buddyName: string;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
  replying: string | null;
  retry: ReactNode;
}) {
  return (
    <div
      className={desktop ? 'channel-browser-scroll' : 'mobile-channel__scroll'}
      ref={scrollRef}
      onScroll={onScroll}
    >
      {detailError ? (
        <p className={desktop ? 'channel-browser-error' : 'mobile-channel__error'} role="alert">
          {detailError}
        </p>
      ) : null}
      {showTranscript ? (
        rows.length === 0 ? (
          <p className={desktop ? 'channel-dm-empty' : 'mobile-channel-dm-empty'}>
            Send a message to start the conversation.
          </p>
        ) : (
          <DmTranscript
            rows={rows}
            buddyName={buddyName}
            frame={desktop ? 'desktop' : 'mobile'}
            buddyNames={buddyNames}
            tasks={tasks}
          />
        )
      ) : (
        <ChannelLoader label={opening ? 'Opening DM…' : 'Loading conversation…'} />
      )}
      {showTranscript ? retry : null}
      {replying ? (
        <p className={desktop ? 'channel-thread-replying' : 'mobile-channel__replying'}>
          <TypingDots /> {replying}
        </p>
      ) : null}
    </div>
  );
}
