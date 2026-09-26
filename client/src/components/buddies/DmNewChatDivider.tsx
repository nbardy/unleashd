import './DmNewChat.css';

export function DmNewChatDivider({ harness }: { harness: string | null }) {
  return (
    <div className="dm-new-chat__rule" role="separator">
      <span className="dm-new-chat__pill" tabIndex={harness ? 0 : undefined}>
        New chat
        {harness ? <span className="dm-new-chat__pill-tip">{harness}</span> : null}
      </span>
    </div>
  );
}
