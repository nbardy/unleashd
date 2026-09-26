import { BuddySigil } from './BuddySigil';
import { ChannelMarkdown } from './ChannelMarkdown';
import { DmNewChatDivider } from './DmNewChatDivider';
import type { DmRow } from './channel-dm';
import { clockTime } from './channel-data';
import type { ChannelTask } from './channel-text';

export type DmFrame = 'desktop' | 'mobile';

// Thread rows, used for a Buddy DM so the reply looks like a channel post.
// Desktop classes live in ChannelBrowser.css; mobile classes in mobile-channels.css.
export function DmTranscript({
  rows,
  buddyName,
  frame,
  buddyNames,
  tasks,
}: {
  rows: readonly DmRow[];
  buddyName: string;
  frame: DmFrame;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
}) {
  const desktop = frame === 'desktop';
  return (
    <ol className={desktop ? 'channel-browser-messages' : 'mobile-channel__posts'}>
      {rows.map((row) => (
        <DmTranscriptRow
          key={row.key}
          row={row}
          buddyName={buddyName}
          desktop={desktop}
          buddyNames={buddyNames}
          tasks={tasks}
        />
      ))}
    </ol>
  );
}

function DmTranscriptRow({
  row,
  buddyName,
  desktop,
  buddyNames,
  tasks,
}: {
  row: DmRow;
  buddyName: string;
  desktop: boolean;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
}) {
  switch (row.kind) {
    case 'day':
      return (
        <li className={desktop ? 'channel-browser-day' : 'mobile-channel-day'}>
          <span>{row.label}</span>
        </li>
      );
    case 'divider':
      return (
        <li className={desktop ? 'channel-browser-dm-divider' : 'mobile-channel-dm-divider'}>
          <DmNewChatDivider harness={row.harness} />
        </li>
      );
    case 'lead':
      return (
        <li
          className={
            desktop
              ? 'channel-browser-message channel-browser-message--lead'
              : 'mobile-channel-post mobile-channel-post--lead'
          }
          data-dm-author={row.author}
        >
          <BuddySigil
            className={desktop ? 'channel-browser-avatar' : 'mobile-channel-post__avatar'}
            name={row.author === 'owner' ? 'You' : buddyName}
          />
          <div
            className={
              desktop ? 'channel-browser-message-content' : 'mobile-channel-post__content'
            }
          >
            <div
              className={
                desktop ? 'channel-browser-message-heading' : 'mobile-channel-post__heading'
              }
            >
              <span className={desktop ? 'channel-browser-author' : 'mobile-channel-post__author'}>
                {row.author === 'owner' ? 'You' : buddyName}
              </span>
              <time dateTime={row.at}>{clockTime(row.at)}</time>
            </div>
            <ChannelMarkdown body={row.body} buddyNames={buddyNames} tasks={tasks} />
          </div>
        </li>
      );
    case 'continuation':
      return desktop ? (
        <li
          className="channel-browser-message channel-browser-message--continuation"
          data-dm-author={row.author}
        >
          <time className="channel-browser-gutter-time" dateTime={row.at}>
            {clockTime(row.at)}
          </time>
          <div className="channel-browser-message-content">
            <ChannelMarkdown body={row.body} buddyNames={buddyNames} tasks={tasks} />
          </div>
        </li>
      ) : (
        <li
          className="mobile-channel-post mobile-channel-post--continuation"
          data-dm-author={row.author}
        >
          <div className="mobile-channel-post__content">
            <ChannelMarkdown body={row.body} buddyNames={buddyNames} tasks={tasks} />
          </div>
        </li>
      );
  }
}
