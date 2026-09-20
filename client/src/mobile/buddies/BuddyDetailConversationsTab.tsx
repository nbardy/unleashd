import { BuddyConversationList } from '../../components/buddies/BuddyConversationList';
import type { ConversationLink, Workspace } from '../../components/buddies/types';

export function ConversationsTab({
  conversations,
  reviewCount,
  showReviewConversations,
  onToggleReviews,
  workspace,
  onTalk,
}: {
  conversations: ConversationLink[];
  reviewCount: number;
  showReviewConversations: boolean;
  onToggleReviews: () => void;
  workspace: Workspace | undefined;
  onTalk: () => void;
}) {
  return (
    <section className="mobile-buddy-section" aria-label="Conversations">
      <div className="mobile-buddy-section__toolbar">
        <button
          type="button"
          className="mobile-buddy-new-chat"
          disabled={!workspace}
          onClick={onTalk}
        >
          + New chat
        </button>
        {reviewCount > 0 && (
          <label className="mobile-toggle">
            <input type="checkbox" checked={showReviewConversations} onChange={onToggleReviews} />
            Show reviews ({reviewCount})
          </label>
        )}
      </div>

      <BuddyConversationList
        links={conversations}
        showReviewConversations={showReviewConversations}
      />
    </section>
  );
}
