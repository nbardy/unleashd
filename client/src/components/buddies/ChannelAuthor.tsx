import type { BuddyListAuthor } from '@unleashd/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { useBuddyDirectActions } from './buddy-direct-actions';

// A post's author inside Channels, desktop and mobile. Like Slack, a Buddy's
// name opens the DM with it (the one ongoing owner chat, history kept —
// server/src/buddies/buddy-direct.ts), not its profile page. PostAuthor in
// BuddyMessages.tsx keeps the profile link for the Buddy pages themselves.
export function ChannelAuthor({
  author,
  buddyNames,
  workspaceId,
  className,
}: {
  author: BuddyListAuthor;
  buddyNames: Readonly<Record<string, string>>;
  workspaceId: string;
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
          className={className}
        />
      );
  }
}

function DmName({
  buddyId,
  name,
  workspaceId,
  className,
}: {
  buddyId: string;
  name: string;
  workspaceId: string;
  className: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const direct = useBuddyDirectActions(buddyId, workspaceId);
  const { action } = direct;
  return (
    <button
      type="button"
      className={className}
      data-failed={action.kind === 'failed' || undefined}
      title={action.kind === 'failed' ? action.message : `Message ${name}`}
      disabled={action.kind === 'pending'}
      onClick={() =>
        direct.openDm((conversationId) =>
          // Mobile reads the origin so Back returns to this channel; desktop ignores it.
          navigate(`/chat/${encodeURIComponent(conversationId)}`, {
            state: mobileConversationRouteState(location),
          })
        )
      }
    >
      {name}
    </button>
  );
}
