import type {
  ConversationConfig,
  ModelSelection,
  Provider,
  ProviderCatalog,
  ReasoningSelection,
} from '@unleashd/shared';

/**
 * The option list and grouping behind every provider / model / reasoning
 * picker. Desktop (popover, new-conversation form, channel composer) and
 * mobile (sheet) render these groups; none of them re-derives a choice.
 *
 * Values pass through verbatim — provider-bespoke effort strings are never
 * translated (docs/pass-through-pattern.md).
 */

/**
 * How the "use the default" intent is shown:
 * - `listed`: its own choice ("Provider default", "Model default");
 * - `inline`: folded onto the model / effort it resolves to, marked `default`.
 */
export type DefaultsDisplay = 'listed' | 'inline';

export type ConfigGroupId = 'provider' | 'model' | 'reasoning';

export interface ConfigChoice {
  key: string;
  label: string;
  /** Muted trailing text; null when the choice has none. */
  meta: string | null;
  selected: boolean;
  /** `unavailable`: the saved intent names something the catalog no longer offers. */
  availability: 'available' | 'unavailable';
  /** The whole config this choice produces — dependent intent already reset. */
  next: ConversationConfig;
}

export interface ConfigGroup {
  id: ConfigGroupId;
  title: string;
  choices: ConfigChoice[];
}

type ProviderEntry = ProviderCatalog['providers'][number];

function selectionKey(selection: ModelSelection | ReasoningSelection): string {
  if (selection.mode !== 'explicit') return selection.mode;
  return 'modelId' in selection ? `explicit:${selection.modelId}` : `explicit:${selection.effort}`;
}

function resolvedModelOf(provider: ProviderEntry | undefined, model: ModelSelection) {
  const id = model.mode === 'explicit' ? model.modelId : provider?.defaultModelId;
  return provider?.models.find((candidate) => candidate.id === id);
}

/**
 * A model change keeps an explicit effort only when the new model offers it:
 * the server rejects the pair otherwise. Every surface gets this in the same
 * event as the model click, so no effect can race a later click.
 */
export function withModel(
  value: ConversationConfig,
  provider: ProviderEntry | undefined,
  model: ModelSelection
): ConversationConfig {
  const levels = resolvedModelOf(provider, model)?.reasoning?.levels ?? [];
  const keeps = value.reasoning.mode !== 'explicit' || levels.includes(value.reasoning.effort);
  return { ...value, model, reasoning: keeps ? value.reasoning : { mode: 'default' } };
}

function providerGroup(
  value: ConversationConfig,
  providers: readonly ProviderEntry[]
): ConfigGroup {
  return {
    id: 'provider',
    title: 'Harness',
    choices: providers.map((option) => ({
      key: option.id,
      label: option.displayName,
      meta: null,
      selected: option.id === value.provider,
      availability: 'available',
      // Dependent intent resets with the provider.
      next:
        option.id === value.provider
          ? value
          : { provider: option.id, model: { mode: 'default' }, reasoning: { mode: 'default' } },
    })),
  };
}

function modelGroup(
  value: ConversationConfig,
  provider: ProviderEntry | undefined,
  defaults: DefaultsDisplay
): ConfigGroup {
  const modelKey = selectionKey(value.model);
  const choices: ConfigChoice[] = [];
  if (defaults === 'listed') {
    const defaultModel = provider?.models.find((m) => m.id === provider.defaultModelId);
    choices.push({
      key: 'default',
      label: 'Provider default',
      meta: defaultModel?.displayName ?? provider?.defaultModelId ?? null,
      selected: modelKey === 'default',
      availability: 'available',
      next: withModel(value, provider, { mode: 'default' }),
    });
  }
  if (value.model.mode === 'explicit' && !resolvedModelOf(provider, value.model)) {
    choices.push({
      key: modelKey,
      label: `${value.model.modelId} (unavailable)`,
      meta: null,
      selected: true,
      availability: 'unavailable',
      next: value,
    });
  }
  for (const model of provider?.models ?? []) {
    const folded = defaults === 'inline' && model.id === provider?.defaultModelId;
    choices.push({
      key: `explicit:${model.id}`,
      label: model.displayName,
      meta: folded ? 'default' : null,
      selected: modelKey === `explicit:${model.id}` || (folded && modelKey === 'default'),
      availability: 'available',
      next: withModel(
        value,
        provider,
        folded ? { mode: 'default' } : { mode: 'explicit', modelId: model.id }
      ),
    });
  }
  return { id: 'model', title: 'Model', choices };
}

function reasoningGroup(
  value: ConversationConfig,
  provider: ProviderEntry | undefined,
  defaults: DefaultsDisplay
): ConfigGroup | null {
  const reasoning = resolvedModelOf(provider, value.model)?.reasoning;
  if (!reasoning && value.reasoning.mode !== 'explicit') return null;
  const levels = reasoning?.levels ?? [];
  const current = selectionKey(value.reasoning);
  // Under `inline`, the model's default effort (or "no flag") carries the default intent.
  const defaultKey = reasoning?.defaultEffort ? `explicit:${reasoning.defaultEffort}` : 'disabled';
  const choice = (
    key: string,
    label: string,
    selection: ReasoningSelection,
    availability: ConfigChoice['availability'] = 'available'
  ): ConfigChoice => {
    const folded = defaults === 'inline' && key === defaultKey;
    return {
      key,
      label,
      meta: folded ? 'default' : null,
      selected: current === key || (folded && current === 'default'),
      availability,
      next: { ...value, reasoning: folded ? { mode: 'default' } : selection },
    };
  };
  const choices: ConfigChoice[] = [];
  if (defaults === 'listed') {
    choices.push({
      ...choice('default', 'Model default', { mode: 'default' }),
      meta: reasoning?.defaultEffort ?? 'no flag',
    });
  }
  choices.push(choice('disabled', 'No reasoning flag', { mode: 'disabled' }));
  for (const effort of levels) {
    choices.push(choice(`explicit:${effort}`, effort, { mode: 'explicit', effort }));
  }
  if (value.reasoning.mode === 'explicit' && !levels.includes(value.reasoning.effort)) {
    choices.push(
      choice(current, `${value.reasoning.effort} (unavailable)`, value.reasoning, 'unavailable')
    );
  }
  return { id: 'reasoning', title: 'Thinking Level', choices };
}

/** Provider, model and reasoning groups for `value`, in display order. */
export function configGroups(
  value: ConversationConfig,
  catalog: ProviderCatalog,
  defaults: DefaultsDisplay,
  providerFilter: (provider: Provider) => boolean
): ConfigGroup[] {
  const provider = catalog.providers.find((candidate) => candidate.id === value.provider);
  const reasoning = reasoningGroup(value, provider, defaults);
  return [
    providerGroup(
      value,
      catalog.providers.filter((option) => providerFilter(option.id))
    ),
    modelGroup(value, provider, defaults),
    ...(reasoning ? [reasoning] : []),
  ];
}

/** One-line label for a config ("Opus 5 · high"), used by compact headers. */
export function modelSummary(config: ConversationConfig, catalog: ProviderCatalog | null): string {
  const provider = catalog?.providers.find((p) => p.id === config.provider);
  const model = resolvedModelOf(provider, config.model);
  const modelId =
    config.model.mode === 'explicit' ? config.model.modelId : provider?.defaultModelId;
  const name = model?.displayName ?? modelId ?? provider?.displayName ?? config.provider;
  const effort =
    config.reasoning.mode === 'explicit'
      ? config.reasoning.effort
      : config.reasoning.mode === 'disabled'
        ? 'no reasoning'
        : null;
  return effort ? `${name} · ${effort}` : name;
}
