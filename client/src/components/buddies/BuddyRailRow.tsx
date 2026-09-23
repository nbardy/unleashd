import { Link, useNavigate } from 'react-router-dom';
import { BuddySigil } from './BuddySigil';
import { DmIcon, WakeIcon, WakeIndicator } from './WakeIndicator';
import { useBuddyDirectActions } from './buddy-direct-actions';

// One Buddy in the desktop channels rail: the name opens the Buddy page; on
// hover, DM opens the ongoing owner chat (history kept) and Wake asks the
// Buddy to catch up on the channels inside that DM.
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
      <Link
        className="channel-browser-buddy-link"
        to={`/buddies/${encodeURIComponent(member.id)}`}
        title={action.kind === 'failed' ? action.message : member.role}
      >
        <BuddySigil className="channel-browser-buddy-sigil" name={member.name} />
        <span className="channel-browser-channel-name">{member.name}</span>
      </Link>
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
        <button
          type="button"
          title={`Message ${member.name}`}
          aria-label={`Message ${member.name}`}
          disabled={action.kind === 'pending'}
          onClick={() =>
            direct.openDm((conversationId) =>
              navigate(`/chat/${encodeURIComponent(conversationId)}`)
            )
          }
        >
          <DmIcon />
        </button>
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
