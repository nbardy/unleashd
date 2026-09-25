// Solarized Dark theme for syntax highlighting - matches app aesthetic
// highlight.js + katex stylesheets load lazily with their plugins —
// see utils/lazyMarkdownPlugins.ts. Do not re-add a static CSS import here.
import type { BuddyContext, ConversationRow } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  cancelQueuedMessage,
  clearQueue,
  interruptAndSend,
  promoteQueuedMessage,
  queueMessage,
  setActiveConversationId,
} from '../atoms/actions';
import type { QueuedMessage } from '../atoms/actions';
import { setConversationConfig } from '../atoms/config-actions';
import {
  chatMessageGroupsAtomFamily,
  childConversationsAtomFamily,
  conversationAtomFamily,
  conversationDetailAtomFamily,
  conversationLoadCompleteAtom,
  conversationMessagesAtomFamily,
  hasConversationsAtom,
  pendingConfigCommandAtomFamily,
  pendingCreationAtomFamily,
  queueAtomFamily,
  streamingAtomFamily,
  subAgentsAtomFamily,
} from '../atoms/conversations';
import { forkConversation } from '../atoms/fork-actions';
import { markMessagesSeen, setSavedActiveConversationId } from '../atoms/ui';
import { useComposerSubmission } from '../hooks/useComposerSubmission';
import { useConversationBodies } from '../hooks/useConversationBodies';
import { useConversationDraft } from '../hooks/useConversationDraft';
import { usePendingAttachments } from '../hooks/usePendingAttachments';
import { useProviderCatalog } from '../hooks/useProviderCatalog';
import { useRestartRecovery } from '../hooks/useRestartRecovery';
import { useSavedPrompts } from '../hooks/useSavedPrompts';
import { useTurnDiagnostics } from '../hooks/useTurnDiagnostics';
import { RestartRecoveryPrompt } from '../restart/RestartRecoveryPrompt';
import { copyText } from '../utils/clipboard';
import { buildThreadTranscript } from '../utils/conversation-transcript';
import { buildUnifiedSubAgents } from '../utils/subAgents';
import { formatTimeAgo } from '../utils/time';
import { BuddyConvoHeader } from './BuddyConvoHeader';
import { ContextBreakdownMeter } from './ContextBreakdownMeter';
import { ConversationConfigPicker } from './ConversationConfigPicker';
import { PromptPalette } from './PromptPalette';
import { ResumeThreadWidget } from './ResumeThreadWidget';
import { SubAgentPanel } from './SubAgentPanel';
import { SwarmConvoPrefix } from './SwarmConvoPrefix';
import { TurnStatus } from './TurnStatus';
import { VirtualizedMessageList } from './VirtualizedMessageList';
import {
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
} from './turn-diagnostics';
import './Chat.css';
import { useTimeTick } from '../hooks/useTimeTick';
import { shortenHomePath } from '../utils/directories';

// Stable reference for empty queue — avoids new [] on every render triggering re-renders
const BUDDY_STARTER_PROMPTS = [
  'Create a Buddy who owns product research for my team.',
  'Create a team for this workspace: a researcher, a designer, and an engineer.',
] as const;

// Deprecated helper kept for local parity — use getBuddyContext (kind-aware) instead.
// The holistic kind type is the canonical source; legacy buddyContext is compat only.
// The Buddy header needs only the ids the row carries (the run data stays on
// the server since T09).
function headerBuddyContext(kind: ConversationRow['kind'] | undefined): BuddyContext | undefined {
  return kind?.t === 'buddy'
    ? { buddyId: kind.buddyId, workspaceId: kind.workspaceId, buddyProjectId: null }
    : undefined;
}

/**
 * Returns a live-updating "time ago" string for a Date.
 * Ticks every 30s to stay reasonably current without excessive renders.
 */
function useTimeAgo(date: Date | undefined): string | null {
  useTimeTick();
  if (!date) return null;
  return formatTimeAgo(date);
}

// The desktop /chat/:id page.
export function ChatRoute() {
  const { id = '' } = useParams<{ id: string }>();
  return <Chat id={id} />;
}

// One conversation, by id: the /chat page and the DM pane inside the desktop
// channels view (ChannelBrowser) both render it.
export function Chat({ id }: { id: string }) {
  const navigate = useNavigate();

  // Per-ID atoms — only re-render when THIS conversation changes, not others
  const conversation = useAtomValue(conversationAtomFamily(id ?? ''));
  const detail = useAtomValue(conversationDetailAtomFamily(id ?? ''));
  const messages = useAtomValue(conversationMessagesAtomFamily(id ?? ''));
  const subAgents = useAtomValue(subAgentsAtomFamily(id ?? ''));
  const { loaded: conversationDetailsLoaded, error: detailLoadError } = useConversationBodies(
    id || null
  );
  const conversationLoadComplete = useAtomValue(conversationLoadCompleteAtom);
  const pendingCreation = useAtomValue(pendingCreationAtomFamily(id ?? ''));
  const pendingConfigCommand = useAtomValue(pendingConfigCommandAtomFamily(id ?? ''));
  const configIsSaving = !!pendingConfigCommand && !pendingConfigCommand.error;
  const streamingText = useAtomValue(streamingAtomFamily(id ?? ''));
  const childSessionConversations = useAtomValue(childConversationsAtomFamily(id ?? ''));
  const hasConversations = useAtomValue(hasConversationsAtom);
  const queue: readonly QueuedMessage[] = useAtomValue(queueAtomFamily(id ?? ''));
  const resumedFromConversationId = conversation?.resumedFrom ?? '';
  const resumedFromConversation = useAtomValue(conversationAtomFamily(resumedFromConversationId));

  const {
    catalog,
    isLoading: catalogIsLoading,
    error: catalogError,
    retry: retryCatalog,
  } = useProviderCatalog();
  // Header shows a compact "Opus 5 · High" summary; the full provider/model/
  // reasoning pickers only mount once the summary is expanded.
  const [headerConfigExpanded, setHeaderConfigExpanded] = useState(false);
  const configPickerRef = useRef<HTMLDialogElement>(null);

  // Click-outside / Escape closes the harness popup.
  useEffect(() => {
    if (!headerConfigExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (configPickerRef.current && !configPickerRef.current.contains(target)) {
        setHeaderConfigExpanded(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHeaderConfigExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [headerConfigExpanded]);

  const {
    savePrompt,
    prompts: savedPrompts,
    fuzzySearch,
    incrementUsage,
    deletePrompt,
  } = useSavedPrompts();
  const [hasInput, setHasInput] = useState(false);
  const [threadCopied, setThreadCopied] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  // Portable draft persistence — same hook mobile uses (localStorage `draft:{id}`).
  // Handles debounced save, flush on pagehide/visibility/HMR, and focus restore
  // without stale-closure bug (refs only).
  const draft = useConversationDraft({
    conversationId: id,
    textareaRef,
    maxHeight: 300,
    autoFocus: true,
    onDraftLoaded: (value) => setHasInput(value.trim().length > 0),
    onDraftChange: (value) => setHasInput(value.trim().length > 0),
  });
  const { setDraft: setDraftValue } = draft;

  // Shared attachment lifecycle — same hook mobile ComposerMobile uses so
  // pending files survive refresh, framing is identical, and upload goes
  // through one path (POST /api/upload). See hooks/usePendingAttachments.ts.
  const attachments = usePendingAttachments(id);
  const {
    pendingFiles,
    isUploading,
    handleFilesUpload,
    uploadError,
    dismissUploadError,
    removeFile: removePendingFile,
    handlePaste: handlePasteFromHook,
  } = attachments;

  // One send path, shared with mobile. Owns take/clear/deliver/restore and the
  // rejection message; see hooks/useComposerSubmission.ts.
  const {
    submit,
    error: submissionError,
    setError: setSubmissionError,
  } = useComposerSubmission(id, draft, attachments);

  // A row exists only once the server acknowledged the creation.
  const confirmed = conversation !== null;
  // Persistent Builder identity — canonical kind, never the transient
  // ?helper=buddies query param (lost on refresh/sidebar nav, which made
  // Builder threads indistinguishable from normal chats).
  const isBuddyBuilder = conversation?.kind.t === 'builder';
  const isBuddyBuilderHelper = confirmed && isBuddyBuilder;
  const isRunning = conversation?.run === 'running' || conversation?.run === 'streaming';
  const isStreaming = conversation?.run === 'streaming';
  const runtimeTurnActive = isRunning || isStreaming;
  const { attempt: latestTurnAttempt } = useTurnDiagnostics(id, runtimeTurnActive);
  const restartRecovery = useRestartRecovery(id ?? '', latestTurnAttempt, runtimeTurnActive);
  const turnDiagnostics =
    latestTurnAttempt && shouldPresentTurnAttempt(latestTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(latestTurnAttempt)
      : null;
  const canChangeHarness =
    confirmed &&
    (conversation?.messageCount ?? 0) === 0 &&
    queue.length === 0 &&
    !isRunning &&
    !isStreaming;

  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const canInput = confirmed;
  const currentMessage = queue.find((m) => m.status === 'sending') ?? null;
  const pendingQueue = queue.filter((m) => m.status === 'pending');
  // Enter should switch to interrupt mode as soon as a turn is in flight,
  // including the short pre-stream window where the queue marks it "sending"
  // before provider status flips to isRunning/isStreaming.
  const hasActiveTurn = confirmed && (isRunning || isStreaming || currentMessage !== null);
  const hasContent = hasInput || pendingFiles.length > 0;

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    onDrop: handleFilesUpload,
    noClick: true,
    noKeyboard: true,
  });

  useEffect(() => {
    if (id) {
      setActiveConversationId(id);
      setSavedActiveConversationId(id);
    }
    return () => {
      setActiveConversationId(null);
    };
  }, [id]);

  useEffect(() => {
    if (id && !conversation && !pendingCreation && hasConversations) {
      if (!conversationLoadComplete) return;
      navigate('/');
    }
  }, [id, conversation, pendingCreation, hasConversations, conversationLoadComplete, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setShowPalette(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleScrollStateChange = useCallback((_isNearBottom: boolean, showButton: boolean) => {
    setShowScrollToBottom(showButton);
  }, []);

  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // setDraft auto-heights the textarea and reports hasInput via onDraftChange.
  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) setDraftValue(textarea.value);
  };

  // Delegate to shared hook — same framing as mobile so paste in either
  // tree lands identically (clipboard items → upload → preview).
  const handlePaste = handlePasteFromHook;

  // IMPORTANT: All hooks must be called before any early return.
  const activityAt = conversation && conversation.messageCount > 0 ? conversation.activityAt : null;
  const lastMessageTime = useMemo(
    () => (activityAt === null ? undefined : new Date(activityAt)),
    [activityAt]
  );

  const timeAgo = useTimeAgo(lastMessageTime);

  const messageGroups = useAtomValue(chatMessageGroupsAtomFamily(id ?? ''));

  // The server sets a swarm prefix only on chats, so no kind check here.
  const visibleSwarmDebugPrefix = detail?.swarmDebugPrefix ?? null;
  // A fresh object each render would invalidate VirtualizedMessageList's memos
  // on every streaming chunk; the row kind only changes on structural updates.
  const rowKind = conversation?.kind;
  const buddyContext = useMemo(() => headerBuddyContext(rowKind), [rowKind]);
  const unifiedSubAgents = useMemo(
    () => buildUnifiedSubAgents(subAgents, childSessionConversations),
    [subAgents, childSessionConversations]
  );

  const conversationConfig = detail?.config.config ?? null;

  // Transcript and fork draft live in utils/conversation-transcript.ts so the
  // mobile conversation header produces byte-identical output. The swarm-debug
  // prefix strip that messageGroups does for display happens in there too.
  const threadCopyText = useMemo(
    () => (conversation && detail ? buildThreadTranscript({ row: conversation, detail, messages }) : ''),
    [conversation, detail, messages]
  );

  // Was an unguarded navigator.clipboard.writeText: secure-context gated, so
  // over a LAN IP it threw and the button silently never flipped to copied.
  const handleCopyThread = useCallback(async () => {
    const copied = await copyText(threadCopyText);
    if (!copied) {
      setSubmissionError('Could not copy the thread to the clipboard.');
      return;
    }
    setThreadCopied(true);
    setTimeout(() => setThreadCopied(false), 2000);
  }, [threadCopyText, setSubmissionError]);

  // Chat "Fork": new conversation + resumedFromConversationId + draft context.
  // The server upgrades the first send to a native CLI session fork only when
  // source and target share a FORK_CAPABLE_PROVIDERS provider.
  // Shared with the mobile conversation header via atoms/fork-actions.ts —
  // one fork implementation, so the two trees cannot drift on draft contents
  // or lineage.
  const handleForkThread = useCallback(() => {
    if (!conversation || !detail || !id) return;
    navigate(`/chat/${forkConversation({ row: conversation, detail, messages })}`);
  }, [conversation, detail, messages, id, navigate]);

  if (!conversation) {
    return (
      <div className="chat-view">
        <div className="chat-header">
          <div className="chat-title">
            {pendingCreation ? 'Creating conversation…' : 'Select a conversation'}
          </div>
        </div>
        <div className="messages-container">
          <div className="empty-state">
            {pendingCreation?.error
              ? `Creation failed: ${pendingCreation.error}`
              : pendingCreation
                ? `Starting ${pendingCreation.config.provider} in ${pendingCreation.workingDirectory}`
                : 'Select a conversation from the sidebar or create a new one.'}
          </div>
        </div>
      </div>
    );
  }

  const dirDisplay = shortenHomePath(conversation.cwd);

  if (!conversationDetailsLoaded) {
    return (
      <div className="chat-view">
        <div className="chat-header">
          <div className="chat-title">
            <span className="chat-dir">{dirDisplay}</span>
          </div>
        </div>
        <div className="messages-container">
          <div className="empty-state">{detailLoadError ?? 'Loading conversation history…'}</div>
        </div>
      </div>
    );
  }

  const headerProvider = catalog?.providers.find(
    (provider) => provider.id === conversationConfig?.provider
  );
  // Buddy and Builder turns need fail-closed MCP state tools, so only
  // supportsRequiredMcp providers are offered. getBuddyContext covers the
  // buddy kind only; the Builder kind needs its own check — the server gate
  // (runtime preflight) enforces both, this menu just steers early.
  const requiresBuddyMcp = conversation.kind.t === 'buddy' || conversation.kind.t === 'builder';
  // The server's resolution names the model and effort; the header only
  // looks up display names (no client-side re-derivation, T09).
  const resolution = detail?.config.resolution;
  const resolvedConfig =
    resolution?.status === 'resolved' ? resolution.value : resolution?.lastResolved;
  const resolvedHeaderModelId = resolvedConfig?.modelId;
  const resolvedHeaderModel = headerProvider?.models.find(
    (model) => model.id === resolvedHeaderModelId
  );
  const headerReasoning = conversationConfig?.reasoning;
  const headerReasoningLabel =
    headerReasoning?.mode === 'explicit'
      ? headerReasoning.effort
      : headerReasoning?.mode === 'disabled'
        ? 'No reasoning'
        : resolvedConfig?.reasoningEffort
          ? `Default · ${resolvedConfig.reasoningEffort}`
          : 'Default';
  const headerModelLabel = resolvedHeaderModel?.displayName ?? resolvedHeaderModelId ?? 'Default';
  // "Claude Opus 5" under the Claude provider is redundant — the summary drops
  // the vendor prefix and shows "Opus 5". Full name stays in the expanded row.
  const headerModelShortLabel =
    headerProvider && headerModelLabel.startsWith(`${headerProvider.displayName} `)
      ? headerModelLabel.slice(headerProvider.displayName.length + 1)
      : headerModelLabel;
  const headerEffort =
    headerReasoning?.mode === 'explicit'
      ? headerReasoning.effort
      : headerReasoning?.mode === 'disabled'
        ? null
        : (resolvedConfig?.reasoningEffort ?? null);
  const headerEffortShortLabel = headerEffort
    ? headerEffort.charAt(0).toUpperCase() + headerEffort.slice(1)
    : null;

  const updateHeaderConfig = (patch: Parameters<typeof setConversationConfig>[0]['patch']) => {
    setConversationConfig({
      conversationId: conversation.id,
      expectedRevision: detail?.config.revision ?? 0,
      patch,
    });
  };

  // Optimistic send: the server only acknowledges after ensureReady plus
  // turn-spawn setup, which can take seconds on a loaded box. Gating the
  // textbox and Send button on that round trip froze the composer with no
  // feedback, so the composer empties on submit and the queue strip carries
  // the in-flight state. Admission (`confirmed`) is enforced
  // at the two entry points below — the Send button and handleKeyDown.
  const handleQueue = () => submit(queueMessage);
  const handleInterrupt = () => submit(interruptAndSend);
  const handleSend = handleQueue;

  const handleRemoveFromQueue = (messageId: string) => {
    if (id) cancelQueuedMessage(id, messageId);
  };

  const handleSendNow = (messageId: string) => {
    if (id) promoteQueuedMessage(id, messageId);
  };

  const handleClearQueue = () => {
    if (id) clearQueue(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey && hasContent && canInput) {
      e.preventDefault();
      handleQueue();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && hasContent && confirmed) {
      e.preventDefault();
      if (hasActiveTurn) {
        handleInterrupt();
      } else {
        handleQueue();
      }
    }
  };

  const handleSavePrompt = () => {
    const content = draft.getDraft().trim();
    if (content) savePrompt(content);
  };

  return (
    <div className={`chat-view${isDragActive ? ' drag-active' : ''}`} {...getRootProps()}>
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="dropzone-overlay">
          <div className="dropzone-overlay-content">
            <span className="dropzone-overlay-icon">&#x1F4CE;</span>
            <span className="dropzone-overlay-text">Drop files here</span>
          </div>
        </div>
      )}
      <div className="chat-header">
        <div className="chat-title">
          <div className="header-config-controls">
            <button
              type="button"
              className={`chat-config-summary${headerConfigExpanded ? ' expanded' : ''}`}
              title={`${headerProvider?.displayName ?? conversation.provider} · ${headerModelLabel} · ${headerReasoningLabel}`}
              aria-expanded={headerConfigExpanded}
              aria-haspopup="dialog"
              onClick={() => {
                if (!headerConfigExpanded && !catalog && !catalogIsLoading) retryCatalog();
                setHeaderConfigExpanded((open) => !open);
              }}
            >
              <span className="chat-config-summary-model">{headerModelShortLabel}</span>
              {headerEffortShortLabel && (
                <span className="chat-config-summary-effort">{headerEffortShortLabel}</span>
              )}
              <span className="model-picker-caret">&#x25BE;</span>
            </button>
          </div>
          {headerConfigExpanded && (
            <div
              className="chat-config-modal-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setHeaderConfigExpanded(false);
                }
              }}
            >
              {/* Full harness picker lives in a popup so the header stays one
              lean row; the summary button above only opens/closes this. */}
              <dialog
                open
                className="chat-config-modal"
                aria-label="Conversation harness settings"
                ref={configPickerRef}
              >
                <div className="chat-config-modal__header">
                  <span>Conversation settings</span>
                  <button
                    type="button"
                    className="chat-config-modal__close"
                    aria-label="Close harness settings"
                    onClick={() => {
                      setHeaderConfigExpanded(false);
                    }}
                  >
                    ✕
                  </button>
                </div>
                {!catalog && (
                  <div className="chat-config-note" role="status">
                    {catalogIsLoading || !catalogError ? (
                      'Loading harness options…'
                    ) : (
                      <>
                        <p>Could not load harness options. Please try again.</p>
                        <button type="button" onClick={retryCatalog}>
                          Retry
                        </button>
                      </>
                    )}
                  </div>
                )}
                {catalog && !conversationConfig && (
                  <p className="chat-config-note" role="status">
                    Conversation settings are unavailable. Reload the conversation to try again.
                  </p>
                )}
                {catalog && conversationConfig && (
                  <div className="chat-config-options">
                    <ConversationConfigPicker
                      value={conversationConfig}
                      catalog={catalog}
                      disabled={configIsSaving}
                      providerDisabled={!canChangeHarness}
                      inlineDefaults
                      providerFilter={(providerId) =>
                        !requiresBuddyMcp ||
                        providerId === conversation.provider ||
                        catalog.providers.some(
                          (provider) => provider.id === providerId && provider.supportsRequiredMcp
                        )
                      }
                      onChange={(config) => {
                        const modelId =
                          config.model.mode === 'explicit'
                            ? config.model.modelId
                            : headerProvider?.defaultModelId;
                        const model = headerProvider?.models.find((item) => item.id === modelId);
                        updateHeaderConfig({
                          kind: 'replace',
                          config: {
                            ...config,
                            reasoning:
                              config.reasoning.mode === 'explicit' &&
                              !model?.reasoning?.levels.includes(config.reasoning.effort)
                                ? { mode: 'default' }
                                : config.reasoning,
                          },
                        });
                      }}
                    />
                    {!canChangeHarness && (
                      <p className="chat-config-note">
                        Harness is fixed once a conversation starts.
                      </p>
                    )}
                  </div>
                )}

                {configIsSaving && <span className="config-save-state">Saving…</span>}
                {pendingConfigCommand?.error && (
                  <span className="config-save-state error" role="alert">
                    {pendingConfigCommand.error}
                  </span>
                )}
              </dialog>
            </div>
          )}
          <Link
            className="chat-dir"
            to={`/?folders=${encodeURIComponent(conversation.cwd)}`}
          >
            {dirDisplay}
          </Link>
          {/* One home for context usage: beside the folder, for buddy and plain
              threads alike. It used to live inside BuddyConvoHeader for buddy
              conversations, so the same number sat in two different places. */}
          <ContextBreakdownMeter conversationId={conversation.id} />
          {timeAgo && <span className="chat-time-ago">{timeAgo}</span>}
          {conversation.resumedFrom && (
            <ResumeThreadWidget
              sourceConversationId={conversation.resumedFrom}
              sourceConversation={resumedFromConversation}
            />
          )}
          {isBuddyBuilder && (
            <span className="buddy-helper-kicker buddy-helper-kicker--header">Buddy Builder</span>
          )}
        </div>
        <div className="header-status">
          <button
            type="button"
            className="fork-thread-btn"
            onClick={handleForkThread}
            title="Fork into a new thread (soft handoff — paste/draft context, not CLI --fork)"
          >
            Fork
          </button>
          <button
            type="button"
            className={`copy-thread-btn${threadCopied ? ' copied' : ''}`}
            onClick={handleCopyThread}
            title="Copy full thread"
          >
            {threadCopied ? (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          {!confirmed && <div className="ready-badge waiting">Starting...</div>}
          {pendingQueue.length > 0 && (
            <div className="queue-badge" title="Messages waiting to send">
              {pendingQueue.length} queued
              <button
                type="button"
                className="clear-queue-btn"
                onClick={handleClearQueue}
                title="Clear queue"
              >
                Clear
              </button>
            </div>
          )}
          {turnDiagnostics ? (
            <TurnStatus
              diagnostics={turnDiagnostics}
              className="chat-turn-status"
              density="compact"
            />
          ) : (
            <div className={`chat-status-indicator ${isRunning || isStreaming ? 'running' : ''}`} />
          )}
        </div>
      </div>

      {unifiedSubAgents.length > 0 && (
        <div className="thread-context">
          <SubAgentPanel
            subAgents={unifiedSubAgents}
            workingDirectory={conversation.cwd}
          />
        </div>
      )}

      {messages.length === 0 ? (
        <div className="messages-container">
          {buddyContext && <BuddyConvoHeader context={buddyContext} />}
          {visibleSwarmDebugPrefix && (
            <div style={{ paddingBottom: '24px' }}>
              <SwarmConvoPrefix
                prefix={visibleSwarmDebugPrefix}
                swarmId={conversation.kind.t === 'worker' ? conversation.kind.swarmId : null}
              />
            </div>
          )}
          {isBuddyBuilderHelper ? (
            <div className="buddy-helper-panel">
              <span className="buddy-helper-kicker">Buddy Builder · hire a Buddy or a team</span>
              <h2>Let’s build your team.</h2>
              <p>
                Describe one Buddy or a whole team, the workspace they should work in, and what a
                good first outcome looks like. I’ll create each Buddy here with its own role and
                working brief.
              </p>
              <div className="buddy-helper-example" aria-label="Example team brief">
                “Create a researcher, a designer, and an engineer for unleashd to turn customer
                feedback into shipped product improvements.”
              </div>
              <div className="buddy-helper-prompts">
                {BUDDY_STARTER_PROMPTS.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => setDraftValue(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              {isBuddyBuilder
                ? 'Describe the Buddy or team you want to create.'
                : 'Send a message to start the conversation.'}
            </div>
          )}
        </div>
      ) : (
        <div className="messages-container-wrapper">
          <VirtualizedMessageList
            key={id}
            messageGroups={messageGroups}
            isRunning={isStreaming}
            isTurnActive={runtimeTurnActive}
            lastMessageRef={lastMessageRef}
            onScrollStateChange={handleScrollStateChange}
            conversationId={id!}
            markMessagesSeen={markMessagesSeen}
            totalMessageCount={messages.length}
            scrollToBottomRef={scrollToBottomRef}
            workingDirectory={conversation.cwd}
            swarmDebugPrefix={visibleSwarmDebugPrefix}
            swarmId={conversation.kind.t === 'worker' ? conversation.kind.swarmId : null}
            buddyContext={buddyContext}
          />
          {shouldShowTypingIndicator(isStreaming, streamingText) && (
            <div className="typing-indicator-overlay">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )}
          {showScrollToBottom && (
            <button
              type="button"
              className="scroll-to-bottom-btn"
              onClick={() => scrollToBottomRef.current?.()}
              aria-label="Scroll to bottom"
            >
              &#x25BC;
            </button>
          )}
        </div>
      )}

      <div className="input-container">
        {restartRecovery ? <RestartRecoveryPrompt recovery={restartRecovery} /> : null}
        {currentMessage && (
          <div className="current-message-indicator">
            <span className="current-message-label">Current message</span>
            <span className="current-message-content">{currentMessage.content}</span>
          </div>
        )}

        {pendingQueue.length > 0 && (
          <div className="queued-messages">
            <div className="queued-messages-header">
              <span className="queued-badge">Queued ({pendingQueue.length})</span>
              <button
                type="button"
                className="clear-queue-header-btn"
                onClick={handleClearQueue}
                title="Clear all queued messages"
              >
                Clear All
              </button>
            </div>
            <ul className="queued-messages-list">
              {pendingQueue.map((qm, index) => (
                <li key={qm.id} className="queued-message-item pending">
                  <span className="queued-message-content">{qm.content}</span>
                  <span className="queued-message-status">#{index + 1} in queue</span>
                  <button
                    type="button"
                    className="queued-message-send-now"
                    onClick={() => handleSendNow(qm.id)}
                    title="Send now — run this next, interrupting the active turn"
                  >
                    Send now
                  </button>
                  <button
                    type="button"
                    className="queued-message-remove"
                    onClick={() => handleRemoveFromQueue(qm.id)}
                    title="Remove from queue"
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {uploadError && (
          <div className="chat-upload-error" role="alert">
            <span className="chat-upload-error__text">{uploadError}</span>
            <button
              type="button"
              className="chat-upload-error__dismiss"
              onClick={dismissUploadError}
              aria-label="Dismiss upload error"
            >
              &times;
            </button>
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((file) => (
              <div key={file.absolutePath} className="pending-file-item">
                {file.previewUrl ? (
                  <img
                    className="pending-file-thumb"
                    src={file.previewUrl}
                    alt={file.originalName}
                  />
                ) : (
                  <span className="pending-file-icon">&#x1F4C4;</span>
                )}
                <span className="pending-file-name">{file.originalName}</span>
                <button
                  type="button"
                  className="pending-file-remove"
                  onClick={() => removePendingFile(file.absolutePath)}
                  title="Remove file"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {submissionError && (
          <div className="submission-error" role="alert">
            {submissionError}
          </div>
        )}

        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            data-conversation-input="true"
            className={`message-input ${hasActiveTurn ? 'interrupt-mode' : ''}`}
            defaultValue=""
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              hasActiveTurn
                ? 'Enter to interrupt, Tab to queue...'
                : isBuddyBuilder
                  ? 'I want a Buddy or team for…'
                  : 'Type your message...'
            }
            disabled={!canInput}
          />
          <div className="input-actions">
            <button
              type="button"
              className="upload-btn"
              onClick={openFilePicker}
              disabled={!canInput || isUploading}
              title="Attach files (drag & drop also supported)"
            >
              <span className="upload-icon">&#x1F4CE;</span>
            </button>
            <button
              type="button"
              className="save-prompt-btn"
              onClick={handleSavePrompt}
              title="Save prompt (Ctrl+P to recall)"
              disabled={!hasInput}
            >
              <svg
                className="save-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <title>Save</title>
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </button>
            <div className="send-action">
              <button
                type="button"
                className={`send-btn ${hasActiveTurn ? 'interrupt-mode' : ''}`}
                onClick={hasActiveTurn ? handleInterrupt : handleSend}
                disabled={!confirmed || !hasContent}
                title={
                  hasActiveTurn
                    ? 'Enter: Interrupt & send | Tab: Queue'
                    : 'Enter: Send | Tab: Queue'
                }
              >
                {hasActiveTurn ? 'Interrupt' : 'Send'}
              </button>
              {isStreaming && hasContent && (
                <div className="send-queue-hint" aria-live="polite">
                  Tab to queue
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <PromptPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        prompts={savedPrompts}
        fuzzySearch={fuzzySearch}
        incrementUsage={incrementUsage}
        deletePrompt={deletePrompt}
        onSelect={(content) => {
          setDraftValue(content);
          setHasInput(content.trim().length > 0);
          // Focus is owned by useConversationDraft's rAF; re-assert for palette UX
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />
    </div>
  );
}
