import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import {
  defineMarkdownFlavor,
  markdownPipeline,
  markdownTreeCacheStats,
  renderMarkdownCached,
  renderMarkdownLive,
} from '../src/utils/markdown-pipeline';

// utils/markdown-pipeline replaced react-markdown's <Markdown> for chat and
// channel text (2026-09-25, per-message processor rebuild was most of the
// mobile open cost). It re-implements react-markdown's post-pass: raw HTML
// becomes literal text and every URL goes through the URL policy. That is a
// safety boundary — a regression renders model-authored <script>/<img onerror>
// as live HTML or keeps a javascript: href — and it runs only on a tree-cache
// MISS, so the cached second render is checked too.
const HOSTILE = [
  '# Title',
  '',
  '<img src=x onerror="alert(1)"> and <b>bold html</b>',
  '',
  '[click](javascript:alert(1)) [buddy](buddy:abc) [ok](https://example.com/a?b=1)',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  'Inline $x^2$ math and `code`.',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
].join('\n');

const REHYPE: PluggableList = [rehypeHighlight];

function channelUrl(url: string): string {
  return /^(buddy|task):/.test(url) ? url : defaultUrlTransform(url);
}

for (const [name, urlTransform] of [
  ['default URL policy', defaultUrlTransform],
  ['custom URL policy', channelUrl],
] as const) {
  test(`shared pipeline renders exactly what <Markdown> renders (${name}), cached or not`, () => {
    const expected = renderToStaticMarkup(
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={REHYPE}
        urlTransform={urlTransform}
      >
        {HOSTILE}
      </Markdown>
    );
    assert.doesNotMatch(expected, /<img|<b>|javascript:/);

    const pipeline = markdownPipeline(
      defineMarkdownFlavor([remarkGfm, remarkMath], urlTransform),
      REHYPE
    );
    assert.equal(renderToStaticMarkup(renderMarkdownCached(pipeline, HOSTILE)), expected);
    assert.equal(renderToStaticMarkup(renderMarkdownCached(pipeline, HOSTILE)), expected);
    assert.equal(renderToStaticMarkup(renderMarkdownLive(pipeline, HOSTILE)), expected);
  });
}

// Regression, 2026-09-25: every streaming flush appends to the last assistant
// message, so each frame is a new content string. Rendering those through the
// cache retained one tree per prefix (334MB heap for one 18KB code-heavy
// reply) and evicted every settled tree. The growing message must go through
// the live path, which never touches the cache.
test('rendering a growing streaming message through the live path leaves the cache untouched', () => {
  const pipeline = markdownPipeline(defineMarkdownFlavor([remarkGfm, remarkMath]), REHYPE);
  const reply = HOSTILE.repeat(20);
  const before = markdownTreeCacheStats();
  for (let end = 16; end <= reply.length; end += 64) {
    renderToStaticMarkup(renderMarkdownLive(pipeline, reply.slice(0, end)));
  }
  assert.deepEqual(markdownTreeCacheStats(), before);
});

test('the settled-tree cache is bounded by total source characters, evicting oldest first', () => {
  const pipeline = markdownPipeline(defineMarkdownFlavor([]), []);
  // A component override receives the hast node itself (passNode): the same
  // object on two renders means the second was a cache hit.
  const components = { p: ({ children }: { children?: React.ReactNode }) => <p>{children}</p> };
  const paragraphNode = (doc: string): unknown => {
    const root = renderMarkdownCached(pipeline, doc, components) as React.ReactElement<{
      children: React.ReactNode;
    }>;
    const [paragraph] = React.Children.toArray(root.props.children) as React.ReactElement<{
      node: unknown;
    }>[];
    return paragraph.props.node;
  };
  // Three 400K-char documents exceed the 1M-char budget; plain paragraphs keep
  // the parse cheap. The entry cap (600) is nowhere near, so only the char
  // budget can evict.
  const [a, b, c] = ['a', 'b', 'c'].map((word) => `${word} `.repeat(200_000));
  const first = [a, b, c].map(paragraphNode);
  assert.ok(markdownTreeCacheStats().sourceChars <= 1_000_000);
  assert.equal(paragraphNode(c), first[2], 'newest document stays cached');
  assert.equal(paragraphNode(b), first[1], 'second document stays cached');
  assert.notEqual(paragraphNode(a), first[0], 'oldest document was evicted');
});

// Cached trees are shared and handed to component overrides as `node`; outside
// production builds they are frozen so a mutating override fails loudly
// instead of corrupting every later render of that message.
test('a component override that mutates a cached tree throws', () => {
  const pipeline = markdownPipeline(defineMarkdownFlavor([]), []);
  assert.throws(() =>
    renderToStaticMarkup(
      renderMarkdownCached(pipeline, 'frozen *tree*', {
        em: ({ node, children }) => {
          if (node) node.tagName = 'strong';
          return <em>{children}</em>;
        },
      })
    )
  );
});
