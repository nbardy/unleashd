import { BuddySigil } from './BuddySigil';
import type { OpenDm } from './ChannelAuthor';
import { WakeIcon, WakeIndicator } from './WakeIndicator';
import { useBuddyDirectActions } from './buddy-direct-actions';
import type { Buddy } from './types';

// One Buddy in the desktop channels rail. Like Slack (and the mobile Buddies
// home), the name opens the DM — the ongoing owner chat, history kept; on
// hover, Wake asks the Buddy to catch up on the channels inside that DM.
// The DM opens inside the channels view (`openDm`), and its row is marked
// current while it is open, like a selected channel.
export function BuddyRailRow({
  member,
  openDm,
  current,
}: {
  member: Pick<Buddy, 'id' | 'name' | 'role'>;
  openDm: OpenDm;
  current: boolean;
}) {
  const direct = useBuddyDirectActions(member.id);
  const { action } = direct;
  return (
    <li className="channel-browser-buddy" data-failed={action.kind === 'failed' || undefined}>
      <button
        type="button"
        className="channel-browser-buddy-link"
        aria-label={`Message ${member.name}`}
        title={action.kind === 'failed' ? action.message : member.role}
        aria-current={current ? 'page' : undefined}
        disabled={action.kind === 'pending'}
        onClick={() => direct.openDm(openDm)}
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
