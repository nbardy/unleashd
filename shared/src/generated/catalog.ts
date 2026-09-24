// DO NOT EDIT - generated from catalog.jsonc
// Source: vendor/agent-cli-tool/catalog.jsonc (revision 2026-09-24.grok-4-7)
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
  { modelName: "gpt-5.3-codex-spark", displayName: "Codex Spark", thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS, defaultThinkingOption: "xhigh", isDefault: false },
] as const;

