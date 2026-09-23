import { type CSSProperties, useMemo } from 'react';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { SIGIL_VERSION, backgroundCss, nameGenome } from './sigil/genome';
import { renderSigil } from './sigil/render';

// One render per name per session: the resource cache dedupes concurrent
// mounts, and this memo keeps a WS-reconnect revalidation from re-rendering.
const rendered = new Map<string, Promise<string>>();

function sigilResource(name: string) {
  const key = `sigil:v${SIGIL_VERSION}:${name}`;
  return resource(key, () => {
    const existing = rendered.get(key);
    if (existing) return existing;
    const pending = renderSigil(nameGenome(name));
    rendered.set(key, pending);
    return pending;
  });
}

/**
 * Generative avatar for a Buddy, seeded by its name. Until the WebGL render
 * lands (and under react-dom/server) it shows the piece's own ground colour.
 */
export function BuddySigil({ name, className }: { name: string; className: string }) {
  const source = useMemo(() => sigilResource(name), [name]);
  const ground = useMemo(() => backgroundCss(nameGenome(name)), [name]);
  const { data } = usePolledFetch(source, 0);
  const style: CSSProperties = { background: ground };
  return data ? (
    <img className={className} src={data} alt="" style={style} />
  ) : (
    <span className={className} style={style} aria-hidden="true" />
  );
}
