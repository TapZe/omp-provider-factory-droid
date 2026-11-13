import { Effort } from "@oh-my-pi/pi-ai";
import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { CUSTOM_API } from "./constants";
import { DROID_MODELS, type DroidModel, type DroidRegion } from "./droid-registry";

export type FactoryModelFamily =
  | "anthropic"
  | "openai-responses"
  | "openai-completions"
  | "google"
  | "unsupported";

export interface ModelIdentity {
  class: string;
  family?: string;
  revision?: string;
  effort?: Effort | "off";
  thinkingVariant?: boolean;
  logicalId?: string;
}

export type FactoryModelInput = {
  id: string;
  name: string;
  reasoning: boolean;
  thinking?: ProviderModelConfig["thinking"];
  input: ProviderModelConfig["input"];
  contextWindow: number;
  maxTokens: number;
  cost?: ProviderModelConfig["cost"];
  premiumMultiplier?: number;
};

// For a model that Droid 1.3.0 ships, the reasoning, limits, image input, and multiplier
// come from its Droid row. `contextWindow` is set only where the upstream window is smaller
// than Droid's input plus output limits.
type CuratedModelInput = Pick<FactoryModelInput, "id" | "name" | "cost"> & {
  contextWindow?: number;
};

export function defaultCostFor(id: string): ProviderModelConfig["cost"] {
  // Claude family
  if (id.startsWith("claude-fable-")) {
    return { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 };
  }
  if (id.startsWith("claude-opus-5-5-fast")) {
    return { input: 8, output: 40, cacheRead: 0.8, cacheWrite: 10 };
  }
  if (id.startsWith("claude-opus-5-5")) {
    return { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 };
  }
  if (id.includes("-fast") && id.startsWith("claude-opus-")) {
    return { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 };
  }
  if (id.startsWith("claude-opus-")) {
    return { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
  }
  if (id.startsWith("claude-sonnet-5")) {
    return { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 };
  }
  if (id.startsWith("claude-sonnet-")) {
    return { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };
  }
  if (id.startsWith("claude-haiku-5-5") || id.startsWith("claude-haiku-5.5")) {
    return { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };
  }
  if (id.startsWith("claude-haiku-")) {
    return { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 };
  }
  if (id.startsWith("atlas-") || id.startsWith("aster-")) {
    return { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 };
  }

  // GPT family (OpenAI does not bill prompt cache creation / cacheWrite = 0)
  if (
    id === "gpt-6-astra" ||
    id.startsWith("gpt-6-astra") ||
    id === "gpt6-astra" ||
    id.startsWith("gpt6-astra")
  ) {
    return { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 0 };
  }
  if (
    id === "gpt-6.1-terra" ||
    id.startsWith("gpt-6.1-terra-")
  ) {
    return { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 0 };
  }
  // Factory publishes only GPT-6.1 Sol's 0.8x subscription multiplier, not
  // token prices; use the existing GPT-6 Sol estimate until live pricing resolves.
  if (
    id === "gpt-6-sol" ||
    id.startsWith("gpt-6-sol-") ||
    id === "gpt-6.1-sol" ||
    id.startsWith("gpt-6.1-sol-")
  ) {
    return { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id === "gpt-6-luna" || id.startsWith("gpt-6-luna-")) {
    return { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-sol-fast" || id.startsWith("gpt-5.6-sol-fast")) {
    return { input: 10, output: 60, cacheRead: 1.0, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-sol" || id.startsWith("gpt-5.6-sol-")) {
    return { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-terra" || id.startsWith("gpt-5.6-terra-")) {
    return { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-luna" || id.startsWith("gpt-5.6-luna-")) {
    return { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.5-pro")) {
    return { input: 30, output: 180, cacheRead: 3.0, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.5-fast")) {
    return { input: 10, output: 60, cacheRead: 1.0, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.5")) {
    return { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4-mini-fast")) {
    return { input: 1.5, output: 9.0, cacheRead: 0.15, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4-mini")) {
    return { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4-fast")) {
    return { input: 5.0, output: 30.0, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4")) {
    return { input: 2.5, output: 15.0, cacheRead: 0.25, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.3-codex-fast")) {
    return { input: 3.5, output: 28.0, cacheRead: 0.35, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.3-codex") || id.startsWith("gpt-5.2")) {
    return { input: 1.75, output: 14.0, cacheRead: 0.175, cacheWrite: 0 };
  }

  // Grok family
  if (id.startsWith("grok-")) {
    return { input: 2.0, output: 10.0, cacheRead: 0.5, cacheWrite: 0 };
  }

  // Core Open Models (Fireworks / Standard host rates)
  if (id === "inkling" || id.startsWith("inkling-")) {
    return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
  }
  // `deepseek-v4.1-*` keeps its own branch: the static catalog entry plus any
  // future docs-published V4.1 revisions bill below the generic DeepSeek rate.
  if (id === "deepseek-v4.1-flash" || id.startsWith("deepseek-v4.1-")) {
    return { input: 0.1, output: 0.27, cacheRead: 0.01, cacheWrite: 0 };
  }
  if (id.startsWith("deepseek-v4-flash")) {
    return { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 };
  }
  if (id.startsWith("deepseek-v4-pro") || id.startsWith("deepseek-")) {
    return { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 };
  }
  if (id.startsWith("glm-5.2-fast")) {
    return { input: 1.8, output: 6.0, cacheRead: 0.3, cacheWrite: 0 };
  }
  if (id === "glm-5.3-flash" || id.startsWith("glm-5.3-flash")) {
    return { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 };
  }
  if (id.startsWith("glm-5.3") || id.startsWith("glm-5.1")) {
    return { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 };
  }
  if (id.startsWith("glm-")) {
    return { input: 1.0, output: 3.2, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-k3")) {
    return { input: 1.5, output: 6.0, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-k2.7") || id.startsWith("kimi-k2.6")) {
    return { input: 0.95, output: 4.0, cacheRead: 0.19, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-k2.5") || id.startsWith("kimi-")) {
    return { input: 0.6, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
  }
  if (id.startsWith("minimax-m3")) {
    return { input: 0.12, output: 0.48, cacheRead: 0.012, cacheWrite: 0 };
  }
  if (id.startsWith("minimax-")) {
    return { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 };
  }
  if (id.startsWith("nemotron-")) {
    return { input: 0.4, output: 1.0, cacheRead: 0.04, cacheWrite: 0 };
  }
  if (id.startsWith("qwen")) {
    return { input: 0.8, output: 2.4, cacheRead: 0.08, cacheWrite: 0 };
  }
  if (id.startsWith("mistral-")) {
    return { input: 0.6, output: 3.0, cacheRead: 0.06, cacheWrite: 0 };
  }

  // Google Gemini & Garnet family
  if (id.startsWith("garnet-")) {
    return { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0 };
  }
  if (id.startsWith("gemini-4") || id.startsWith("gemini-3.1-pro") || id.startsWith("gemini-3-pro")) {
    return { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (
    id.startsWith("gemini-3.8-flash") ||
    id.startsWith("gemini-3.7-flash") ||
    id.startsWith("gemini-3.6-flash") ||
    id.startsWith("gemini-3.5-flash")
  ) {
    return { input: 0.3, output: 1.5, cacheRead: 0.075, cacheWrite: 0 };
  }
  if (id.startsWith("gemini-3-flash") || id.startsWith("gemini-")) {
    return { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 };
  }

  // Default fallback
  return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
}

type FactoryThinking = NonNullable<ProviderModelConfig["thinking"]>;

function droidEfforts(droid: DroidModel): Effort[] {
  return droid.efforts.filter((effort) => effort !== "off") as Effort[];
}

// The thinking mode is the request shape Droid builds at a reasoning effort:
// adaptive thinking, a token budget with an effort, or a bare token budget.
function droidThinkingShape(droid: DroidModel): Pick<FactoryThinking, "mode" | "supportsDisplay"> {
  if (droid.api === "google") return { mode: "google-level" };
  if (droid.api !== "anthropic") return { mode: "effort" };
  const [firstEffort] = droidEfforts(droid);
  const body = Object.values(droid.requests)[0]?.[firstEffort]?.body ?? {};
  const thinking = body.thinking as { type?: string; display?: string } | undefined;
  if (thinking?.type === "adaptive") {
    return thinking.display ? { mode: "anthropic-adaptive", supportsDisplay: true } : { mode: "anthropic-adaptive" };
  }
  return { mode: "output_config" in body ? "anthropic-budget-effort" : "budget" };
}

function droidThinking(droid: DroidModel): ProviderModelConfig["thinking"] {
  const efforts = droidEfforts(droid);
  if (efforts.length === 0) return undefined;
  return {
    ...droidThinkingShape(droid),
    efforts,
    ...(droid.defaultEffort === "off" ? {} : { defaultLevel: droid.defaultEffort as Effort }),
    ...(droid.efforts.includes("off") ? {} : { requiresEffort: true }),
  };
}

// Models found only in Factory's docs have no Droid row, so they get a plain
// low-to-high ladder until a Droid release ships them.
function discoveredThinking(modelId: string): FactoryThinking {
  const efforts = [Effort.Low, Effort.Medium, Effort.High];
  return familyOf(modelId) === "google"
    ? { mode: "google-level", efforts, defaultLevel: Effort.High }
    : { mode: "effort", efforts, defaultLevel: Effort.High };
}

export function factoryThinkingFor(
  modelId: string,
  reasoning: boolean,
  configuredThinking: ProviderModelConfig["thinking"] | undefined,
): ProviderModelConfig["thinking"] {
  if (configuredThinking) return configuredThinking;
  const droid = DROID_MODELS[modelId];
  if (droid) return droidThinking(droid);
  return reasoning ? discoveredThinking(modelId) : undefined;
}

export function factoryModel(config: FactoryModelInput): ProviderModelConfig {
  return {
    id: config.id,
    name: config.name,
    api: CUSTOM_API,
    reasoning: config.reasoning,
    thinking: factoryThinkingFor(config.id, config.reasoning, config.thinking),
    input: config.input,
    cost: config.cost ?? defaultCostFor(config.id),
    premiumMultiplier: config.premiumMultiplier,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
  };
}

// Droid 1.3.0: fn(e,o) keeps a promotion with a discount where startsAt <= o
// and o < expiresAt; Ce takes the first; mn = Number((m*(1-d)).toFixed(4)).
export function droidMultiplierFor(modelId: string, now: Date = new Date()): number | undefined {
  const droid = DROID_MODELS[modelId];
  if (!droid) return undefined;
  const at = now.getTime();
  const promotion = droid.promotions?.find(
    (entry) =>
      entry.discount > 0 &&
      at >= Date.parse(entry.startsAt) &&
      (entry.expiresAt === undefined || at < Date.parse(entry.expiresAt)),
  );
  const multiplier = promotion ? droid.tokenMultiplier * (1 - promotion.discount) : droid.tokenMultiplier;
  return Number(multiplier.toFixed(4));
}

function droidModel(config: CuratedModelInput): ProviderModelConfig {
  const droid = DROID_MODELS[config.id];
  if (!droid) throw new Error(`${config.id} has no Droid 1.3.0 registry row`);
  const thinking = droidThinking(droid);
  return factoryModel({
    ...config,
    reasoning: thinking !== undefined,
    thinking,
    // Droid sets supportsImages to config.images !== false.
    input: droid.images ? ["text", "image"] : ["text"],
    contextWindow: config.contextWindow ?? droid.maxInputTokens + droid.maxOutputTokens,
    maxTokens: droid.maxOutputTokens,
    premiumMultiplier: droidMultiplierFor(config.id),
  });
}

// `contextWindow` is Droid's maxInputTokens plus maxOutputTokens, the total
// context Droid lets a request use. `maxTokens` is Droid's maxOutputTokens.
export const FACTORY_MODELS: ProviderModelConfig[] = [
  // Claude and Anthropic-family models
  droidModel({
    id: "claude-fable-5.2",
    name: "Claude Fable 5.2 (Factory)",
  }),
  droidModel({
    id: "claude-fable-5.1",
    name: "Claude Fable 5.1 (Factory)",
  }),
  droidModel({
    id: "claude-fable-5",
    name: "Claude Fable 5 (Factory)",
  }),
  droidModel({
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5 (Factory)",
  }),
  droidModel({
    id: "claude-opus-5-5-fast",
    name: "Claude Opus 5.5 Fast (Factory)",
  }),
  droidModel({
    id: "claude-opus-5",
    name: "Claude Opus 5 (Factory)",
  }),
  droidModel({
    id: "claude-opus-5-fast",
    name: "Claude Opus 5 Fast (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8 (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-8-fast",
    name: "Claude Opus 4.8 Fast (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7 (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-7-fast",
    name: "Claude Opus 4.7 Fast [Deprecated] (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-6-fast",
    name: "Claude Opus 4.6 Fast [Deprecated] (Factory)",
  }),
  droidModel({
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5 (Factory)",
    contextWindow: 200000,
  }),
  droidModel({
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5 (Factory)",
  }),
  droidModel({
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5 (Factory)",
  }),
  droidModel({
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Factory)",
  }),
  droidModel({
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5 (Factory)",
    contextWindow: 200_000,
  }),
  droidModel({
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5 (Factory)",
  }),
  droidModel({
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5 (Factory)",
    contextWindow: 200000,
  }),
  droidModel({
    id: "atlas-07-21",
    name: "Atlas 07/21 Preview (Factory)",
  }),
  droidModel({
    id: "aster-07-15",
    name: "Aster 07/15 Preview (Factory)",
  }),
  // GPT and Codex models
  droidModel({
    id: "gpt-6-astra",
    name: "GPT-6 Astra (Factory)",
  }),
  droidModel({
    id: "gpt-6-sol",
    name: "GPT-6 Sol (Factory)",
  }),
  droidModel({
    id: "gpt-6-sol-fast",
    name: "GPT-6 Sol Fast (Factory)",
  }),
  droidModel({
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol (Factory)",
  }),
  droidModel({
    id: "gpt-6.1-sol-ultrafast",
    name: "GPT-6.1 Sol Ultrafast (Factory)",
  }),
  droidModel({
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra (Factory)",
  }),
  droidModel({
    id: "gpt-6-luna",
    name: "GPT-6 Luna (Factory)",
  }),
  droidModel({
    id: "gpt-6-luna-fast",
    name: "GPT-6 Luna Fast (Factory)",
  }),
  droidModel({
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Factory)",
  }),
  droidModel({
    id: "gpt-5.6-sol-fast",
    name: "GPT-5.6 Sol Fast (Factory)",
  }),
  droidModel({
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra (Factory)",
  }),
  droidModel({
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna (Factory)",
  }),
  droidModel({
    id: "gpt-5.5",
    name: "GPT-5.5 (Factory)",
  }),
  droidModel({
    id: "gpt-5.5-fast",
    name: "GPT-5.5 Fast (Factory)",
  }),
  droidModel({
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro (Factory)",
  }),
  droidModel({
    id: "gpt-5.4",
    name: "GPT-5.4 (Factory)",
  }),
  droidModel({
    id: "gpt-5.4-fast",
    name: "GPT-5.4 Fast (Factory)",
  }),
  droidModel({
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (Factory)",
  }),
  droidModel({
    id: "gpt-5.4-mini-fast",
    name: "GPT-5.4 Mini Fast (Factory)",
  }),
  droidModel({
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (Factory)",
  }),
  droidModel({
    id: "gpt-5.3-codex-fast",
    name: "GPT-5.3 Codex Fast (Factory)",
  }),
  droidModel({
    id: "gpt-5.2",
    name: "GPT-5.2 (Factory)",
  }),
  droidModel({
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex [Deprecated] (Factory)",
  }),
  droidModel({
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max [Deprecated] (Factory)",
  }),

  // Grok family (routed through OpenAI Responses gateway with x-api-provider: xai)
  droidModel({
    id: "grok-4.7",
    name: "Grok 4.7 (Factory)",
  }),
  droidModel({
    id: "grok-4.6",
    name: "Grok 4.6 (Factory)",
  }),
  droidModel({
    id: "grok-4.5",
    name: "Grok 4.5 (Factory)",
  }),

  // Factory Core and open-weight chat models
  droidModel({
    id: "inkling",
    name: "Inkling (Factory Core)",
  }),
  droidModel({
    id: "mistral-large-4",
    name: "Mistral Large 4 (Factory Core)",
  }),
  droidModel({
    id: "mistral-medium-3.5",
    name: "Mistral Medium 3.5 (Factory Core)",
  }),
  droidModel({
    id: "glm-5.3",
    name: "GLM 5.3 (Factory Core)",
  }),
  droidModel({
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash (Factory Core)",
  }),
  droidModel({
    id: "glm-5.2",
    name: "GLM 5.2 (Factory Core)",
  }),
  droidModel({
    id: "glm-5.2-fast",
    name: "GLM 5.2 Fast (Factory Core)",
  }),
  droidModel({
    id: "glm-5.1",
    name: "GLM 5.1 [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "glm-5",
    name: "GLM 5 [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "glm-4.7",
    name: "GLM 4.7 [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "glm-4.6",
    name: "GLM 4.6 (Factory Core)",
  }),
  droidModel({
    id: "kimi-k3.1-pro",
    name: "Kimi K3.1 Pro (Factory Core)",
  }),
  droidModel({
    id: "kimi-k3",
    name: "Kimi K3 (Factory Core)",
  }),
  droidModel({
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code (Factory Core)",
  }),
  droidModel({
    id: "kimi-k2.6",
    name: "Kimi K2.6 (Factory Core)",
  }),
  droidModel({
    id: "kimi-k2.5",
    name: "Kimi K2.5 [Deprecated] (Factory Core)",
  }),
  // Promoted to the static catalog 2026-09: docs.factory.ai/models now publishes
  // `deepseek-v4.1-flash` and Droid 0.228.1 ships binary-audited limits for it.
  droidModel({
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash (Factory Core)",
  }),
  droidModel({
    id: "deepseek-v4.1-flash-1017",
    name: "DeepSeek V4.1 Flash 1017 (Factory Core)",
  }),
  droidModel({
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "minimax-m3",
    name: "MiniMax M3 (Factory Core)",
  }),
  droidModel({
    id: "minimax-m3.1-flash",
    name: "MiniMax M3.1 Flash (Factory Core)",
  }),
  droidModel({
    id: "minimax-m2.7",
    name: "MiniMax M2.7 [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "minimax-m2.5",
    name: "MiniMax M2.5 [Deprecated] (Factory Core)",
  }),
  droidModel({
    id: "nemotron-3-ultra",
    name: "Nemotron 3 Ultra (Factory Core)",
  }),
  droidModel({
    id: "nemotron-3.5-super",
    name: "Nemotron 3.5 Super (Factory Core)",
  }),
  droidModel({
    id: "qwen3.8-max",
    name: "Qwen3.8 Max (Factory Core)",
  }),
  droidModel({
    id: "muse-spark-1.2",
    name: "Muse Spark 1.2 (Factory)",
  }),
  droidModel({
    id: "muse-spark-1.3",
    name: "Muse Spark 1.3 (Factory)",
  }),
  droidModel({
    id: "muse-spark-open",
    name: "Muse Spark Open (Factory)",
  }),
  droidModel({
    id: "beam-1.0",
    name: "Beam 1.0 (Factory Core)",
  }),

  // Google Gemini family
  droidModel({
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen (Factory)",
  }),
  droidModel({
    id: "gemini-4-carbon",
    name: "Gemini 4 Carbon (Factory)",
  }),
  droidModel({
    id: "gemini-4-argon",
    name: "Gemini 4 Argon (Factory)",
  }),
  droidModel({
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (Factory)",
  }),
  droidModel({
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash (Factory)",
  }),
  droidModel({
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash (Factory)",
  }),
  droidModel({
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash (Factory)",
  }),
  droidModel({
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview (Factory)",
  }),
  droidModel({
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview (Factory)",
  }),
  droidModel({
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview (Factory)",
  }),
  droidModel({
    id: "garnet-07-15",
    name: "Garnet 07/15 Preview (Factory)",
  }),
];

export function familyOf(id: string): FactoryModelFamily {
  // MiniMax M2.x uses Messages; audited M3 variants use chat completions.
  if (id === "minimax-m3" || id.startsWith("minimax-m3-") || id === "minimax-m3.1-flash") {
    return "openai-completions";
  }

  if (id.startsWith("claude-") || id.startsWith("minimax-") || id.startsWith("atlas-") || id.startsWith("aster-")) {
    return "anthropic";
  }

  if (id.startsWith("gemini-") || id.startsWith("garnet-")) {
    return "google";
  }

  if (id.startsWith("gpt-") || id.startsWith("gpt6") || id.endsWith("-codex") || id.startsWith("grok-")) {
    return "openai-responses";
  }

  if (id === "muse-spark-1.3") {
    return "openai-responses";
  }

  if (
    id.startsWith("glm-") ||
    id.startsWith("kimi-") ||
    id.startsWith("deepseek-") ||
    id.startsWith("nemotron-") ||
    id.startsWith("qwen") ||
    id.startsWith("mistral-") ||
    id === "inkling" ||
    id.startsWith("inkling-") ||
    id.startsWith("muse-spark-") ||
    id === "beam-1.0"
  ) {
    return "openai-completions";
  }

  return "unsupported";
}

export type FactoryUpstreamProvider =
  | "anthropic"
  | "vertex_anthropic"
  | "openai"
  | "fireworks"
  | "baseten"
  | "xai"
  | "google"
  | "mistral";

// Factory's `x-api-provider` request header names the upstream the gateway
// sends a request to. Droid 1.3.0 picks the first of a model's apiProviders
// that its region rules allow in the inference region, and src/droid-registry.ts
// holds that pick per region. A Droid model with no provider in the region is
// not offered there, so this returns undefined. Models found only in
// Factory's docs fall back to their id prefix.
export function upstreamProviderFor(id: string, region: DroidRegion = "global"): FactoryUpstreamProvider | undefined {
  const droid = DROID_MODELS[id];
  if (droid) return droid.providers[region] as FactoryUpstreamProvider | undefined;

  if (id.startsWith("claude-") || id.startsWith("atlas-") || id.startsWith("aster-")) {
    return "anthropic";
  }

  if (id.startsWith("gemini-") || id.startsWith("garnet-")) {
    return "google";
  }

  if (id.startsWith("gpt-") || id.startsWith("gpt6") || id.endsWith("-codex")) {
    return "openai";
  }

  if (id.startsWith("grok-")) {
    return "xai";
  }

  if (id.startsWith("mistral-")) {
    return "mistral";
  }

  return "fireworks";
}

export function identityFor(id: string): ModelIdentity {
  if (id.startsWith("claude-")) {
    const parts = id.split("-");
    return { class: "anthropic", family: parts[1] ?? "claude" };
  }
  if (id.startsWith("atlas-") || id.startsWith("aster-")) {
    const parts = id.split("-");
    return { class: "anthropic", family: parts[0] };
  }
  if (id.startsWith("gemini-") || id.startsWith("garnet-")) {
    const parts = id.split("-");
    return { class: "google", family: parts[0] ?? "gemini" };
  }
  if (id.startsWith("mistral-")) {
    return { class: "mistral", family: "mistral" };
  }
  if (id.startsWith("minimax-")) {
    return { class: "minimax", family: "minimax" };
  }
  if (id.startsWith("gpt-") || id.startsWith("gpt6") || id.endsWith("-codex")) {
    return { class: "openai", family: "gpt" };
  }
  if (id.startsWith("grok-")) {
    return { class: "xai", family: "grok" };
  }
  if (id.startsWith("glm-")) {
    return { class: "glm", family: "glm" };
  }
  if (id.startsWith("kimi-")) {
    return { class: "kimi", family: "kimi" };
  }
  if (id.startsWith("deepseek-")) {
    return { class: "deepseek", family: "deepseek" };
  }
  if (id.startsWith("nemotron-")) {
    return { class: "nemotron", family: "nemotron" };
  }
  if (id.startsWith("qwen")) {
    return { class: "qwen", family: "qwen" };
  }
  if (id.startsWith("inkling")) {
    return { class: "inkling", family: "inkling" };
  }
  if (id.startsWith("muse-spark-")) {
    return { class: "muse", family: "muse" };
  }
  if (id === "beam-1.0") {
    return { class: "beam", family: "beam" };
  }
  return { class: "unknown" };
}

export type FactoryQuotaTier = "standard" | "core";

// A model Droid 1.10.0 ships uses the pool Droid bills it from. Muse Spark is
// in the Standard pool although it runs on open-model hosts. The prefix rule
// below covers models Droid no longer lists and ones found in the docs.
export function factoryQuotaTierFor(id: string): FactoryQuotaTier {
  const pool = DROID_MODELS[id]?.billingPool;
  if (pool) return pool;
  if (
    id.startsWith("claude-") ||
    id.startsWith("atlas-") ||
    id.startsWith("aster-") ||
    id.startsWith("gpt-") ||
    id.startsWith("gpt6") ||
    id.endsWith("-codex") ||
    id.startsWith("grok-") ||
    id.startsWith("gemini-") ||
    id.startsWith("garnet-")
  ) {
    return "standard";
  }
  return "core";
}

