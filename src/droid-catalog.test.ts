import { describe, expect, test } from "bun:test";

import { droidMultiplierFor, FACTORY_MODELS, factoryQuotaTierFor, upstreamProviderFor } from "./catalog";
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

describe("catalog multipliers follow Droid 1.3.0", () => {
  test("every curated model carries Droid's multiplier for today", () => {
    for (const model of FACTORY_MODELS) {
      expect({ id: model.id, premiumMultiplier: model.premiumMultiplier }).toEqual({
        id: model.id,
        premiumMultiplier: droidMultiplierFor(model.id),
      });
    }
  });

  test("base multipliers match the binary's cost.tokenMultiplier", () => {
    const outsidePromotions = new Date("2027-06-01T00:00:00Z");
    expect(droidMultiplierFor("claude-opus-4-7-fast", outsidePromotions)).toBe(12);
    expect(droidMultiplierFor("glm-5", outsidePromotions)).toBe(0.4);
    expect(droidMultiplierFor("glm-4.7", outsidePromotions)).toBe(0.25);
    expect(droidMultiplierFor("minimax-m2.5", outsidePromotions)).toBe(0.12);
  });

  // fn(e,o): discount set, o >= startsAt, and o < expiresAt. mn: Number((m*(1-d)).toFixed(4)).
  test("gemini-4-argon is half price only inside its promotion window", () => {
    expect(droidMultiplierFor("gemini-4-argon", new Date("2026-10-13T15:59:59Z"))).toBe(1.6);
    expect(droidMultiplierFor("gemini-4-argon", new Date("2026-10-13T16:00:00Z"))).toBe(0.8);
    expect(droidMultiplierFor("gemini-4-argon", new Date("2026-11-05T00:00:00Z"))).toBe(0.8);
    expect(droidMultiplierFor("gemini-4-argon", new Date("2026-12-01T08:00:00Z"))).toBe(1.6);
  });

  test("the first active promotion wins and expired ones are ignored", () => {
    // gpt-5.6-sol: 60% from 08-29 to 09-05, 20% from 08-22 to 11-22, base 2.
    expect(droidMultiplierFor("gpt-5.6-sol", new Date("2026-09-01T00:00:00Z"))).toBe(0.8);
    expect(droidMultiplierFor("gpt-5.6-sol", new Date("2026-11-05T00:00:00Z"))).toBe(1.6);
    expect(droidMultiplierFor("gpt-5.6-sol", new Date("2026-11-22T00:00:00Z"))).toBe(2);
    expect(droidMultiplierFor("gemini-3.8-flash", new Date("2026-11-05T00:00:00Z"))).toBe(0.3);
    expect(droidMultiplierFor("mistral-large-4", new Date("2026-11-05T00:00:00Z"))).toBe(0.544);
  });

  test("ids with no Droid row have no Droid multiplier", () => {
    expect(droidMultiplierFor("not-a-droid-model")).toBeUndefined();
  });
});

describe("upstream providers follow Droid 1.3.0", () => {
  // Droid picks the first apiProviders entry that Ne allows in the region.
  test("every curated model goes to Droid's first global provider", () => {
    for (const model of FACTORY_MODELS) {
      expect({ id: model.id, provider: upstreamProviderFor(model.id) as string | undefined }).toEqual({
        id: model.id,
        provider: DROID_MODELS[model.id].providers.global,
      });
    }
  });

  test("nemotron-3-ultra goes to Baseten", () => {
    // apiProviders:["baseten"], apiProviderConfig:{baseten:{modelId:"nvidia/Nemotron-120B-A12B"}}
    expect(upstreamProviderFor("nemotron-3-ultra")).toBe("baseten");
  });
});

// Droid 1.10.0 bills each model from one pool: "standard" or "core". Muse Spark
// models are in the Standard pool even though they run on open-model hosts.
const NOT_IN_DROID_1_10 = ["gemini-3-pro-preview", "glm-4.6", "kimi-k2.6", "kimi-k2.7-code", "minimax-m2.5"];

describe("quota tiers follow Droid 1.10.0 billing pools", () => {
  test("every Droid 1.10.0 row carries its billing pool", () => {
    const missing = Object.entries(DROID_MODELS).filter(([, droid]) => !droid.billingPool).map(([id]) => id);
    expect(missing.sort()).toEqual([...NOT_IN_DROID_1_10].sort());
  });

  test("the quota tier is the model's Droid billing pool", () => {
    for (const [id, droid] of Object.entries(DROID_MODELS)) {
      if (!droid.billingPool) continue;
      expect({ id, tier: factoryQuotaTierFor(id) }).toEqual({ id, tier: droid.billingPool });
    }
    for (const id of ["muse-spark-1.2", "muse-spark-1.3", "muse-spark-open"]) {
      expect({ id, tier: factoryQuotaTierFor(id) }).toEqual({ id, tier: "standard" });
    }
  });

  test("a model is labelled Factory Core exactly when it uses the Core pool", () => {
    for (const model of FACTORY_MODELS) {
      expect({ id: model.id, core: model.name.endsWith("(Factory Core)") }).toEqual({
        id: model.id,
        core: factoryQuotaTierFor(model.id) === "core",
      });
    }
  });
});

// Droid 1.10.0 ships a rate card per provider. Its numbers are per million
// tokens in Droid's credit unit (rates.input equals cost.tokenMultiplier), which
// is 2.5 USD: Sonnet 4.6's 1.2/6 is Anthropic's $3/$15.
describe("costs follow Droid 1.10.0 pricing", () => {
  const costOf = (id: string) => curated(id).cost;

  test("priced models use the routed provider's rates in USD per million tokens", () => {
    expect(costOf("claude-fable-5.2")).toEqual({ input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 });
    expect(costOf("claude-fable-5.1")).toEqual({ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 });
    expect(costOf("claude-opus-5-5")).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(costOf("claude-sonnet-4-6")).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    expect(costOf("gpt-5.3-codex")).toEqual({ input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 });
    expect(costOf("gemini-4-hydrogen")).toEqual({ input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0 });
    expect(costOf("gemini-4-carbon")).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 });
    expect(costOf("gemini-3.1-pro-preview")).toEqual({ input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 });
    expect(costOf("kimi-k3")).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 });
    // muse-spark-open goes to baseten in the global region.
    expect(costOf("muse-spark-open")).toEqual({ input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 });
  });

  test("every row with Droid pricing gets it, and rows without keep the estimate", () => {
    const priced = Object.entries(DROID_MODELS).filter(([, droid]) => droid.pricing);
    expect(priced.length).toBe(33);
    for (const [id, droid] of priced) {
      const usd = (rate: number) => Number((rate * 2.5).toFixed(6));
      const pricing = droid.pricing!;
      expect({ id, provider: pricing.provider }).toEqual({ id, provider: droid.providers.global! });
      expect({ id, input: costOf(id)?.input, output: costOf(id)?.output }).toEqual({ id, input: usd(pricing.input), output: usd(pricing.output) });
      if (pricing.cacheRead !== undefined) expect({ id, cacheRead: costOf(id)?.cacheRead }).toEqual({ id, cacheRead: usd(pricing.cacheRead) });
      if (pricing.cacheWrite !== undefined) expect({ id, cacheWrite: costOf(id)?.cacheWrite }).toEqual({ id, cacheWrite: usd(pricing.cacheWrite) });
    }
    // Droid has no rates for these, or rates copied from another model.
    expect(costOf("gpt-5.5")).toEqual({ input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 });
    expect(costOf("mistral-large-4")).toEqual({ input: 0.6, output: 3, cacheRead: 0.06, cacheWrite: 0 });
    expect(costOf("deepseek-v4-pro")).toEqual({ input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 });
    expect(costOf("muse-spark-1.2")).toEqual({ input: 1, output: 3, cacheRead: 0.1, cacheWrite: 0 });
  });
});
