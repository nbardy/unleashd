/**
 * Codex now reports its weekly window as `primary` with `secondary` absent.
 * The panel must show that single window by its duration, not as a "168h" or
 * slot-named gauge.
 */
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
const { RateLimitGroup } = await import('../src/components/UsagePanel');

test('a weekly-only Codex payload renders one 7d gauge', () => {
  const html = renderToStaticMarkup(
    <RateLimitGroup
      provider="codex"
      limits={[{ label: '7d limit', usedPercent: 42, windowMinutes: 10_080, resetsAt: null }]}
    />
  );
  assert.equal(html.match(/usage-rate-gauge/g)?.length, 1);
  assert.match(html, /7d limit/);
  assert.match(html, /42% used/);
  assert.doesNotMatch(html, /168h|Weekly/);
});
