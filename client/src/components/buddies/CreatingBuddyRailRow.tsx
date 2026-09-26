import { setConversationDone } from '../../atoms/actions';
import { BuddySigil } from './BuddySigil';
import type { OpenDm } from './ChannelAuthor';

const LABEL = 'Creating buddy';

// One Buddy Builder thread in the channels rail: italic label, archive on hover.
export function CreatingBuddyRailRow({
  conversationId,
  openDm,
  current,
}: {
  conversationId: string;
  openDm: OpenDm;
  current: boolean;
}) {
  return (
    <li className="channel-browser-buddy channel-browser-buddy--creating">
      <button
        type="button"
        className="channel-browser-buddy-link"
        aria-label={`Continue ${LABEL}`}
        aria-current={current ? 'page' : undefined}
        onClick={() => openDm(conversationId)}
      >
        <BuddySigil className="channel-browser-buddy-sigil" name={LABEL} />
        <span className="channel-browser-channel-name channel-browser-buddy-creating-label">
          {LABEL}
        </span>
      </button>
      <span className="channel-browser-buddy-actions">
        <button
          type="button"
          title="Archive this setup chat"
          aria-label="Archive Buddy setup"
          onClick={(event) => {
            event.stopPropagation();
            setConversationDone(conversationId, true);
          }}
        >
          ×
        </button>
      </span>
    </li>
  );
}
