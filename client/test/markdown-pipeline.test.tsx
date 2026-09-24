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
  renderMarkdown,
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
    assert.equal(renderToStaticMarkup(renderMarkdown(pipeline, HOSTILE)), expected);
    assert.equal(renderToStaticMarkup(renderMarkdown(pipeline, HOSTILE)), expected);
  });
}
