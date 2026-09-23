import type { Break, Root, Text } from 'mdast';
import type { Plugin } from 'unified';

// =============================================================================
// remarkBreaks — inline remark plugin (replaces the `remark-breaks` npm package)
//
// Standard Markdown collapses single newlines into spaces within a paragraph.
// This means plain-text output (e.g. file path lists NOT in code fences) renders
// as one long run-on line. This plugin converts soft newlines to <br> hard breaks
// in the mdast, matching chat-UI expectations where each \n is a visual line break.
//
// Shared by chat (VirtualizedMessageList) and channel posts (ChannelMarkdown).
//
// SCOPE: Only affects text nodes inside paragraphs/lists/blockquotes. Does NOT
// affect code blocks — those are `code` nodes in mdast with a `value` string
// (no children), so this visitor skips them. Code block whitespace is preserved
// by the <pre> element's `white-space: pre` CSS.
//
// WHY INLINE: The `remark-breaks` npm package does the same thing, but pnpm
// workspace install was broken by an unrelated server dependency. This is ~20
// lines and has zero external deps.
// =============================================================================
export const remarkBreaks: Plugin<[], Root> = () => (tree) => {
  const visit = (node: Root | Root['children'][number]) => {
    if (!('children' in node)) return;
    const next: Root['children'] = [];
    for (const child of node.children) {
      if (child.type === 'text') {
        const lines = (child as Text).value.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) next.push({ type: 'break' } as Break);
          if (lines[i]) next.push({ type: 'text', value: lines[i] } as Text);
        }
      } else {
        visit(child as Root['children'][number]);
        next.push(child);
      }
    }
    node.children = next as typeof node.children;
  };
  visit(tree);
};
