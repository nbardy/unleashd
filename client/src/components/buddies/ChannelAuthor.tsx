import type { BuddyListAuthor } from '@unleashd/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { useBuddyDirectActions } from './buddy-direct-actions';

/** Where a resolved DM opens. The caller's surface decides. */
export type OpenDm = (conversationId: string) => void;

// Leaves Channels for the conversation page. Buddy DMs opened from Channels
// stay in that view (`?dm=`) and use the thread transcript instead. This
// remains for a surface that still wants the conversation page, with Back
// returning to the screen it was opened from.
export function useChatPageDm(): OpenDm {
  const navigate = useNavigate();
  const location = useLocation();
  return (conversationId) =>
    navigate(`/chat/${encodeURIComponent(conversationId)}`, {
      state: mobileConversationRouteState(location),
    });
}

// A post's author inside Channels, desktop and mobile. Like Slack, a Buddy's
// name opens the DM with it (the one ongoing owner chat, history kept —
// server/src/buddies/buddy-direct.ts), not its profile page. PostAuthor in
// BuddyMessages.tsx keeps the profile link for the Buddy pages themselves.
export function ChannelAuthor({
  author,
  buddyNames,
  workspaceId,
  openDm,
  className,
}: {
  author: BuddyListAuthor;
  buddyNames: Readonly<Record<string, string>>;
  workspaceId: string;
  openDm: OpenDm;
  className: string;
}) {
  switch (author.kind) {
    case 'owner':
      return <span className={className}>You</span>;
    case 'buddy':
      return (
        <DmName
          buddyId={author.buddyId}
          name={buddyNames[author.buddyId] ?? author.buddyId}
          workspaceId={workspaceId}
          openDm={openDm}
          className={className}
        />
      );
  }
}

function DmName({
  buddyId,
  name,
  workspaceId,
  openDm,
  className,
}: {
  buddyId: string;
  name: string;
  workspaceId: string;
  openDm: OpenDm;
  className: string;
}) {
  const direct = useBuddyDirectActions(buddyId, workspaceId);
  const { action } = direct;
  return (
    <button
      type="button"
      className={className}
      data-failed={action.kind === 'failed' || undefined}
      title={action.kind === 'failed' ? action.message : `Message ${name}`}
      disabled={action.kind === 'pending'}
      onClick={() => direct.openDm(openDm)}
    >
      {name}
    </button>
  );
}
