import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ContextBreakdownData } from '../src/components/ContextBreakdownMeter';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { breakdownTone, ContextBreakdownView, isWriteSpike } = await import(
  '../src/components/ContextBreakdownMeter'
);

function fixture(overrides: Partial<ContextBreakdownData> = {}): ContextBreakdownData {
  return {
    conversationId: 'convo-1',
    sessionId: 'sess-1',
    provider: 'claude',
    modelName: 'claude-sonnet-4-5-20250929',
    contextWindow: { source: 'model', tokens: 1_000_000, modelId: 'sonnet' },
    budgetTokens: 1_000_000,
    readingSource: 'measured',
    totalTokens: 53_000,
    residualTokens: 39_500,
    compaction: null,
    sections: {
      history: { chars: 40000, tokensEst: 10000, tokensScaled: 10000 },
      briefing: { chars: 8000, tokensEst: 2000, tokensScaled: 2000 },
      memory: { chars: 4000, tokensEst: 1000, tokensScaled: 1000 },
      mcp: { chars: 2000, tokensEst: 500, tokensScaled: 500 },
      handoff: { chars: 0, tokensEst: 0, tokensScaled: 0 },
    },
    totalChars: 54000,
    totalTokensEst: 13500,
    pctOfBudget: 5.3,
    providerUsage: {
      sessionId: 'sess-1',
      inputTokens: 100_000,
      outputTokens: 5_000,
      cacheReadTokens: 900_000,
      cacheWriteTokens: 20_000,
      cumulativeInputTokens: 1_020_000,
      ourSentChars: 54000,
      deltaTokens: 1_006_500,
      deltaMultiple: 75.5,
    },
    expansion: { message: 'get_message({messageId})', project: 'get_current_work({projectId})' },
    observedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

function spikingUsage(): NonNullable<ContextBreakdownData['providerUsage']> {
  return {
    sessionId: 'sess-1',
    inputTokens: 10_000,
    outputTokens: 1_000,
    cacheReadTokens: 10_000,
    cacheWriteTokens: 90_000,
    cumulativeInputTokens: 110_000,
    ourSentChars: 54000,
    deltaTokens: 0,
    deltaMultiple: 1,
  };
}

test('breakdownTone warns at 70% and goes strong at 85%', () => {
  assert.equal(breakdownTone(0), 'normal');
  assert.equal(breakdownTone(69.9), 'normal');
  assert.equal(breakdownTone(70), 'warn');
  assert.equal(breakdownTone(84.9), 'warn');
  assert.equal(breakdownTone(85), 'strong');
});

// The card used to carry a "Compact & continue" button and an "auto-compact at
// 90%" checkbox. Neither was wired to anything: the button revealed a notice
// admitting so, and the checkbox wrote a localStorage key nothing read. They
// are removed; this fails if a non-functional control comes back.
test('the card offers no compact controls that do nothing', () => {
  const html = renderToStaticMarkup(<ContextBreakdownView data={fixture()} />);
  assert.ok(!html.includes('Compact &amp; continue'), 'dead compact button is back');
  assert.ok(!html.includes('auto-compact'), 'dead auto-compact checkbox is back');
  assert.ok(!html.includes('ctx-autocompact'), 'dead localStorage key is back');
});

test('isWriteSpike flags cache writes above half of cumulative input', () => {
  assert.equal(isWriteSpike(fixture()), false);
  assert.equal(isWriteSpike(fixture({ providerUsage: spikingUsage() })), true);
  assert.equal(isWriteSpike(fixture({ providerUsage: null })), false);
});

// The chat header already carries the model chip, the folder and the turn
// clock. The meter there is a bar only — if a future edit puts the count back
// on the chip, this fails; if it strips the accessible label instead, the
// numbers become unreachable and the second assertion fails.
test('the header chip is a bare bar and the numbers live in its label', () => {
  const html = renderToStaticMarkup(<ContextBreakdownView data={fixture()} />);
  const trigger = /<button[^>]*ctx-breakdown__trigger[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
  assert.ok(trigger, 'no trigger rendered');
  assert.ok(!/>[^<]*\d/.test(trigger), `trigger renders digits as text: ${trigger}`);
  // A measured reading is the provider's own count against the model's real
  // 1M window -- no tilde, and no trace of the old hardcoded 200k denominator.
  assert.match(html, /aria-label="Context usage 53k\/1\.0M tok \(5% of model window\)"/);
  assert.ok(!html.includes('200k'), 'the 200k default leaked back into the header');
});

test('hover card lists all five sections with chars and estimates', () => {
  const html = renderToStaticMarkup(<ContextBreakdownView data={fixture()} />);
  for (const section of ['history', 'briefing', 'memory', 'mcp', 'handoff']) {
    assert.ok(html.includes(section), `missing legend entry for ${section}`);
  }
  assert.match(html, /40000 chars/);
  assert.match(html, /we sent .*this turn stack; provider priced .*cumulative input/);
  assert.match(html, /75\.5x re-read/);
  assert.match(html, /get_message\(\{messageId\}\)/);
  assert.match(html, /get_current_work\(\{projectId\}\)/);
});

// The bug: our store is append-only, so after a provider-side compaction our
// chars/4 estimate keeps climbing while the real context has collapsed. The
// meter must follow the provider down, not sail past 100%.
test('a compacted thread reports the boundary instead of a >100% meter', () => {
  const compacted = fixture({
    totalTokensEst: 966_000,
    totalTokens: 52_704,
    pctOfBudget: 5.27,
    residualTokens: 0,
    compaction: { detected: true, historyTokensEst: 966_000, measuredTokens: 52_704 },
  });
  const html = renderToStaticMarkup(<ContextBreakdownView data={compacted} />);
  assert.match(html, /compacted provider-side/);
  assert.match(html, /aria-label="Context usage 53k\/1\.0M tok \(5% of model window\)"/);
  assert.equal(breakdownTone(compacted.pctOfBudget), 'normal');
});

// An unrecognised model gets a conservative floor, and the label has to say so
// rather than presenting the guess as the model's actual window.
test('an unknown model window is labelled as assumed, not asserted', () => {
  const html = renderToStaticMarkup(
    <ContextBreakdownView
      data={fixture({
        contextWindow: { source: 'unknown', tokens: 200_000, modelId: 'some-future-model' },
        budgetTokens: 200_000,
      })}
    />
  );
  assert.match(html, /assumed minimum window/);
});

test('write-spike alert renders only when cache writes dominate', () => {
  const calm = renderToStaticMarkup(<ContextBreakdownView data={fixture()} />);
  assert.ok(!calm.includes('ctx-breakdown__alert'));
  const alarmed = renderToStaticMarkup(
    <ContextBreakdownView data={fixture({ providerUsage: spikingUsage() })} />
  );
  assert.ok(alarmed.includes('ctx-breakdown__alert'));
  assert.ok(alarmed.includes('write spike'));
});
