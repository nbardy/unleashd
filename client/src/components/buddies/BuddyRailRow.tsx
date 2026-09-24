import { useNavigate } from 'react-router-dom';
import { BuddySigil } from './BuddySigil';
import { WakeIcon, WakeIndicator } from './WakeIndicator';
import { useBuddyDirectActions } from './buddy-direct-actions';

// One Buddy in the desktop channels rail. Like Slack (and the mobile Buddies
// home), the name opens the DM — the ongoing owner chat, history kept; on
// hover, Wake asks the Buddy to catch up on the channels inside that DM.
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
        aria-label={`Message ${member.name}`}
        title={action.kind === 'failed' ? action.message : member.role}
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
