import type { Nodes, Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { urlAttributes } from 'html-url-attributes';
import type { Root as MdastRoot } from 'mdast';
import type { ReactElement } from 'react';
import { type Components, type UrlTransform, defaultUrlTransform } from 'react-markdown';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { type PluggableList, type Processor, unified } from 'unified';

/**
 * Markdown rendering with the unified processor built ONCE per plugin config,
 * not once per message.
 *
 * Why this exists: react-markdown's `<Markdown>` builds a fresh
 * `unified().use(...)` chain on every render and `parse()` freezes it, which
 * re-runs every plugin attacher — remark-gfm/remark-math re-assemble their
 * micromark extensions and rehype-highlight builds a new lowlight instance
 * with every bundled grammar. Measured 2026-09-25 opening a 1,099-message
 * conversation on mobile (4x CPU throttle): react-markdown was 1,060 of the
 * 1,255ms commit, ~391ms of it in unified `freeze()` alone. Desktop paid the
 * same per virtualized row (66 of 158ms).
 *
 * The shape: a `MarkdownFlavor` is a module constant (remark plugins + URL
 * policy); `markdownPipeline(flavor, rehypePlugins)` returns the one frozen
 * processor for that flavor and rehype plugin list (the lazy katex/highlight
 * list from `useLazyMarkdownPlugins` is itself stable, so this is a WeakMap
 * hit). The finished hast tree per (pipeline, content) of SETTLED content is
 * kept in a bounded module LRU, so a row that remounts — virtualizer scroll,
 * mobile "load earlier", re-opening a conversation — skips parse + highlight
 * entirely and only pays the hast→React conversion. A message a streaming turn
 * is still appending to goes through `renderMarkdownLive` and never enters it.
 *
 * Cached trees are shared across renders and handed to components as `node`,
 * so they must never be mutated after `compileCached()` finishes. Everything
 * react-markdown's post-pass did in place (raw HTML → text, URL policy) is done
 * once here, before the tree enters the cache.
 */

export interface MarkdownFlavor {
  readonly remarkPlugins: PluggableList;
  readonly urlTransform: UrlTransform;
  readonly pipelines: WeakMap<PluggableList, MarkdownPipeline>;
}

export interface MarkdownPipeline {
  readonly id: number;
  readonly processor: Processor<MdastRoot, MdastRoot, Root, undefined, undefined>;
  readonly urlTransform: UrlTransform;
}

/** Define at module scope — the flavor object is the processor cache key. */
export function defineMarkdownFlavor(
  remarkPlugins: PluggableList,
  urlTransform: UrlTransform = defaultUrlTransform
): MarkdownFlavor {
  return { remarkPlugins, urlTransform, pipelines: new WeakMap() };
}

let nextPipelineId = 0;

export function markdownPipeline(
  flavor: MarkdownFlavor,
  rehypePlugins: PluggableList
): MarkdownPipeline {
  const existing = flavor.pipelines.get(rehypePlugins);
  if (existing) return existing;
  const processor = unified()
    .use(remarkParse)
    .use(flavor.remarkPlugins)
    // Same option react-markdown passes: raw HTML survives into hast as `raw`
    // nodes, which applyOutputPolicy() then turns into literal text.
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypePlugins)
    .freeze() as unknown as MarkdownPipeline['processor'];
  const pipeline: MarkdownPipeline = {
    id: nextPipelineId++,
    processor,
    urlTransform: flavor.urlTransform,
  };
  flavor.pipelines.set(rehypePlugins, pipeline);
  return pipeline;
}

/**
 * Bounded twice: by entries (a chat window renders tens of messages, the
 * desktop virtualizer only its visible rows, so 600 covers scrolling back and
 * forth through a long conversation plus a few recently opened ones) AND by
 * total source characters, because a hast tree costs tens of bytes per source
 * character and a handful of huge transcripts must not pin hundreds of MB.
 *
 * Only settled content belongs here — see `renderMarkdownLive`.
 */
const MAX_CACHED_TREES = 600;
const MAX_CACHED_SOURCE_CHARS = 1_000_000;
const trees = new Map<string, { tree: Root; sourceChars: number }>();
let cachedSourceChars = 0;

/**
 * Cached trees are shared, so outside production builds they are deep-frozen:
 * a component override that mutates its `node` throws at the mutation instead
 * of silently corrupting every later render of that message. Vite sets
 * `import.meta.env`; under the node test runner it is absent, so tests freeze.
 */
const FREEZE_CACHED_TREES = import.meta.env?.PROD !== true;

function deepFreeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) deepFreeze(child);
  }
}

function compileFresh(pipeline: MarkdownPipeline, content: string): Root {
  const { processor } = pipeline;
  const tree = processor.runSync(processor.parse(content), content);
  applyOutputPolicy(tree, pipeline.urlTransform);
  return tree;
}

function compileCached(pipeline: MarkdownPipeline, content: string): Root {
  const key = `${pipeline.id}\u0000${content}`;
  const cached = trees.get(key);
  if (cached) {
    // Map iteration order is insertion order: re-insert to mark most recent.
    trees.delete(key);
    trees.set(key, cached);
    return cached.tree;
  }
  const tree = compileFresh(pipeline, content);
  if (FREEZE_CACHED_TREES) deepFreeze(tree);
  trees.set(key, { tree, sourceChars: content.length });
  cachedSourceChars += content.length;
  // A single entry larger than the char budget evicts everything including
  // itself: it is rendered, just never retained.
  while (trees.size > MAX_CACHED_TREES || cachedSourceChars > MAX_CACHED_SOURCE_CHARS) {
    const [oldestKey, oldest] = trees.entries().next().value as [
      string,
      { tree: Root; sourceChars: number },
    ];
    trees.delete(oldestKey);
    cachedSourceChars -= oldest.sourceChars;
  }
  return tree;
}

/** Test/diagnostic view of the settled-tree cache. */
export function markdownTreeCacheStats(): { entries: number; sourceChars: number } {
  return { entries: trees.size, sourceChars: cachedSourceChars };
}

/** react-markdown's post-pass, minus the allow/disallow options no caller uses. */
function applyOutputPolicy(node: Nodes, urlTransform: UrlTransform): void {
  if (node.type === 'element') {
    for (const key in urlAttributes) {
      if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(node.properties, key)) {
        const test = urlAttributes[key];
        if (test === null || test.includes(node.tagName)) {
          node.properties[key] = urlTransform(String(node.properties[key] || ''), key, node);
        }
      }
    }
  }
  if (!('children' in node)) return;
  node.children.forEach((child, index) => {
    if (child.type === 'raw') {
      node.children[index] = { type: 'text', value: child.value };
      return;
    }
    applyOutputPolicy(child, urlTransform);
  });
}

/** Same call shape for both lifetimes; a caller picks one, it never passes a flag. */
export type MarkdownRenderer = (
  pipeline: MarkdownPipeline,
  content: string,
  components?: Components
) => ReactElement;

function toReact(tree: Root, components: Components | undefined): ReactElement {
  return toJsxRuntime(tree, {
    Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
}

/**
 * Settled content (finished messages, channel posts): the tree is cached, so a
 * remount only pays hast→React.
 */
export const renderMarkdownCached: MarkdownRenderer = (pipeline, content, components) =>
  toReact(compileCached(pipeline, content), components);

/**
 * Content that is still growing — the message a streaming turn is appending to.
 * Every animation-frame flush is a new string, so caching it retained one tree
 * per prefix (334MB heap for one 18KB code-heavy reply, 2026-09-25) and evicted
 * every settled tree. Only the caller knows the turn is live, so it chooses this
 * renderer; the message switches to `renderMarkdownCached` once the turn ends.
 */
export const renderMarkdownLive: MarkdownRenderer = (pipeline, content, components) =>
  toReact(compileFresh(pipeline, content), components);
