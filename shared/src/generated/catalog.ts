// DO NOT EDIT - generated from catalog.jsonc
// Source: vendor/agent-cli-tool/catalog.jsonc (revision 2026-09-24.gpt-6-sol-luna)
// Generator: shared/scripts/gen-catalog.ts
// Run: pnpm --filter @unleashd/shared gen:catalog

export const CLAUDE_MODEL_IDS = ["fable","claude-opus-5-5","sonnet","haiku"] as const;
export const GEMINI_MODEL_IDS = ["gemini-3.1-pro-preview","gemini-2.5-pro","gemini-2.5-flash","gemini-2.0-flash"] as const;
export const MUSE_MODEL_IDS = ["muse-spark-1.1","muse-spark-1.2-contributor","muse-spark-1.3","muse-spark-1.3-contributor"] as const;

export const CURSOR_MODEL_REGISTRY = [
  {
    "id": "composer-2.5",
    "displayName": "Composer 2.5",
    "isDefault": true
  },
  {
    "id": "grok-4.7-xhigh",
    "displayName": "Grok 4.7 Extra High",
    "isDefault": false
  },
  {
    "id": "grok-4.7-high",
    "displayName": "Grok 4.7 High",
    "isDefault": false
  },
  {
    "id": "grok-4.7-medium",
    "displayName": "Grok 4.7 Medium",
    "isDefault": false
  },
  {
    "id": "grok-4.7-low",
    "displayName": "Grok 4.7 Low",
    "isDefault": false
  },
  {
    "id": "cursor-grok-4.5-high",
    "displayName": "Grok 4.5 High",
    "isDefault": false
  },
  {
    "id": "cursor-grok-4.5-medium",
    "displayName": "Grok 4.5 Medium",
    "isDefault": false
  },
  {
    "id": "cursor-grok-4.5-low",
    "displayName": "Grok 4.5 Low",
    "isDefault": false
  }
] as const;
export const CURSOR_MODEL_IDS = ["composer-2.5","grok-4.7-xhigh","grok-4.7-high","grok-4.7-medium","grok-4.7-low","cursor-grok-4.5-high","cursor-grok-4.5-medium","cursor-grok-4.5-low"] as const;

export const CLAUDE_EFFORT_LEVELS = ["low","medium","high","xhigh","max"] as const;
export const CODEX_EFFORT_LEVELS = ["minimal","low","medium","high","xhigh","max","ultra"] as const;
export const MUSE_EFFORT_LEVELS = ["none","minimal","low","medium","high","xhigh","ultra"] as const;

export const CODEX_THINKING_OPTIONS = CODEX_EFFORT_LEVELS;
export const NO_CODEX_THINKING = "none" as const;
export const CODEX_UNIFIED_THINKING_OPTIONS = [NO_CODEX_THINKING, ...CODEX_THINKING_OPTIONS] as const;

export const CODEX_MODEL_REGISTRY = [
  { modelName: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "ultra", isDefault: true },
  { modelName: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-5.5", displayName: "GPT-5.5", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-5.4", displayName: "GPT-5.4", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-6-astra", displayName: "GPT-6 Astra", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-6-sol", displayName: "GPT-6 Sol", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-6-luna", displayName: "GPT-6 Luna", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
  { modelName: "gpt-5.3-codex-spark", displayName: "Codex Spark", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
] as const;

export type CatalogModel = {
  readonly id: string;
  readonly displayName: string;
  readonly isDefault: boolean;
  readonly reasoning?: { readonly levels: readonly string[]; readonly defaultEffort?: string };
};
export type CatalogProviderEntry = {
  readonly id: string;
  readonly defaultModelId: string;
  readonly supportsDynamicModels: boolean;
  readonly models: readonly CatalogModel[];
};
export const PROVIDER_MODEL_CATALOG: readonly CatalogProviderEntry[] = [
  {
    id: "claude",
    defaultModelId: "claude-opus-5-5",
    supportsDynamicModels: false,
    models: [
      { id: "fable", displayName: "Claude Fable 5.1", isDefault: false, reasoning: { levels: ["low","medium","high","xhigh","max"], defaultEffort: "high" } },
      { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", isDefault: true, reasoning: { levels: ["low","medium","high","xhigh","max"], defaultEffort: "high" } },
      { id: "sonnet", displayName: "Claude Sonnet", isDefault: false, reasoning: { levels: ["low","medium","high","xhigh","max"], defaultEffort: "high" } },
      { id: "haiku", displayName: "Claude Haiku", isDefault: false, reasoning: { levels: ["low","medium","high","xhigh","max"], defaultEffort: "high" } },
    ],
  },
  {
    id: "codex",
    defaultModelId: "gpt-5.6-sol",
    supportsDynamicModels: false,
    models: [
      { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", isDefault: true, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "ultra" } },
      { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-5.5", displayName: "GPT-5.5", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-5.4", displayName: "GPT-5.4", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-6-astra", displayName: "GPT-6 Astra", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-6-sol", displayName: "GPT-6 Sol", isDefault: false, reasoning: { levels: ["low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
      { id: "gpt-6-luna", displayName: "GPT-6 Luna", isDefault: false, reasoning: { levels: ["low","medium","high","xhigh","max"], defaultEffort: "xhigh" } },
      { id: "gpt-5.3-codex-spark", displayName: "Codex Spark", isDefault: false, reasoning: { levels: ["minimal","low","medium","high","xhigh","max","ultra"], defaultEffort: "xhigh" } },
    ],
  },
  {
    id: "opencode",
    defaultModelId: "opencode/big-pickle",
    supportsDynamicModels: true,
    models: [
      { id: "opencode/big-pickle", displayName: "OpenCode Big Pickle (Free)", isDefault: true },
      { id: "opencode/gpt-5-nano", displayName: "OpenCode GPT-5 Nano (Free)", isDefault: false },
      { id: "opencode/kimi-k2.5-free", displayName: "OpenCode Kimi K2.5 Free", isDefault: false },
      { id: "opencode/minimax-m2.5-free", displayName: "OpenCode MiniMax M2.5 Free", isDefault: false },
      { id: "meta/muse-spark-1.1", displayName: "Muse Spark 1.1 (Meta)", isDefault: false },
      { id: "meta/muse-spark-1.2-contributor", displayName: "Muse Spark 1.2 Contributor (Meta)", isDefault: false },
      { id: "meta/muse-spark-1.3", displayName: "Muse Spark 1.3 (Meta)", isDefault: false },
      { id: "meta/muse-spark-1.3-contributor", displayName: "Muse Spark 1.3 Contributor (Meta)", isDefault: false },
    ],
  },
  {
    id: "gemini",
    defaultModelId: "gemini-2.5-pro",
    supportsDynamicModels: false,
    models: [
      { id: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview", isDefault: false },
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", isDefault: true },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", isDefault: false },
      { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", isDefault: false },
    ],
  },
  {
    id: "cursor",
    defaultModelId: "composer-2.5",
    supportsDynamicModels: false,
    models: [
      { id: "composer-2.5", displayName: "Composer 2.5", isDefault: true },
      { id: "grok-4.7-xhigh", displayName: "Grok 4.7 Extra High", isDefault: false },
      { id: "grok-4.7-high", displayName: "Grok 4.7 High", isDefault: false },
      { id: "grok-4.7-medium", displayName: "Grok 4.7 Medium", isDefault: false },
      { id: "grok-4.7-low", displayName: "Grok 4.7 Low", isDefault: false },
      { id: "cursor-grok-4.5-high", displayName: "Grok 4.5 High", isDefault: false },
      { id: "cursor-grok-4.5-medium", displayName: "Grok 4.5 Medium", isDefault: false },
      { id: "cursor-grok-4.5-low", displayName: "Grok 4.5 Low", isDefault: false },
    ],
  },
  {
    id: "muse",
    defaultModelId: "muse-spark-1.3-contributor",
    supportsDynamicModels: false,
    models: [
      { id: "muse-spark-1.1", displayName: "Muse Spark 1.1", isDefault: false, reasoning: { levels: ["none","minimal","low","medium","high","xhigh","ultra"], defaultEffort: "high" } },
      { id: "muse-spark-1.2-contributor", displayName: "Muse Spark 1.2 Contributor", isDefault: false, reasoning: { levels: ["none","minimal","low","medium","high","xhigh","ultra"], defaultEffort: "high" } },
      { id: "muse-spark-1.3", displayName: "Muse Spark 1.3", isDefault: false, reasoning: { levels: ["none","minimal","low","medium","high","xhigh","ultra"], defaultEffort: "high" } },
      { id: "muse-spark-1.3-contributor", displayName: "Muse Spark 1.3 Contributor", isDefault: true, reasoning: { levels: ["none","minimal","low","medium","high","xhigh","ultra"], defaultEffort: "high" } },
    ],
  },
];

