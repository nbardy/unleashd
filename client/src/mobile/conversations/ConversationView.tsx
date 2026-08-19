import type { Conversation, SubAgent } from '@unleashd/shared';
import { getBuddyContext } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadConversationDetails, setActiveConversationId } from '../../atoms/actions';
import {
  childConversationsAtomFamily,
  conversationAtomFamily,
  conversationDetailsLoadedAtomFamily,
  conversationLoadCompleteAtom,
  pendingConfigCommandAtomFamily,
  pendingCreationAtomFamily,
  queueAtomFamily,
  streamingAtomFamily,
} from '../../atoms/conversations';
import { forkConversation } from '../../atoms/fork-actions';
import {
  mergeChildErrorAtomFamily,
  mergeChildStatusAtomFamily,
} from '../../atoms/mergeAtoms';
import { markMessagesSeen, setSavedActiveConversationId } from '../../atoms/ui';
import { effectiveSwarmDebugPrefix } from '../../components/buddies/ui-contract';
import { useCopyAction } from '../../hooks/useCopyAction';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { useSavedPrompts } from '../../hooks/useSavedPrompts';
import { useTurnDiagnostics } from '../../hooks/useTurnDiagnostics';
import { buildThreadTranscript } from '../../utils/conversation-transcript';
import { buildUnifiedSubAgents } from '../../utils/subAgents';
import { parseStatsFromPrefix } from '../../utils/swarmConvoParsers';
import {
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
} from '../../utils/turn-diagnostics';
import { ComposerMobile } from '../components/ComposerMobile';
import { PromptPaletteMobile } from '../components/PromptPaletteMobile';
import { MessageRow } from '../components/MessageRow';
import { MobileBadge, MobileSection, MobileSurface } from '../components/MobileUI';
import { MobileQueueStrip } from './MobileQueueStrip';
import { ModelSheetMobile, modelSummary } from '../components/ModelSheetMobile';
import { TurnStatusMobile } from '../components/TurnStatusMobile';

/**
 * ConversationView — the one mobile conversation pane.
 *
 * Extracted from ChatMobile so plain chats and buddy conversations render the
 * SAME transcript + composer instead of drifting into two implementations.
 * `ChatMobile` is now a thin route wrapper around it; any buddy surface that
 * wants an inline thread embeds this directly.
 *
 * LAYOUT CONTRACT (this is what made the composer invisible on phones):
 * this component fills its PARENT, it does not size itself to the viewport.
 * It renders inside ShellMobile's `.mobile-content`, which is already
 * `100dvh − tab-bar`. The old `height: 100dvh` here made the pane 56px taller
 * than its scrollport, pushing the composer underneath the bottom tab bar with
 * no way to scroll to it — the message list swallowed the gesture. Keep this
 * `height: 100%` and keep `.mobile-content__inner` a stretched flex column.
 *
 * CREATION STATES: a freshly created conversation exists only in
 * `pendingCreationsAtom` until the server confirms it over WS. Rendering
 * "not found" for that window is wrong — it is the bug that made every new
 * plain conversation look broken while buddy threads (created synchronously by
 * `POST /api/buddies/builder`, so already in `conversationsAtom` before the
 * route changes) looked fine. Mirror Chat.tsx: only claim "not found" once the
 * conversation list has finished loading AND there is no pending creation.
 */

function CopyThreadButton({ conversation }: { conversation: Conversation }) {
  const text = buildThreadTranscript(conversation);
  const { state, copy } = useCopyAction(text);
  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy thread';
  return (
    <button
      type="button"
      className="mobile-chat__action"
      onClick={copy}
      title={label}
      aria-label={label}
    >
      {label}
    </button>
  );
}

function ForkButton({ conversation }: { conversation: Conversation }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // A conversation the server has not confirmed yet has no config to fork from.
  const disabled = !conversation.config;

  return (
    <>
      <button
        type="button"
        className="mobile-chat__action"
        disabled={disabled}
        title={
          disabled
            ? 'Waiting for the server to confirm this conversation'
            : 'Fork into a new thread (soft handoff — carries the transcript as a draft)'
        }
        onClick={() => {
          const forkedId = forkConversation(conversation);
          if (!forkedId) {
            setError('Cannot fork yet — conversation is still being created.');
            return;
          }
          navigate(`/chat/${forkedId}`);
        }}
      >
        Fork
      </button>
      {error ? (
        <span role="alert" className="mobile-chat__action-error">
          {error}
        </span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mobile thread-context panels — reuse Chat.tsx data derivation, render with
// MobileSection/MobileSurface primitives (not desktop VirtualizedMessageList /
// SubAgentPanel / SwarmConvoPrefix / ResumeThreadWidget / MergeProgressStrip).
// G3: mobile never imports components/* except buddies/, so we import the
// shared utils directly and render mobile-appropriate UI here.
// ---------------------------------------------------------------------------

function MobileMergeProgressStrip({ parent }: { parent: Conversation }) {
  const meta = parent.mergeParentMeta;
  if (!meta) return null;
  return (
    <MobileSection title="Reviews" meta={`${meta.children.length} ${meta.children.length === 1 ? 'review' : 'reviews'}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {meta.children.map((child) => (
          <MergeChip
            key={child.childConversationId}
            childId={child.childConversationId}
            reviewUuid={child.reviewUuid}
          />
        ))}
      </div>
    </MobileSection>
  );
}

function MergeChip({ childId, reviewUuid }: { childId: string; reviewUuid: string }) {
  const status = useAtomValue(mergeChildStatusAtomFamily(childId));
  const errorMessage = useAtomValue(mergeChildErrorAtomFamily(childId));
  const tone: 'active' | 'accent' | 'neutral' =
    status === 'complete' ? 'accent' : status === 'error' ? 'neutral' : 'active';
  const label = status === 'complete' ? '✓' : status === 'error' ? '!' : '…';
  const title =
    status === 'complete'
      ? `REVIEW_DOC_${reviewUuid}.txt`
      : status === 'error'
        ? (errorMessage ?? `Review did not produce ${reviewUuid}`)
        : 'Reviewing…';
  return (
    <MobileBadge tone={tone} title={title} style={{ fontSize: 11, gap: 4 }}>
      <span aria-hidden="true">{label}</span> {reviewUuid.slice(0, 8)}
      {status === 'error' && errorMessage ? (
        <span style={{ opacity: 0.7, marginLeft: 4 }}>{errorMessage.slice(0, 40)}</span>
      ) : null}
    </MobileBadge>
  );
}

function MobileSubAgentPanel({ subAgents }: { subAgents: SubAgent[] }) {
  const active = subAgents.filter((a) => a.status === 'running' || a.status === 'pending');
  const completed = subAgents.filter((a) => a.status === 'completed' || a.status === 'error').slice(-3);
  const display = [...active, ...completed];
  if (display.length === 0) return null;
  return (
    <MobileSection title="Sub-agents" meta={`${active.length} running · ${subAgents.length} total`}>
      <div style={{ display: 'grid', gap: 8 }}>
        {display.map((agent) => (
          <MobileSurface key={agent.id} style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <MobileBadge tone={agent.status === 'running' || agent.status === 'pending' ? 'active' : agent.status === 'error' ? 'neutral' : 'accent'} style={{ marginTop: 2 }}>
              {agent.status === 'running' || agent.status === 'pending' ? '●' : agent.status === 'error' ? '!' : '✓'}
            </MobileBadge>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.description || agent.id}
              </div>
              {agent.currentAction ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.currentAction}
                </div>
              ) : null}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {agent.toolUses ? <span>{agent.toolUses} tools</span> : null}
                {agent.tokens ? <span>{agent.tokens >= 1000 ? `${(agent.tokens / 1000).toFixed(1)}k` : agent.tokens} tokens</span> : null}
                {agent.status ? <span style={{ textTransform: 'capitalize' }}>{agent.status}</span> : null}
              </div>
            </div>
          </MobileSurface>
        ))}
      </div>
    </MobileSection>
  );
}

function MobileResumeWidget({
  sourceConversationId,
  sourceConversation,
}: {
  sourceConversationId: string;
  sourceConversation: Conversation | null;
}) {
  const displayId = sourceConversation?.id?.substring(0, 8) ?? sourceConversationId.substring(0, 8);
  const provider = sourceConversation?.provider ?? 'claude';
  const folder = sourceConversation?.workingDirectory?.replace(/^\/Users\/[^/]+/, '~');
  return (
    <MobileSection title="Resumed from">
      <Link to={`/chat/${sourceConversationId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <MobileSurface style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden="true">↩</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {displayId} <MobileBadge tone="neutral" style={{ marginLeft: 6, fontSize: 10 }}>{provider}</MobileBadge>
            </div>
            {folder ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {folder}
              </div>
            ) : null}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }} aria-hidden="true">Open ›</span>
        </MobileSurface>
      </Link>
    </MobileSection>
  );
}

function MobileSwarmPrefix({ prefix, swarmId }: { prefix: string; swarmId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const stats = useMemo(() => parseStatsFromPrefix(prefix), [prefix]);
  const isSetup = prefix.includes('You are helping create and run a NEW oompa swarm configuration');
  const label = isSetup ? 'Setup' : (swarmId ?? 'debug');
  const title = isSetup ? 'SWARM SETUP' : 'SWARM DEBUG';

  const chips: Array<{ label: string; value: string }> = [];
  if (stats.completed) chips.push({ label: 'Done', value: stats.completed });
  if (stats.merges) chips.push({ label: 'Merges', value: stats.merges });
  if (stats.rejections && stats.rejections !== '0') chips.push({ label: 'Rej', value: stats.rejections });
  if (stats.errors && stats.errors !== '0') chips.push({ label: 'Err', value: stats.errors });

  return (
    <MobileSection title={title} meta={label}>
      <MobileSurface style={{ padding: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
          {chips.length > 0 ? (
            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {chips.map((c) => (
                <MobileBadge key={c.label} tone="neutral" style={{ fontSize: 10 }}>{c.value} {c.label}</MobileBadge>
              ))}
            </span>
          ) : null}
        </button>
        {expanded ? (
          <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border-subtle)', marginTop: 0 }}>
            <div style={{ display: 'grid', gap: 6, paddingTop: 10 }}>
              {stats.project ? <SwarmRow k="Project" v={stats.project} mono /> : null}
              {stats.primaryConfig ? <SwarmRow k="Primary Config" v={stats.primaryConfig} mono /> : null}
              {stats.generatedAt ? <SwarmRow k="Generated" v={stats.generatedAt} /> : null}
              {stats.started ? <SwarmRow k="Started" v={stats.started} /> : null}
              {stats.runsDir ? <SwarmRow k="Runs" v={stats.runsDir} mono /> : null}
              {stats.iterations ? (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                  <SwarmStat label="Completed" value={stats.completed ?? '—'} />
                  <SwarmStat label="Cycles" value={stats.iterations} />
                  <SwarmStat label="Merges" value={stats.merges ?? '0'} />
                  <SwarmStat label="Rejections" value={stats.rejections ?? '0'} />
                  <SwarmStat label="Errors" value={stats.errors ?? '0'} />
                </div>
              ) : null}
            </div>
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Raw CLI context</summary>
              <pre style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'var(--bg-page)', fontSize: 10, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}>
                {prefix}
              </pre>
            </details>
          </div>
        ) : null}
      </MobileSurface>
    </MobileSection>
  );
}

function SwarmRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', flex: 'none', minWidth: 90 }}>{k}</span>
      <span style={{ fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{v}</span>
    </div>
  );
}

function SwarmStat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 52 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
    </span>
  );
}

export function ConversationView({
  conversationId,
  onBack,
  headerAside,
}: {
  conversationId: string;
  /** Omit to render no back control (embedded use). */
  onBack?: () => void;
  headerAside?: ReactNode;
}) {
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const detailsLoaded = useAtomValue(conversationDetailsLoadedAtomFamily(conversationId));
  const streamingText = useAtomValue(streamingAtomFamily(conversationId));
  const pendingCreation = useAtomValue(pendingCreationAtomFamily(conversationId));
  const conversationLoadComplete = useAtomValue(conversationLoadCompleteAtom);
  const pendingConfigCommand = useAtomValue(pendingConfigCommandAtomFamily(conversationId));
  const childConversations = useAtomValue(childConversationsAtomFamily(conversationId));
  // Queue — shared atom family with desktop (no new state). Hook before early return.
  const queue = useAtomValue(queueAtomFamily(conversationId ?? ''));
  const { catalog } = useProviderCatalog();

  const [detailError, setDetailError] = useState<string | null>(null);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Prompt palette — shared hook (logic) + mobile sheet (UI). Mirrors Chat.tsx.
  // Owned here so the palette is available at the conversation-pane level:
  // ChatMobile is a thin wrapper and buddy inline threads embed ConversationView
  // directly — owning it here means both get the palette without duplication.
  // The composer remains thin: it only renders save/ palette buttons and forwards
  // selections via prop + custom event bridge.
  const {
    savePrompt,
    prompts: savedPrompts,
    fuzzySearch,
    incrementUsage,
    deletePrompt,
  } = useSavedPrompts();
  const [showPalette, setShowPalette] = useState(false);
  const [paletteSelectedContent, setPaletteSelectedContent] = useState<string | null>(null);

  // Dual-active-id: ephemeral routing atom `activeConversationIdAtom`
  // (conversations.ts) + persisted `savedActiveConversationIdAtom` (atoms/ui).
  // Cleanup clears only the ephemeral one (preserve persisted truth).
  useEffect(() => {
    if (!conversationId) return;
    setActiveConversationId(conversationId);
    setSavedActiveConversationId(conversationId);
    return () => {
      setActiveConversationId(null);
    };
  }, [conversationId]);

  // Load boundary: gate on conversationDetailsLoadedAtomFamily, lazy HTTP fetch
  useEffect(() => {
    if (!conversationId || !conversation || detailsLoaded) {
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    void loadConversationDetails(conversationId).catch((e) => {
      if (!cancelled) setDetailError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, conversation, detailsLoaded]);

  // Merge streaming at render time — never write messages mid-stream
  const messages = useMemo(() => {
    if (!conversation) return [];
    if (!streamingText) return conversation.messages;
    const msgs = conversation.messages.slice();
    const last = msgs[msgs.length - 1];
    if (last?.role !== 'assistant') return conversation.messages;
    msgs[msgs.length - 1] = { ...last, content: last.content + streamingText };
    return msgs;
  }, [conversation, streamingText]);

  // Same derivation as Chat.tsx: unified sub-agents + swarm prefix + resume lineage.
  // Reuses shared utils so desktop and mobile cannot drift.
  const unifiedSubAgents = useMemo(() => {
    if (!conversation) return [];
    return buildUnifiedSubAgents(conversation, childConversations);
  }, [conversation, childConversations]);

  const buddyContext = useMemo(() => getBuddyContext(conversation as Parameters<typeof getBuddyContext>[0]), [conversation]);

  const visibleSwarmDebugPrefix = useMemo(() => {
    if (!conversation) return null;
    return effectiveSwarmDebugPrefix(buddyContext, conversation.swarmDebugPrefix ?? null, conversation.kind ?? null);
  }, [buddyContext, conversation]);

  const resumedFromConversationId = conversation?.resumedFromConversationId ?? '';
  const resumedFromConversation = useAtomValue(conversationAtomFamily(resumedFromConversationId));

  // Mark seen when last message becomes visible (IntersectionObserver plumbing §4)
  useEffect(() => {
    if (messages.length === 0) return;
    const el = lastMessageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markMessagesSeen(conversationId, messages.length - 1);
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conversationId, messages.length]);

  // Prompt palette: Ctrl+P / Cmd+P at the pane level (matches desktop Chat.tsx).
  // Owned here so hardware keyboards work even when composer textarea is not focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPalette(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-scroll to bottom on new messages (flat list, not virtualized — iOS momentum)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if near bottom (avoid fighting user scroll)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingText]);

  const handlePaletteSelect = (content: string) => {
    // Push into composer via prop (primary) + event bridge (fallback if composer remounts)
    setPaletteSelectedContent(content);
    window.dispatchEvent(new CustomEvent('prompt-palette:select', { detail: content }));
    setShowPalette(false);
    // Clear after a tick so repeated same-content selections re-trigger the effect
    setTimeout(() => setPaletteSelectedContent(null), 0);
  };

  // Also scroll to bottom on mount / conversation switch
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId]);

  // Turn diagnostics — same hook desktop Chat.tsx uses (hooks/useTurnDiagnostics)
  // + same derived view model (utils/turn-diagnostics). Reuses existing atoms
  // and polling, not new state. Must stay before early returns.
  const runtimeIsRunning = conversation?.isRunning ?? false;
  const runtimeIsStreaming = conversation?.isStreaming ?? false;
  const runtimeTurnActive = runtimeIsRunning || runtimeIsStreaming;
  const { attempt: latestTurnAttempt } = useTurnDiagnostics(
    conversationId || undefined,
    runtimeTurnActive
  );
  const turnDiagnostics =
    latestTurnAttempt && shouldPresentTurnAttempt(latestTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(latestTurnAttempt)
      : null;
  const showTyping = shouldShowTypingIndicator(runtimeIsStreaming, streamingText ?? '');

  // All hooks above early returns (React hook ordering)
  if (!conversationId) {
    return <div className="mobile-chat__notice">No conversation selected.</div>;
  }

  // A pending creation is a real conversation the server has not acked yet.
  // Showing "not found" here is what made every new plain conversation look
  // broken; buddy threads dodged it only because their POST creates the
  // conversation server-side before the client ever routes to it.
  if (!conversation && pendingCreation) {
    const pendingDir = pendingCreation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
    return (
      <div className="mobile-chat">
        <div className="mobile-chat__header">
          <div className="mobile-chat__titlebar">
            {onBack ? (
              <button
                type="button"
                className="mobile-chat__back"
                onClick={onBack}
                aria-label="Back to chats"
              >
                ←
              </button>
            ) : null}
            <div className="mobile-chat__heading">
              <div className="mobile-chat__dir" title={pendingCreation.workingDirectory}>
                {pendingDir}
              </div>
              <div className="mobile-chat__status">
                {pendingCreation.error
                  ? 'creation failed'
                  : `starting ${pendingCreation.config.provider}…`}
              </div>
            </div>
          </div>
        </div>
        <div className="mobile-chat__loading">
          {pendingCreation.error ? (
            <div className="mobile-chat__creation-error" role="alert">
              <p>Could not create this conversation.</p>
              <p className="mobile-chat__creation-error-detail">{pendingCreation.error}</p>
              <Link to="/" className="mobile-chat__back-link">
                ← Back to chats
              </Link>
            </div>
          ) : (
            `Starting ${pendingCreation.config.provider} in ${pendingDir}…`
          )}
        </div>
        {/* Composer stays mounted but inert: the server has no session to
            accept a message for yet, and a queued send would hang forever. */}
        <ComposerMobile
          conversationId={conversationId}
          isRunning={false}
          isStreaming={false}
          queue={[]}
          disabledReason={
            pendingCreation.error ? 'Creation failed' : 'Waiting for the server to confirm…'
          }
          onOpenPalette={() => setShowPalette(true)}
          onSavePrompt={savePrompt}
          paletteSelectedContent={paletteSelectedContent}
        />
      </div>
    );
  }

  if (!conversation) {
    // Genuinely absent — but only once the list has actually finished loading.
    if (!conversationLoadComplete) {
      return <div className="mobile-chat__notice">Loading conversations…</div>;
    }
    return (
      <div className="mobile-chat__notice">
        <div style={{ marginBottom: 12 }}>
          <Link to="/" className="mobile-chat__back-link">
            ← Back to chats
          </Link>
        </div>
        Conversation not found. It may have been deleted.
      </div>
    );
  }

  if (!detailsLoaded) {
    return (
      <div className="mobile-chat">
        <div className="mobile-chat__header">
          <div className="mobile-chat__titlebar">
            {onBack ? (
              <button
                type="button"
                className="mobile-chat__back"
                onClick={onBack}
                aria-label="Back to chats"
              >
                ←
              </button>
            ) : null}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{conversationId.slice(0, 8)}</span>
          </div>
        </div>
        <div className="mobile-chat__loading">{detailError ?? 'Loading conversation history…'}</div>
      </div>
    );
  }

  const dirDisplay = conversation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
  const isRunning = conversation.isRunning ?? false;
  const isStreaming = conversation.isStreaming ?? false;
  // queue already derived via queueAtomFamily before early returns — keeps hook order
  const configSaving = !!pendingConfigCommand && !pendingConfigCommand.error;
  const configError = pendingConfigCommand?.error ?? null;

  const hasThreadContext = unifiedSubAgents.length > 0 || !!conversation.resumedFromConversationId;
  const showSwarmPrefix = !!visibleSwarmDebugPrefix;

  return (
    <div className="mobile-chat">
      <div className="mobile-chat__header">
        <div className="mobile-chat__titlebar">
          {onBack ? (
            <button
              type="button"
              className="mobile-chat__back"
              onClick={onBack}
              aria-label="Back to chats"
            >
              ←
            </button>
          ) : null}
          <div className="mobile-chat__heading">
            <div className="mobile-chat__dir" title={conversation.workingDirectory}>
              {dirDisplay}
            </div>
            <div className="mobile-chat__status">
              {/* One compact line: status + model. The model used to be three
                  always-visible dropdown chips that wrapped onto two or three
                  rows on a phone and ate a third of the screen. */}
              {isRunning || isStreaming ? (
                <span className="mobile-chat__status--running">● running</span>
              ) : queue.length > 0 ? (
                <span>{queue.length} queued</span>
              ) : (
                <span>idle</span>
              )}
              {conversation.config ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="mobile-chat__model"
                    onClick={() => setModelSheetOpen(true)}
                    aria-haspopup="dialog"
                    title="Change model"
                  >
                    {modelSummary(conversation.config, catalog)}
                    {configSaving ? ' …' : ''}
                    <span aria-hidden="true"> ▾</span>
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="mobile-chat__actions">
            {headerAside}
            <CopyThreadButton conversation={conversation} />
            <ForkButton conversation={conversation} />
          </div>
        </div>

        {/* Config rejections were previously invisible on mobile — the picker
            closed and the label silently reverted on the next server snapshot. */}
        {configError ? (
          <div className="mobile-chat__config-error" role="alert">
            {configError}
          </div>
        ) : null}
        {turnDiagnostics ? (
          <div className="mobile-chat__turn-status-row">
            <TurnStatusMobile diagnostics={turnDiagnostics} />
          </div>
        ) : null}
      </div>

      {/* Thread-context strip — mirrors Chat.tsx: MergeProgressStrip + SubAgentPanel + ResumeThreadWidget + SwarmConvoPrefix,
          rendered with MobileSection/MobileSurface primitives and shared data derivation. */}
      {(conversation.mergeParentMeta || hasThreadContext || showSwarmPrefix) && (
        <div className="mobile-chat__thread-context" style={{ padding: '10px 12px 0', display: 'grid', gap: 10 }}>
          {conversation.mergeParentMeta ? <MobileMergeProgressStrip parent={conversation} /> : null}
          {unifiedSubAgents.length > 0 ? <MobileSubAgentPanel subAgents={unifiedSubAgents} /> : null}
          {conversation.resumedFromConversationId ? (
            <MobileResumeWidget
              sourceConversationId={conversation.resumedFromConversationId}
              sourceConversation={resumedFromConversation ?? null}
            />
          ) : null}
          {showSwarmPrefix ? (
            <MobileSwarmPrefix prefix={visibleSwarmDebugPrefix!} swarmId={conversation.swarmId ?? null} />
          ) : null}
        </div>
      )}

      {/* Flat message list — not virtualized, iOS momentum-scroll (§10 Phase 1) */}
      <div ref={scrollRef} className="mobile-chat__messages">
        {messages.length === 0 ? (
          <div className="mobile-chat__empty">No messages yet. Send a message to start.</div>
        ) : (
          messages.map((msg, idx) => (
            <MessageRow
              key={`${idx}-${msg.timestamp ? new Date(msg.timestamp).getTime() : idx}`}
              message={msg}
              isLast={idx === messages.length - 1}
              lastMessageRef={lastMessageRef}
            />
          ))
        )}
        {(isRunning || isStreaming) && !streamingText && !turnDiagnostics && (
          <div className="mobile-chat__thinking">Thinking…</div>
        )}
        {showTyping && (
          <div className="mobile-chat__typing" aria-live="polite">
            <span className="mobile-chat__typing-dot" />
            <span className="mobile-chat__typing-dot" />
            <span className="mobile-chat__typing-dot" />
          </div>
        )}
      </div>

      <MobileQueueStrip conversationId={conversation.id} queue={queue} />

      <ComposerMobile
        conversationId={conversation.id}
        isRunning={isRunning}
        isStreaming={isStreaming}
        queue={queue}
        onOpenPalette={() => setShowPalette(true)}
        onSavePrompt={savePrompt}
        paletteSelectedContent={paletteSelectedContent}
      />

      {modelSheetOpen && conversation.config ? (
        <ModelSheetMobile
          conversationId={conversation.id}
          config={conversation.config}
          configRevision={conversation.configRevision}
          onClose={() => setModelSheetOpen(false)}
        />
      ) : null}

      {/* Prompt palette — mobile sheet, owned at pane level so buddy threads share it.
          Thin UI; logic lives in hooks/useSavedPrompts (same hook desktop uses). */}
      <PromptPaletteMobile
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        onSelect={handlePaletteSelect}
        prompts={savedPrompts}
        fuzzySearch={fuzzySearch}
        incrementUsage={incrementUsage}
        deletePrompt={deletePrompt}
      />
    </div>
  );
}
