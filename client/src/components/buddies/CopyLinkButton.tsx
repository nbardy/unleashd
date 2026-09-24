import { useEffect, useRef, useState } from 'react';
import type { CopyState } from '../../hooks/useCopyAction';
import { copyText } from '../../utils/clipboard';

export function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8a3 3 0 0 0 4.2 4.2l.9-.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const TITLE: Record<CopyState, (label: string) => string> = {
  idle: (label) => label,
  copied: () => 'Link copied',
  failed: () => 'Could not copy — use the address bar',
};

/**
 * Copies an absolute permalink. The origin is resolved at click time, not
 * render time: components here also render through react-dom/server in
 * client/test, where there is no window.
 */
export function CopyLinkButton({
  path,
  label,
  className,
}: {
  path: string;
  label: string;
  className: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    []
  );
  const copy = () =>
    void copyText(new URL(path, window.location.href).href).then((ok) => {
      setState(ok ? 'copied' : 'failed');
      if (reset.current) clearTimeout(reset.current);
      reset.current = setTimeout(() => setState('idle'), 2000);
    });
  const title = TITLE[state](label);
  return (
    <button
      type="button"
      className={className}
      data-copy-state={state}
      onClick={copy}
      title={title}
      aria-label={title}
    >
      {state === 'copied' ? '✓' : <LinkIcon />}
    </button>
  );
}
