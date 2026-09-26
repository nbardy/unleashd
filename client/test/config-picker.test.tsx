import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { type ConversationConfig, ProviderCatalogSchema } from '@unleashd/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { configGroups } from '../src/views/config/config-options';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { ConversationConfigPicker } = await import('../src/views/config/ConversationConfigPicker');

// One option list serves the desktop popover, the new-conversation form, the
// channel composer and the mobile sheet (T20). These pin the choices whose
// `next` config the server would reject if a surface got them wrong.

const catalog = ProviderCatalogSchema.parse({
  revision: 'r1',
  providers: [
    {
      id: 'claude',
      displayName: 'Claude',
      shortName: 'C',
      defaultModelId: 'opus',
      supportsRequiredMcp: true,
      models: [
        {
          id: 'opus',
          displayName: 'Opus',
          reasoning: { levels: ['low', 'high'], defaultEffort: 'high' },
        },
        { id: 'haiku', displayName: 'Haiku' },
      ],
    },
    {
      id: 'codex',
      displayName: 'Codex',
      shortName: 'X',
      defaultModelId: 'gpt',
      models: [{ id: 'gpt', displayName: 'GPT', reasoning: { levels: ['minimal', 'xhigh'] } }],
    },
  ],
});

const opusHigh: ConversationConfig = {
  provider: 'claude',
  model: { mode: 'explicit', modelId: 'opus' },
  reasoning: { mode: 'explicit', effort: 'low' },
};

const all = () => true;

function choice(
  config: ConversationConfig,
  group: string,
  key: string,
  defaults: 'listed' | 'inline' = 'listed'
) {
  const found = configGroups(config, catalog, defaults, all)
    .find((g) => g.id === group)
    ?.choices.find((c) => c.key === key);
  assert.ok(found, `${group}/${key} missing`);
  return found;
}

test('switching to a model without the current effort resets reasoning in the same config', () => {
  // The mobile sheet and the desktop popover each did this by hand; one missed
  // it and the server rejected the pair as inconsistent.
  assert.deepEqual(choice(opusHigh, 'model', 'explicit:haiku').next.reasoning, { mode: 'default' });
  const keep = { ...opusHigh, model: { mode: 'default' as const } };
  assert.deepEqual(choice(keep, 'model', 'explicit:opus').next.reasoning, opusHigh.reasoning);
});

test('switching provider resets model and reasoning to defaults', () => {
  assert.deepEqual(choice(opusHigh, 'provider', 'codex').next, {
    provider: 'codex',
    model: { mode: 'default' },
    reasoning: { mode: 'default' },
  });
});

test('inline defaults fold the default intent onto the model and effort it resolves to', () => {
  const defaults: ConversationConfig = {
    provider: 'claude',
    model: { mode: 'default' },
    reasoning: { mode: 'default' },
  };
  const groups = configGroups(defaults, catalog, 'inline', all);
  const selected = groups.map((g) => g.choices.filter((c) => c.selected).map((c) => c.key));
  assert.deepEqual(selected, [['claude'], ['explicit:opus'], ['explicit:high']]);
  // Clicking the folded choice keeps the default INTENT, not a pinned id.
  assert.deepEqual(choice(opusHigh, 'model', 'explicit:opus', 'inline').next.model, {
    mode: 'default',
  });
  assert.equal(
    groups.some((g) => g.choices.some((c) => c.key === 'default')),
    false
  );
});

test('a saved model the catalog no longer offers renders selected and unpickable', () => {
  const stale: ConversationConfig = {
    provider: 'claude',
    model: { mode: 'explicit', modelId: 'retired-model' },
    reasoning: { mode: 'default' },
  };
  const html = renderToStaticMarkup(
    <ConversationConfigPicker value={stale} catalog={catalog} onChange={() => {}} />
  );
  const input = html.match(/<input[^>]*value="explicit:retired-model"[^>]*>/)?.[0] ?? '';
  assert.match(input, /checked=""/);
  assert.match(input, /disabled=""/);
  assert.match(html, /retired-model \(unavailable\)/);
  // A model without reasoning offers no thinking-level group at all.
  assert.doesNotMatch(html, /Thinking Level/);
});
