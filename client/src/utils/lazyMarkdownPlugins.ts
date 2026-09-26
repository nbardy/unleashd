import { useEffect, useState } from 'react';
import type { PluggableList } from 'unified';
import { type MarkdownFlavor, type MarkdownPipeline, markdownPipeline } from './markdown-pipeline';

/**
 * ONE loading path for rehype-katex/highlight so Rollup splits them from the entry chunk. Never add
 * a static import of rehype-katex, katex CSS or highlight.js styles anywhere in client/src. See
 * docs/client-rationale.md#lazy-markdown-plugins.
 */

/** Stable module constant — an unloaded render must not churn react-markdown. */
const NO_PLUGINS: PluggableList = [];

let loadedPlugins: PluggableList | null = null;
let inFlight: Promise<PluggableList> | null = null;

/**
 * The CSS is imported here too (not from a component) so Vite emits it as an
 * async style chunk instead of inlining it into the entry stylesheet. KaTeX
 * fonts keep working: the emitted chunk keeps its hashed font URLs.
 */
function loadMarkdownPlugins(): Promise<PluggableList> {
  if (inFlight) return inFlight;
  inFlight = Promise.all([
    import('rehype-highlight'),
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
    import('highlight.js/styles/base16/solarized-dark.css'),
  ]).then(([highlightMod, katexMod]) => {
    loadedPlugins = [highlightMod.default, katexMod.default] as PluggableList;
    return loadedPlugins;
  });
  return inFlight;
}

/**
 * Returns `[]` until the chunk resolves, then the stable loaded plugin list.
 * Components already mounted after the first load get it synchronously, so
 * later messages never flash unhighlighted.
 */
export function useLazyMarkdownPlugins(): PluggableList {
  const [plugins, setPlugins] = useState<PluggableList>(() => loadedPlugins ?? NO_PLUGINS);

  useEffect(() => {
    if (loadedPlugins) return;
    let cancelled = false;
    loadMarkdownPlugins()
      .then((loaded) => {
        if (!cancelled) setPlugins(loaded);
      })
      .catch(() => {
        // Plugins are optional — markdown still renders without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return plugins;
}

/**
 * The frozen processor for `flavor` plus whatever rehype plugins have loaded.
 * Hand it to `renderMarkdownCached` / `renderMarkdownLive`
 * (utils/markdown-pipeline) — never render chat or channel text through
 * react-markdown's `<Markdown>`, which rebuilds and re-freezes the whole
 * processor on every render.
 */
export function useMarkdownPipeline(flavor: MarkdownFlavor): MarkdownPipeline {
  return markdownPipeline(flavor, useLazyMarkdownPlugins());
}
