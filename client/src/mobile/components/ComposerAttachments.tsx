import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PendingFile } from '../../hooks/usePendingAttachments';
import './composer-attachments.css';

export function ComposerAttachments({
  files,
  onRemove,
}: {
  files: PendingFile[];
  onRemove: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!files.length) setOpen(false);
  }, [files.length]);
  useLayoutEffect(() => {
    if (!open) return;
    const pages = pagesRef.current;
    const page = pages?.children[selected] as HTMLElement | undefined;
    if (pages && page)
      pages.scrollLeft = page.offsetLeft - (pages.firstElementChild as HTMLElement).offsetLeft;
  }, [open, selected]);
  if (!files.length) return null;
  return (
    <div className="composer-attachments">
      {open && (
        <section className="composer-attachments__gallery" aria-label="Attachment previews">
          <header>
            <span>{files.length} attachments</span>
            <button type="button" onClick={() => setOpen(false)}>
              Close previews
            </button>
          </header>
          <div ref={pagesRef} className="composer-attachments__pages">
            {files.map((file) => (
              <article className="composer-attachments__page" key={file.absolutePath}>
                {file.previewUrl ? (
                  <img src={file.previewUrl} alt={file.originalName} />
                ) : (
                  <span className="composer-attachments__document">Document</span>
                )}
                <footer>
                  <span>{file.originalName}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(file.absolutePath)}
                    aria-label={`Remove ${file.originalName}`}
                  >
                    Remove
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="composer-attachments__strip" aria-label="Attached files">
        {files.map((file, index) => (
          <button
            type="button"
            className="composer-attachments__thumbnail"
            key={file.absolutePath}
            aria-label={`Preview ${file.originalName}`}
            aria-expanded={open}
            onClick={() => {
              setSelected(index);
              setOpen(true);
            }}
          >
            {file.previewUrl ? (
              <img src={file.previewUrl} alt="" />
            ) : (
              <span>{file.originalName}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
