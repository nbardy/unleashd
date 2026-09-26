/**
 * Clipboard writes that survive a non-secure context (LAN http has no navigator.clipboard): fall
 * back to execCommand and return whether it landed. All writes go through here (gate G5). See
 * docs/client-rationale.md#clipboard.
 */

function copyViaExecCommand(text: string): boolean {
  // execCommand only copies a live selection, so the text has to be in the
  // document. Keep the textarea off-screen but focusable, and avoid `display:
  // none` — an unrendered node cannot hold a selection.
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  const previousSelection = document.getSelection()?.rangeCount
    ? document.getSelection()?.getRangeAt(0)
    : null;

  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousSelection) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(previousSelection);
    }
  }
}

/** Resolves true when the text reached the clipboard. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Present but refused — a denied permission, or a call outside a user
    // gesture. Fall through rather than giving up.
  }
  return copyViaExecCommand(text);
}
