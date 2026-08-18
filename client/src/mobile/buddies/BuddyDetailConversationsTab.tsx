import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { conversationAtomFamily } from '../../atoms/conversations';
import type { ConversationLink, Workspace } from '../../components/buddies/types';
import { EmptyState } from '../components/EmptyState';
import { ModelSheetMobile } from '../components/ModelSheetMobile';

/**
 * Per-conversation config editing reads the LIVE configRevision off the
 * conversation atom. The previous inline form hard-coded `expectedRevision: 0`
 * into a strict optimistic-concurrency check, so it succeeded only on a
 * conversation whose config had never been touched and silently failed
 * afterwards — the rejection lands in pendingConfigCommandsAtom, which this
 * tree never read. It was also a free-text effort box; the catalog-driven sheet
 * offers only values the provider actually accepts.
 */
function ConversationConfigButton({ conversationId }: { conversationId: string }) {
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const [open, setOpen] = useState(false);

  if (!conversation?.config) return null;

  return (
    <>
      <button
        type="button"
        className="mobile-cta mobile-cta--secondary mobile-cta--small"
        onClick={() => setOpen(true)}
      >
        Model
      </button>
      {open && (
        <ModelSheetMobile
          conversationId={conversationId}
          config={conversation.config}
          configRevision={conversation.configRevision}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Conversations tab (filtered/sorted via shaping, tap → /chat/:id)
// ---------------------------------------------------------------------------

export function ConversationsTab({
  visibleConversations,
  reviewCount,
  showReviewConversations,
  onToggleReviews,
  onOpenConversation,
  workspace,
  onTalk,
  availableIds,
  busy,
}: {
  visibleConversations: ConversationLink[];
  reviewCount: number;
  showReviewConversations: boolean;
  onToggleReviews: () => void;
  onOpenConversation: (conversationId: string) => void;
  workspace: Workspace | undefined;
  onTalk: () => void;
  /** Conversation ids the client actually holds — a link can outlive its thread. */
  availableIds: Set<string>;
  busy: string | null;
}) {
  return (
    <section className="mobile-buddy-section" aria-label="Conversations">
      <div className="mobile-buddy-section__toolbar">
        <button type="button" className="mobile-cta" disabled={!workspace} onClick={onTalk}>
          New buddy conversation
        </button>
        {reviewCount > 0 && (
          <label className="mobile-toggle">
            <input type="checkbox" checked={showReviewConversations} onChange={onToggleReviews} />
            Show reviews ({reviewCount})
          </label>
        )}
      </div>

      {visibleConversations.length === 0 ? (
        <EmptyState message="No conversations for this buddy." />
      ) : (
        <ul className="mobile-buddy-convo-list">
          {visibleConversations.map((conversation) => {
            const conversationId =
              conversation.conversation_id ?? conversation.unleashd_conversation_id ?? '';
            // A link can outlive its conversation. Testing only that the link
            // CARRIES an id sent stale rows to "Conversation not found".
            const available = Boolean(conversationId) && availableIds.has(conversationId);
            return (
              <li
                key={`${conversationId}-${conversation.buddy_project_id ?? 'no-project'}`}
                className="mobile-buddy-convo-card"
              >
                <div className="mobile-buddy-convo-card__header">
                  <span className={`mobile-badge mobile-badge--${conversation.status}`}>
                    {conversation.status}
                  </span>
                  {conversation.kind && <span className="mobile-badge">{conversation.kind}</span>}
                  {conversationId && !available && <span className="mobile-badge">deleted</span>}
                </div>
                {conversation.last_active_at && (
                  <p className="mobile-muted">
                    {new Date(conversation.last_active_at).toLocaleString()}
                  </p>
                )}
                {available ? (
                  <div className="mobile-buddy-section__toolbar">
                    <button
                      type="button"
                      className="mobile-cta"
                      disabled={busy !== null}
                      onClick={() => onOpenConversation(conversationId)}
                    >
                      Open chat →
                    </button>
                    <ConversationConfigButton conversationId={conversationId} />
                  </div>
                ) : (
                  <p className="mobile-muted">
                    {conversationId
                      ? 'This conversation is no longer available.'
                      : 'No linked conversation'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
