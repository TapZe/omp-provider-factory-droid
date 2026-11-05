import { describe, expect, test } from "bun:test";

import { FACTORY_MODELS } from "./catalog";
import { DROID_MODELS } from "./droid-registry";

function curated(id: string) {
  const model = FACTORY_MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error(`missing curated model ${id}`);
  return model;
}

const effortsOf = (id: string) => curated(id).thinking?.efforts as readonly string[] | undefined;
const defaultOf = (id: string) => curated(id).thinking?.defaultLevel as string | undefined;

describe("catalog reasoning follows Droid 1.3.0", () => {
  test("every curated model has a Droid 1.3.0 registry row", () => {
    expect(FACTORY_MODELS.map((model) => model.id).filter((id) => !DROID_MODELS[id])).toEqual([]);
  });

  test("efforts, default, and off handling come from each model's Droid row", () => {
    for (const model of FACTORY_MODELS) {
      const droid = DROID_MODELS[model.id];
      const efforts = droid.efforts.filter((effort) => effort !== "off");
      expect({ id: model.id, reasoning: model.reasoning }).toEqual({ id: model.id, reasoning: efforts.length > 0 });
      if (efforts.length === 0) {
        expect(model.thinking).toBeUndefined();
        continue;
      }
      expect({ id: model.id, efforts: model.thinking?.efforts as readonly string[] | undefined }).toEqual({ id: model.id, efforts });
      expect({ id: model.id, defaultLevel: model.thinking?.defaultLevel as string | undefined }).toEqual({
        id: model.id,
        defaultLevel: droid.defaultEffort === "off" ? undefined : (droid.defaultEffort as string),
      });
      expect({ id: model.id, requiresEffort: model.thinking?.requiresEffort ?? false }).toEqual({
        id: model.id,
        requiresEffort: !droid.efforts.includes("off"),
      });
    }
  });

  test("spot checks against the binary's reasoningEffort blocks", () => {
    // claude-opus-4-8: reasoningEffort:{supported:["off","low","medium","high","xhigh","max"],default:"high"}
    expect(effortsOf("claude-opus-4-8")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // glm-5.2: supported:["off","high","max"], default:"high"
    expect(effortsOf("glm-5.2")).toEqual(["high", "max"]);
    expect(defaultOf("glm-5.2")).toBe("high");
    // gpt-5.5: supported:["low","medium","high","xhigh"], default:"medium"
    expect(defaultOf("gpt-5.5")).toBe("medium");
    expect(curated("gpt-5.5").thinking?.requiresEffort).toBe(true);
    // glm-5: supported:["none"], default:"none"
    expect(curated("glm-5").reasoning).toBe(false);
    // claude-sonnet-4-5: supported:["off","low","medium","high"], default:"off"
    expect(defaultOf("claude-sonnet-4-5-20250929")).toBeUndefined();
    expect(curated("claude-haiku-4-5-20251001").reasoning).toBe(true);
  });

  test("thinking mode follows the request shape Droid builds", () => {
    expect(curated("claude-opus-4-8").thinking?.mode).toBe("anthropic-adaptive");
    expect(curated("claude-opus-4-8").thinking?.supportsDisplay).toBe(true);
    expect(curated("claude-opus-4-6").thinking?.mode).toBe("anthropic-adaptive");
    expect(curated("claude-opus-4-6").thinking?.supportsDisplay).toBeUndefined();
    expect(curated("claude-opus-4-5-20251101").thinking?.mode).toBe("anthropic-budget-effort");
    expect(curated("minimax-m2.7").thinking?.mode).toBe("anthropic-budget-effort");
    expect(curated("claude-sonnet-4-5-20250929").thinking?.mode).toBe("budget");
    expect(curated("gemini-3.5-flash").thinking?.mode).toBe("google-level");
    expect(curated("gpt-5.5").thinking?.mode).toBe("effort");
  });
});

describe("catalog limits and images follow Droid 1.3.0", () => {
  // Anthropic's window for the 4.5 models is 200k, below Droid's 180k input
  // plus 64k output, so those keep the upstream window.
  const UPSTREAM_WINDOW: Record<string, number> = {
    "claude-opus-4-5-20251101": 200_000,
    "claude-sonnet-4-5-20250929": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
  };

  test("context is Droid's input limit plus output limit, output is Droid's output limit", () => {
    for (const model of FACTORY_MODELS) {
      const droid = DROID_MODELS[model.id];
      expect({ id: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens }).toEqual({
        id: model.id,
        contextWindow: UPSTREAM_WINDOW[model.id] ?? droid.maxInputTokens + droid.maxOutputTokens,
        maxTokens: droid.maxOutputTokens,
      });
    }
  });

  test("image input follows Droid's supportedImageFormats gate", () => {
    for (const model of FACTORY_MODELS) {
      const droid = DROID_MODELS[model.id];
      expect({ id: model.id, input: model.input }).toEqual({
        id: model.id,
        input: droid.images ? ["text", "image"] : ["text"],
      });
    }
    // gpt-5.3-codex and kimi-k2.6 carry no images:false in 1.3.0.
    expect(curated("gpt-5.3-codex").input).toEqual(["text", "image"]);
    expect(curated("kimi-k2.6").input).toEqual(["text", "image"]);
    expect(curated("glm-5.3").input).toEqual(["text"]);
  });
});
