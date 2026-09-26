import type { Break, Root, Text } from 'mdast';
import type { Plugin } from 'unified';

// Soft newlines in paragraphs become <br> (chat-style); code nodes are untouched. Inline instead of
// the npm package, which a broken workspace install blocked. See docs/client-rationale.md#remark-
// breaks.
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
