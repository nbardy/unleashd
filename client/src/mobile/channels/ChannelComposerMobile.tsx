import { type ComponentProps, useRef, useState } from 'react';
import { ChannelComposer } from '../../components/buddies/ChannelComposer';
import { FullscreenComposer } from '../components/FullscreenComposer';

// The channel composer on a phone, inside the conversation screen's
// FullscreenComposer: focusing the field turns it into a frame sized to the
// visual viewport, so it sits flush on the keyboard and fills the screen.
// Pinned under the transcript instead, iOS panned the page while typing and
// left the composer floating mid-screen with a gap above the keyboard
// (owner report, #bugfixes 2026-09-25).
//
// Editing mode = the textarea has focus. Safari does not focus tapped
// buttons, so a tap on Send / + / a mention chip blurs the field with no
// relatedTarget; collapsing then would move the button before its click
// lands. Pointer intent keeps the frame up until the click, then any click
// that leaves the field unfocused ends editing.
export function ChannelComposerMobile({
  title,
  ...composer
}: { title: string } & ComponentProps<typeof ChannelComposer>) {
  const [editing, setEditing] = useState(false);
  const buttonPointer = useRef(false);
  const stopEditing = () => {
    blurActiveElement();
    setEditing(false);
  };
  return (
    <FullscreenComposer expanded={editing} onClose={stopEditing}>
      <div
        className="mobile-channel-compose"
        onPointerDownCapture={(event) => {
          buttonPointer.current = Boolean((event.target as HTMLElement).closest('button'));
        }}
        onFocus={(event) => {
          if (event.target instanceof HTMLTextAreaElement) setEditing(true);
        }}
        onBlur={(event) => {
          if (!(event.target instanceof HTMLTextAreaElement)) return;
          const tappedButton = buttonPointer.current;
          buttonPointer.current = false;
          if (event.relatedTarget || tappedButton) return;
          requestAnimationFrame(() => {
            if (document.activeElement === document.body) setEditing(false);
          });
        }}
        onClick={() => {
          if (!(document.activeElement instanceof HTMLTextAreaElement)) setEditing(false);
        }}
      >
        <div className="mobile-channel-compose__head">
          <span>{title}</span>
          <button type="button" onClick={stopEditing}>
            Done
          </button>
        </div>
        <ChannelComposer {...composer} />
      </div>
    </FullscreenComposer>
  );
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}
