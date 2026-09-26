import { useBuddyDirectActions } from './buddy-direct-actions';
import type { Actor } from './types';

/**
 * Where a resolved DM opens: inside Channels on both devices (`?dm=`), drawn as a thread
 * (ChannelDm). Owner feedback 2026-09-25: a name click leaving Slack for the conversation list
 * felt like a different app; the phone did so until 493c1c7.
 */
export type OpenDm = (conversationId: string) => void;

// A post's author inside Channels, desktop and mobile. Like Slack, a Buddy's
// name opens the DM with it (the one ongoing owner chat, history kept —
// server/src/buddies/channels.ts openDirect), not its profile page.
export function ChannelAuthor({
  author,
  buddyNames,
  openDm,
  className,
}: {
  author: Actor;
  buddyNames: Readonly<Record<string, string>>;
  openDm: OpenDm;
  className: string;
}) {
  switch (author.kind) {
    case 'owner':
      return <span className={className}>You</span>;
    case 'buddy':
      return (
        <DmName
          buddyId={author.id}
          name={buddyNames[author.id] ?? author.id}
          openDm={openDm}
          className={className}
        />
      );
  }
}

function DmName({
  buddyId,
  name,
  openDm,
  className,
}: {
  buddyId: string;
  name: string;
  openDm: OpenDm;
  className: string;
}) {
  const direct = useBuddyDirectActions(buddyId);
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
