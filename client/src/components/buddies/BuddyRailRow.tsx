import { Link, useNavigate } from 'react-router-dom';
import { BuddySigil } from './BuddySigil';
import { ProfileIcon, WakeIcon, WakeIndicator } from './WakeIndicator';
import { useBuddyDirectActions } from './buddy-direct-actions';

// One Buddy in the desktop channels rail. Like Slack, the name opens the DM
// (the ongoing owner chat, history kept); on hover, Profile opens the Buddy
// page and Wake asks the Buddy to catch up on the channels inside that DM.
export function BuddyRailRow({
  member,
  workspaceId,
}: {
  member: { id: string; name: string; role: string };
  workspaceId: string;
}) {
  const navigate = useNavigate();
  const direct = useBuddyDirectActions(member.id, workspaceId);
  const { action } = direct;
  return (
    <li className="channel-browser-buddy" data-failed={action.kind === 'failed' || undefined}>
      <button
        type="button"
        className="channel-browser-buddy-link"
        title={action.kind === 'failed' ? action.message : `Message ${member.name}`}
        disabled={action.kind === 'pending'}
        onClick={() =>
          direct.openDm((conversationId) => navigate(`/chat/${encodeURIComponent(conversationId)}`))
        }
      >
        <BuddySigil className="channel-browser-buddy-sigil" name={member.name} />
        <span className="channel-browser-channel-name">{member.name}</span>
      </button>
      {direct.woken && (
        <WakeIndicator
          key={direct.woken.attempt}
          conversationId={direct.woken.conversationId}
          name={member.name}
          className="channel-browser-buddy-status"
          doneClassName="channel-browser-buddy-done"
        />
      )}
      <span className="channel-browser-buddy-actions">
        <Link
          to={`/buddies/${encodeURIComponent(member.id)}`}
          title={`${member.name} — ${member.role}`}
          aria-label={`Open ${member.name}'s page`}
        >
          <ProfileIcon />
        </Link>
        <button
          type="button"
          title={`Wake ${member.name}: catch up on the channels and act`}
          aria-label={`Wake ${member.name}`}
          disabled={action.kind === 'pending'}
          onClick={direct.wake}
        >
          <WakeIcon />
        </button>
      </span>
    </li>
  );
}
