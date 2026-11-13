// OpenRouter's listed prices ($ per 1M tokens) for the Factory models with a clear
// OpenRouter equivalent, from https://openrouter.ai/api/v1/models on 2026-11-13.
// Used when no live OpenRouter price is fetched. Ids OpenRouter spells differently
// map as in OPENROUTER_IDS (model-refresh.ts). Left out, so they keep the estimates
// in catalog.ts: models with no OpenRouter equivalent, and the models in
// MAKER_LISTED_COSTS.
export const OPENROUTER_LISTED_COSTS: Readonly<
  Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
> = {
  "claude-fable-5.2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  "claude-fable-5.1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-5-20251101": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gpt-6.1-terra": { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "gpt-5.6-sol": { input: 4.4, output: 22, cacheRead: 0.44, cacheWrite: 5.5 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-5.5-pro": { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  "gpt-5.3-codex": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  "gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  "gpt-5.2-codex": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  "gpt-5.1-codex-max": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "grok-4.7": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  "grok-4.6": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  "grok-4.5": { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
  "inkling": { input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: 0 },
  "mistral-large-4": { input: 0.7, output: 2.1, cacheRead: 0.07, cacheWrite: 0 },
  "mistral-medium-3.5": { input: 1.5, output: 7.5, cacheRead: 0, cacheWrite: 0 },
  "glm-5.3-flash": { input: 0.0399, output: 0.0784, cacheRead: 0.03, cacheWrite: 0 },
  "glm-5.1": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  "glm-5": { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  "glm-4.7": { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
  "glm-4.6": { input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  "kimi-k3.1-pro": { input: 0.2375, output: 8.4114, cacheRead: 0.2, cacheWrite: 0 },
  "kimi-k2.7-code": { input: 0.6, output: 3.5, cacheRead: 0.16, cacheWrite: 0 },
  "kimi-k2.6": { input: 0.65, output: 3.41, cacheRead: 0.15, cacheWrite: 0 },
  "kimi-k2.5": { input: 0.5, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
  "deepseek-v4.1-flash": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
  "deepseek-v4.1-flash-1017": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
  "deepseek-v4-flash-0731": { input: 0.0434, output: 0.3, cacheRead: 0.035, cacheWrite: 0 },
  "minimax-m3": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  "minimax-m3.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  "minimax-m2.7": { input: 0.21, output: 0.84, cacheRead: 0.042, cacheWrite: 0 },
  "minimax-m2.5": { input: 0.27, output: 1.08, cacheRead: 0.027, cacheWrite: 0 },
  "nemotron-3-ultra": { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  "muse-spark-1.2": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  "muse-spark-1.3": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  "muse-spark-open": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  "beam-1.0": { input: 0.3, output: 1, cacheRead: 0.04, cacheWrite: 0 },
  "gemini-4-hydrogen": { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0.083333 },
  "gemini-4-carbon": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0.1875 },
  "gemini-4-argon": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0.1875 },
  "gemini-3.8-flash": { input: 0.825, output: 4.125, cacheRead: 0.0825, cacheWrite: 0.041667 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.041667 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.041667 },
  "gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0.083333 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.083333 },
  "gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0.375 },
};

// Models whose OpenRouter listing is far off the maker's own price (2026-11-13:
// kimi-k3 $0.192 / $16, glm-5.2 $0.007 / $6.8, glm-5.3 $0.084 / $3.6,
// deepseek-v4-pro $0.955 / $1.91). They use the maker's published API price in
// USD, read 2026-11-13, and a live OpenRouter price never replaces it.
export const MAKER_LISTED_COSTS: Readonly<
  Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
> = {
  // https://platform.kimi.ai/docs/pricing/chat (cache write: the default 5-minute TTL)
  "kimi-k3": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  // https://docs.z.ai/guides/overview/pricing (cached input storage is free)
  "glm-5.2": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  "glm-5.3": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  // https://api-docs.deepseek.com/quick_start/pricing (peak rate; off-peak is half)
  "deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
};
