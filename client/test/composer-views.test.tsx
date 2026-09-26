import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { SendControls } = await import('../src/views/composer/SendControls');

const noop = () => undefined;
const controls = (presentation: 'labelled' | 'icons', turnActive: boolean) =>
  renderToStaticMarkup(
    <SendControls
      presentation={presentation}
      turnActive={turnActive}
      hasQueue={false}
      canSend
      onSend={noop}
      onInterrupt={noop}
      onQueue={noop}
      onStop={noop}
    />
  );

// Regression: a phone has no Tab key, and before the mobile Queue button the
// only send path during a running turn was Interrupt, which destroys the turn's
// partial progress. Desktop queues with Tab and says so. Both trees must keep a
// non-destructive way to add a follow-up mid-turn.
test('a running turn offers queueing, not only interrupt, on both composers', () => {
  const icons = controls('icons', true);
  assert.match(icons, /aria-label="Interrupt"/);
  assert.match(icons, /aria-label="Queue message"/);
  assert.match(icons, /aria-label="Stop all work"/);
  const labelled = controls('labelled', true);
  assert.match(labelled, />Interrupt</);
  assert.match(labelled, /Tab to queue/);

  // Idle: the primary action sends and nothing offers to stop or queue.
  assert.doesNotMatch(controls('icons', false), /Queue message|Stop all work|Interrupt/);
  assert.doesNotMatch(controls('labelled', false), /Tab to queue|Interrupt/);
});
