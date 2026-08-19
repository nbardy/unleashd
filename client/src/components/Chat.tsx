// Solarized Dark theme for syntax highlighting - matches app aesthetic
// highlight.js + katex stylesheets load lazily with their plugins —
// see utils/lazyMarkdownPlugins.ts. Do not re-add a static CSS import here.
import type { ConversationConfig } from '@unleashd/shared';
import { getBuddyContext, isBuddyBuilderConversation } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  cancelQueuedMessage,
  clearQueue,
  interruptAndSend,
  loadConversationDetails,
  queueMessage,
  setActiveConversationId,
} from '../atoms/actions';
import type { QueuedMessage } from '../atoms/actions';
import { setConversationConfig } from '../atoms/config-actions';
import {
  childConversationsAtomFamily,
  conversationAtomFamily,
  conversationCountAtom,
  conversationDetailsLoadedAtomFamily,
  conversationLoadCompleteAtom,
  pendingConfigCommandAtomFamily,
  pendingCreationAtomFamily,
  streamingAtomFamily,
} from '../atoms/conversations';
import { forkConversation } from '../atoms/fork-actions';
import { allMergeChildrenSettledAtomFamily } from '../atoms/mergeAtoms';
import type { BuddyContext } from '../atoms/pending-creations';
import { markMessagesSeen, setSavedActiveConversationId } from '../atoms/ui';
import { useConversationDraft } from '../hooks/useConversationDraft';
import { usePendingAttachments } from '../hooks/usePendingAttachments';
import { useProviderCatalog } from '../hooks/useProviderCatalog';
import { useSavedPrompts } from '../hooks/useSavedPrompts';
import { useTurnDiagnostics } from '../hooks/useTurnDiagnostics';
import { copyText } from '../utils/clipboard';
import { buildThreadTranscript } from '../utils/conversation-transcript';
import { buildUnifiedSubAgents } from '../utils/subAgents';
import { formatTimeAgo } from '../utils/time';
import { BuddyConvoHeader } from './BuddyConvoHeader';
import { MergeProgressStrip } from './MergeProgressStrip';
import { PromptPalette } from './PromptPalette';
import { ResumeThreadWidget } from './ResumeThreadWidget';
import { SubAgentPanel } from './SubAgentPanel';
import { SwarmConvoPrefix } from './SwarmConvoPrefix';
import { TurnStatus } from './TurnStatus';
import { VirtualizedMessageList, isToolCallOnlyMessage } from './VirtualizedMessageList';
import type { MessageGroup } from './VirtualizedMessageList';
import { BuddyBuilderResultCard } from './buddies/BuddyBuilderResultCard';
import { effectiveSwarmDebugPrefix } from './buddies/ui-contract';
import {
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
} from './turn-diagnostics';
import './Chat.css';

// Stable reference for empty queue — avoids new [] on every render triggering re-renders
const EMPTY_QUEUE: QueuedMessage[] = [];

// Deprecated helper kept for local parity — use getBuddyContext (kind-aware) instead.
// The holistic kind type is the canonical source; legacy buddyContext is compat only.
function readBuddyContext(value: unknown): BuddyContext | undefined {
  return (getBuddyContext(
    value as { kind?: unknown; buddyContext?: unknown } as Parameters<typeof getBuddyContext>[0]
  ) ?? undefined) as BuddyContext | undefined;
}

/**
 * Returns a live-updating "time ago" string for a Date.
 * Ticks every 30s to stay reasonably current without excessive renders.
 */
function useTimeAgo(date: Date | undefined): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [date]);

  if (!date) return null;
  return formatTimeAgo(date);
}

export function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Per-ID atoms — only re-render when THIS conversation changes, not others
  const conversation = useAtomValue(conversationAtomFamily(id ?? ''));
  const conversationDetailsLoaded = useAtomValue(conversationDetailsLoadedAtomFamily(id ?? ''));
  const conversationLoadComplete = useAtomValue(conversationLoadCompleteAtom);
  const pendingCreation = useAtomValue(pendingCreationAtomFamily(id ?? ''));
  const pendingConfigCommand = useAtomValue(pendingConfigCommandAtomFamily(id ?? ''));
  const configIsSaving = !!pendingConfigCommand && !pendingConfigCommand.error;
  const streamingText = useAtomValue(streamingAtomFamily(id ?? ''));
  const childSessionConversations = useAtomValue(childConversationsAtomFamily(id ?? ''));
  const conversationCount = useAtomValue(conversationCountAtom);
  const queue = conversation?.queue?.length ? conversation.queue : EMPTY_QUEUE;
  const allMergeChildrenSettled = useAtomValue(allMergeChildrenSettledAtomFamily(id ?? ''));
  // Merge parent threads must wait for all forked review children to settle
  // (complete or error) before the user can send their first message — the
  // server needs the review docs on disk to build the prefix.
  const mergeGateBlocking =
    !!conversation?.mergeParentMeta &&
    conversation.messages.length === 0 &&
    !allMergeChildrenSettled;
  const resumedFromConversationId = conversation?.resumedFromConversationId ?? '';
  const resumedFromConversation = useAtomValue(conversationAtomFamily(resumedFromConversationId));

  const { catalog } = useProviderCatalog();
  const [headerPickerOpen, setHeaderPickerOpen] = useState<
    'provider' | 'model' | 'reasoning' | null
  >(null);
  const configPickerRef = useRef<HTMLDivElement>(null);

  // Click-outside to close pickers
  useEffect(() => {
    if (!headerPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (configPickerRef.current && !configPickerRef.current.contains(target)) {
        setHeaderPickerOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [headerPickerOpen]);

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
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  // Portable draft persistence — same hook mobile uses (localStorage `draft:{id}`).
  // Handles debounced save, flush on pagehide/visibility/HMR, and focus restore
  // without stale-closure bug (refs only).
  const {
    setDraft: setDraftValue,
    clear: clearDraftValue,
    getDraft: getDraftValue,
  } = useConversationDraft({
    conversationId: id,
    textareaRef,
    maxHeight: 300,
    autoFocus: true,
    onDraftLoaded: (draft) => setHasInput(draft.trim().length > 0),
  });

  // Shared attachment lifecycle — same hook mobile ComposerMobile uses so
  // pending files survive refresh, framing is identical, and upload goes
  // through one path (POST /api/upload). See hooks/usePendingAttachments.ts.
  const {
    pendingFiles,
    isUploading,
    handleFilesUpload,
    removeFile: removePendingFile,
    clearFiles: clearPendingFiles,
    buildContent: buildAttachedContent,
    handlePaste: handlePasteFromHook,
  } = usePendingAttachments(id);

  const confirmed = conversation?.confirmed ?? false;
  const isRunning = conversation?.isRunning ?? false;
  const isStreaming = conversation?.isStreaming ?? false;
  const runtimeTurnActive = isRunning || isStreaming;
  const { attempt: latestTurnAttempt } = useTurnDiagnostics(id, runtimeTurnActive);
  const turnDiagnostics =
    latestTurnAttempt && shouldPresentTurnAttempt(latestTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(latestTurnAttempt)
      : null;
  const canChangeHarness =
    confirmed &&
    (conversation?.messages.length ?? 0) === 0 &&
    (conversation?.queue.length ?? 0) === 0 &&
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
    if (id && !conversation && !pendingCreation && conversationCount > 0) {
      if (!conversationLoadComplete) return;
      navigate('/');
    }
  }, [id, conversation, pendingCreation, conversationCount, conversationLoadComplete, navigate]);

  useEffect(() => {
    if (!id || !conversation || conversationDetailsLoaded) {
      setDetailLoadError(null);
      return;
    }
    let cancelled = false;
    setDetailLoadError(null);
    void loadConversationDetails(id).catch((error) => {
      if (!cancelled) {
        setDetailLoadError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, conversation, conversationDetailsLoaded]);

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

  const getInputValue = () => getDraftValue() || textareaRef.current?.value || '';

  const clearInput = () => {
    clearDraftValue();
    setHasInput(false);
    clearPendingFiles();
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
    const value = textarea.value;
    setDraftValue(value);

    const has = value.trim().length > 0;
    if (has !== hasInput) setHasInput(has);
  };

  // Delegate to shared hook — same framing as mobile so paste in either
  // tree lands identically (clipboard items → upload → preview).
  const handlePaste = handlePasteFromHook;

  // IMPORTANT: All hooks must be called before any early return.
  const conversationMessagesSnapshot = conversation?.messages;
  const messageCount = conversationMessagesSnapshot?.length ?? 0;
  const lastMessageTime = useMemo(() => {
    if (!conversationMessagesSnapshot || messageCount === 0) return undefined;
    const last = conversationMessagesSnapshot[messageCount - 1];
    return last.timestamp ? new Date(last.timestamp) : undefined;
  }, [conversationMessagesSnapshot, messageCount]);

  const timeAgo = useTimeAgo(lastMessageTime);

  // Merge stable conversation messages with live streaming text for display.
  // conversation.messages is stable during streaming; streamingText changes per chunk.
  const conversationMessages = useMemo(() => {
    if (!conversation) return [];
    if (!streamingText) return conversation.messages;
    const messages = conversation.messages.slice();
    const last = messages[messages.length - 1];
    if (last?.role !== 'assistant') return conversation.messages;
    messages[messages.length - 1] = { ...last, content: last.content + streamingText };
    return messages;
  }, [conversation, streamingText]);

  const swarmDebugPrefix = conversation?.swarmDebugPrefix;
  // readBuddyContext derives a FRESH object from conversation.kind on every call, so
  // calling it inline made buddyContext a new reference each render and invalidated the
  // memos in VirtualizedMessageList on every streaming chunk. Streaming text lives in a
  // separate atom (streamingAtomFamily), so the `conversation` reference only changes on
  // structural updates — it is a safe memo key.
  const buddyContext = useMemo(() => readBuddyContext(conversation), [conversation]);
  const visibleSwarmDebugPrefix = effectiveSwarmDebugPrefix(
    buddyContext,
    swarmDebugPrefix,
    conversation?.kind ?? null
  );
  const messageGroups = useMemo((): MessageGroup[] => {
    const prefix = visibleSwarmDebugPrefix;
    const groups: MessageGroup[] = [];
    let toolCallRun: (typeof conversationMessages)[number][] = [];

    const flushRun = () => {
      if (toolCallRun.length >= 2) {
        groups.push({ type: 'tool_calls', messages: toolCallRun });
      } else {
        for (const m of toolCallRun) groups.push({ type: 'single', messages: [m] });
      }
      toolCallRun = [];
    };

    conversationMessages.forEach((msg, i) => {
      let displayMsg = msg;
      if (i === 0 && msg.role === 'user' && prefix && msg.content.startsWith(prefix)) {
        const stripped = msg.content.slice(prefix.length).replace(/^\n\n/, '');
        displayMsg = { ...msg, content: stripped };
      }
      if (isToolCallOnlyMessage(displayMsg)) {
        toolCallRun.push(displayMsg);
      } else {
        flushRun();
        groups.push({ type: 'single', messages: [displayMsg] });
      }
    });

    flushRun();
    return groups;
  }, [conversationMessages, visibleSwarmDebugPrefix]);

  const unifiedSubAgents = useMemo(() => {
    if (!conversation) return [];
    return buildUnifiedSubAgents(conversation, childSessionConversations);
  }, [conversation, childSessionConversations]);

  const conversationConfig = conversation?.config ?? null;

  // Transcript and fork draft live in utils/conversation-transcript.ts so the
  // mobile conversation header produces byte-identical output. The swarm-debug
  // prefix strip that messageGroups does for display happens in there too.
  const threadCopyText = useMemo(
    () => (conversation ? buildThreadTranscript(conversation) : ''),
    [conversation]
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
  }, [threadCopyText]);

  // Chat "Fork": new conversation + resumedFromConversationId + draft context.
  // Does not call CLI --fork / emulateFork. That is merge-only
  // (FORK_CAPABLE_PROVIDERS + spawnMergeReviewFork).
  // Shared with the mobile conversation header via atoms/fork-actions.ts —
  // one fork implementation, so the two trees cannot drift on draft contents
  // or lineage.
  const handleForkThread = useCallback(() => {
    if (!conversation || !id) return;
    const forkedId = forkConversation(conversation);
    if (!forkedId) return;
    navigate(`/chat/${forkedId}`);
  }, [conversation, id, navigate]);

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

  if (!conversationDetailsLoaded) {
    return (
      <div className="chat-view">
        <div className="chat-header">
          <div className="chat-title">{conversation.id.slice(0, 8)}</div>
        </div>
        <div className="messages-container">
          <div className="empty-state">{detailLoadError ?? 'Loading conversation history…'}</div>
        </div>
      </div>
    );
  }

  const dirDisplay = conversation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
  const headerProvider = catalog?.providers.find(
    (provider) => provider.id === conversationConfig?.provider
  );
  const resolvedHeaderModelId =
    conversationConfig?.model.mode === 'explicit'
      ? conversationConfig.model.modelId
      : headerProvider?.defaultModelId;
  const resolvedHeaderModel = headerProvider?.models.find(
    (model) => model.id === resolvedHeaderModelId
  );
  const headerReasoning = conversationConfig?.reasoning;
  const headerReasoningLabel =
    headerReasoning?.mode === 'explicit'
      ? headerReasoning.effort
      : headerReasoning?.mode === 'disabled'
        ? 'No reasoning'
        : resolvedHeaderModel?.reasoning?.defaultEffort
          ? `Default · ${resolvedHeaderModel.reasoning.defaultEffort}`
          : 'Default';

  const updateHeaderConfig = (patch: Parameters<typeof setConversationConfig>[0]['patch']) => {
    setConversationConfig({
      conversationId: conversation.id,
      expectedRevision: conversation.configRevision,
      patch,
    });
    setHeaderPickerOpen(null);
  };

  const handleQueue = async () => {
    const textContent = getInputValue().trim();
    if ((!textContent && pendingFiles.length === 0) || !id || !canInput || isSubmitting) return;

    const content = buildAttachedContent(textContent);

    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      await queueMessage(id, content);
      clearInput();
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInterrupt = async () => {
    const textContent = getInputValue().trim();
    if ((!textContent && pendingFiles.length === 0) || !id || !confirmed || isSubmitting) return;

    const content = buildAttachedContent(textContent);

    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      await interruptAndSend(id, content);
      clearInput();
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSend = handleQueue;

  const handleRemoveFromQueue = (messageId: string) => {
    if (id) cancelQueuedMessage(id, messageId);
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
    const content = getInputValue().trim();
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
          <span className="chat-id">{conversation.id.substring(0, 8)}</span>
          <div className="header-config-controls" ref={configPickerRef}>
            {canChangeHarness ? (
              <div className="provider-picker">
                <button
                  type="button"
                  className={`provider-picker-trigger ${conversation.provider}`}
                  disabled={!catalog || configIsSaving}
                  onClick={() =>
                    setHeaderPickerOpen((open) => (open === 'provider' ? null : 'provider'))
                  }
                >
                  {headerProvider?.displayName ?? conversation.provider}
                  <span className="provider-picker-caret">&#x25BE;</span>
                </button>
                {headerPickerOpen === 'provider' && catalog && (
                  <div className="provider-picker-menu">
                    {catalog.providers.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        className={`provider-picker-option ${
                          provider.id === conversation.provider ? 'selected' : ''
                        }`}
                        onClick={() =>
                          updateHeaderConfig({ kind: 'set_provider', provider: provider.id })
                        }
                      >
                        {provider.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className={`provider-badge provider-${conversation.provider}`}>
                {headerProvider?.displayName ?? conversation.provider}
              </span>
            )}

            {headerProvider && conversationConfig && (
              <div className="model-picker">
                <button
                  type="button"
                  className="model-picker-trigger"
                  disabled={configIsSaving}
                  onClick={() => setHeaderPickerOpen((open) => (open === 'model' ? null : 'model'))}
                >
                  {resolvedHeaderModel?.displayName ?? resolvedHeaderModelId ?? 'Default'}
                  <span className="model-picker-caret">&#x25BE;</span>
                </button>
                {headerPickerOpen === 'model' && (
                  <div className="model-picker-menu">
                    <button
                      type="button"
                      className={`model-picker-option ${
                        conversationConfig.model.mode === 'default' ? 'selected' : ''
                      }`}
                      onClick={() =>
                        updateHeaderConfig({ kind: 'set_model', model: { mode: 'default' } })
                      }
                    >
                      Provider default
                      <span className="model-default-tag">{headerProvider.defaultModelId}</span>
                    </button>
                    {headerProvider.models.map((model) => {
                      const selected =
                        conversationConfig.model.mode === 'explicit' &&
                        conversationConfig.model.modelId === model.id;
                      const currentEffort =
                        conversationConfig.reasoning.mode === 'explicit'
                          ? conversationConfig.reasoning.effort
                          : null;
                      const supportsCurrentEffort =
                        !currentEffort || model.reasoning?.levels.includes(currentEffort);
                      const nextConfig: ConversationConfig = {
                        ...conversationConfig,
                        model: { mode: 'explicit', modelId: model.id },
                        reasoning: supportsCurrentEffort
                          ? conversationConfig.reasoning
                          : { mode: 'default' },
                      };
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`model-picker-option ${selected ? 'selected' : ''}`}
                          onClick={() =>
                            updateHeaderConfig({ kind: 'replace', config: nextConfig })
                          }
                        >
                          {model.displayName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {resolvedHeaderModel?.reasoning && conversationConfig && (
              <div className="model-picker">
                <button
                  type="button"
                  className="model-picker-trigger reasoning-picker-trigger"
                  disabled={configIsSaving}
                  onClick={() =>
                    setHeaderPickerOpen((open) => (open === 'reasoning' ? null : 'reasoning'))
                  }
                >
                  {headerReasoningLabel}
                  <span className="model-picker-caret">&#x25BE;</span>
                </button>
                {headerPickerOpen === 'reasoning' && (
                  <div className="model-picker-menu reasoning-picker-menu">
                    <button
                      type="button"
                      className={`model-picker-option ${
                        conversationConfig.reasoning.mode === 'default' ? 'selected' : ''
                      }`}
                      onClick={() =>
                        updateHeaderConfig({
                          kind: 'set_reasoning',
                          reasoning: { mode: 'default' },
                        })
                      }
                    >
                      Model default
                      {resolvedHeaderModel.reasoning.defaultEffort && (
                        <span className="model-default-tag">
                          {resolvedHeaderModel.reasoning.defaultEffort}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`model-picker-option ${
                        conversationConfig.reasoning.mode === 'disabled' ? 'selected' : ''
                      }`}
                      onClick={() =>
                        updateHeaderConfig({
                          kind: 'set_reasoning',
                          reasoning: { mode: 'disabled' },
                        })
                      }
                    >
                      No reasoning flag
                    </button>
                    {resolvedHeaderModel.reasoning.levels.map((effort) => (
                      <button
                        key={effort}
                        type="button"
                        className={`model-picker-option ${
                          conversationConfig.reasoning.mode === 'explicit' &&
                          conversationConfig.reasoning.effort === effort
                            ? 'selected'
                            : ''
                        }`}
                        onClick={() =>
                          updateHeaderConfig({
                            kind: 'set_reasoning',
                            reasoning: { mode: 'explicit', effort },
                          })
                        }
                      >
                        {effort}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {configIsSaving && <span className="config-save-state">Saving…</span>}
            {pendingConfigCommand?.error && (
              <span className="config-save-state error" role="alert">
                {pendingConfigCommand.error}
              </span>
            )}
          </div>
          <Link
            className="chat-dir"
            to={`/?folders=${encodeURIComponent(conversation.workingDirectory)}`}
          >
            {dirDisplay}
          </Link>
          {timeAgo && <span className="chat-time-ago">{timeAgo}</span>}
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
          {currentMessage && (
            <div className="current-message-badge" title="Currently processing">
              Current
            </div>
          )}
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
            <TurnStatus diagnostics={turnDiagnostics} className="chat-turn-status" />
          ) : (
            <div className={`status-indicator ${isRunning || isStreaming ? 'running' : ''}`} />
          )}
        </div>
      </div>

      {conversation.mergeParentMeta && <MergeProgressStrip parentId={conversation.id} />}

      {(unifiedSubAgents.length > 0 || conversation.resumedFromConversationId) && (
        <div
          className={`thread-context${unifiedSubAgents.length > 0 && conversation.resumedFromConversationId ? ' thread-context--combined' : ''}`}
        >
          {unifiedSubAgents.length > 0 && (
            <SubAgentPanel
              subAgents={unifiedSubAgents}
              workingDirectory={conversation.workingDirectory}
            />
          )}
          {conversation.resumedFromConversationId && (
            <ResumeThreadWidget
              sourceConversationId={conversation.resumedFromConversationId}
              sourceConversation={resumedFromConversation}
            />
          )}
        </div>
      )}

      {conversation.messages.length === 0 ? (
        <div className="messages-container">
          {buddyContext && <BuddyConvoHeader context={buddyContext} />}
          {visibleSwarmDebugPrefix && (
            <div style={{ paddingBottom: '24px' }}>
              <SwarmConvoPrefix
                prefix={visibleSwarmDebugPrefix}
                swarmId={conversation.swarmId ?? null}
              />
            </div>
          )}
          <div className="empty-state">
            {
              confirmed
                ? isBuddyBuilderConversation(conversation)
                  ? 'Describe the Buddy you want to create.'
                  : 'Send a message to start the conversation.'
                : `Waiting for ${conversation.provider || 'claude'} to be ready...` /* fallback 'claude' matches shared DEFAULT_PROVIDER */
            }
          </div>
        </div>
      ) : (
        <div className="messages-container-wrapper">
          <VirtualizedMessageList
            key={id}
            messageGroups={messageGroups}
            isRunning={isStreaming}
            lastMessageRef={lastMessageRef}
            onScrollStateChange={handleScrollStateChange}
            conversationId={id!}
            markMessagesSeen={markMessagesSeen}
            totalMessageCount={conversation.messages.length}
            scrollToBottomRef={scrollToBottomRef}
            workingDirectory={conversation.workingDirectory}
            swarmDebugPrefix={visibleSwarmDebugPrefix}
            swarmId={conversation.swarmId ?? null}
            buddyContext={buddyContext}
          />
          {isBuddyBuilderConversation(conversation) && (
            <div className="buddy-builder-result-slot">
              <BuddyBuilderResultCard
                // Keyed so switching builder conversations remounts the card; without it
                // the previous conversation's result (and its "Start conversation" button)
                // leaks across navigation.
                key={conversation.id}
                conversationId={conversation.id}
                isRunning={conversation.isRunning}
              />
            </div>
          )}
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

        <div className="input-wrapper">
          {submissionError && (
            <div className="submission-error" role="alert">
              {submissionError}
            </div>
          )}
          <textarea
            ref={textareaRef}
            data-conversation-input="true"
            className={`message-input ${hasActiveTurn ? 'interrupt-mode' : ''}`}
            defaultValue=""
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              !confirmed
                ? `Waiting for ${conversation.provider || 'claude'}...` // fallback 'claude' matches shared DEFAULT_PROVIDER
                : hasActiveTurn
                  ? 'Enter to interrupt, Tab to queue...'
                  : isBuddyBuilderConversation(conversation)
                    ? 'I want a new Buddy for…'
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
                disabled={!confirmed || !hasContent || mergeGateBlocking || isSubmitting}
                title={
                  mergeGateBlocking
                    ? 'Waiting for review forks to finish'
                    : hasActiveTurn
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
