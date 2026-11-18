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
    // gpt-5.3-codex and kimi-k3 carry no images:false in 1.14.0.
    expect(curated("gpt-5.3-codex").input).toEqual(["text", "image"]);
    expect(curated("kimi-k3").input).toEqual(["text", "image"]);
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
    expect(droidMultiplierFor("deepseek-v4.1-flash", outsidePromotions)).toBe(0.12);
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

// Droid 1.14.0 marks these availableInCLI:false, so its CLI stops offering
// them. The static catalog drops them, and model-refresh must not re-add them.
const HIDDEN_IN_DROID_1_14 = [
  "gemini-3-pro-preview",
  "glm-4.6",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "minimax-m2.5",
];

describe("catalog membership follows Droid 1.14.0", () => {
  test("advertises exactly the CLI-visible models Droid 1.14.0 ships", () => {
    expect([...FACTORY_MODELS.map((model) => model.id)].sort()).toEqual(Object.keys(DROID_MODELS).sort());
  });

  test("drops the models Droid 1.14.0 hides from its CLI", () => {
    const advertised = new Set(FACTORY_MODELS.map((model) => model.id));
    expect(HIDDEN_IN_DROID_1_14.filter((id) => advertised.has(id))).toEqual([]);
    expect(HIDDEN_IN_DROID_1_14.filter((id) => DROID_MODELS[id])).toEqual([]);
  });
});

// Droid 1.14.0 ships these feature-flagged. The plugin publishes the metadata
// Droid carries; whether an account may use one stays an upstream decision.
const GPT_6_2_MODELS = [
  {
    id: "gpt-6.2-astra",
    multiplier: 3.2,
    cost: { input: 3.2, output: 16, cacheRead: 0.16, cacheWrite: 4 },
    eu: undefined,
  },
  {
    id: "gpt-6.2-astra-fast",
    multiplier: 6.4,
    cost: { input: 6.4, output: 32, cacheRead: 0.32, cacheWrite: 8 },
    eu: undefined,
  },
  {
    id: "gpt-6.2-astra-ultrafast",
    multiplier: 9.6,
    cost: { input: 9.6, output: 48, cacheRead: 0.48, cacheWrite: 12 },
    eu: undefined,
  },
  {
    id: "gpt-6.2-sol",
    multiplier: 0.8,
    cost: { input: 0.8, output: 4, cacheRead: 0.04, cacheWrite: 1 },
    eu: "openai",
  },
  {
    id: "gpt-6.2-sol-fast",
    multiplier: 1.6,
    cost: { input: 1.6, output: 8, cacheRead: 0.08, cacheWrite: 2 },
    eu: "openai",
  },
  {
    id: "gpt-6.2-sol-ultrafast",
    multiplier: 2.4,
    cost: { input: 2.4, output: 12, cacheRead: 0.12, cacheWrite: 3 },
    eu: "openai",
  },
] as const;

describe("catalog additions from Droid 1.14.0", () => {
  test("lists the GPT-6.2 family with Droid 1.14.0's ladder, limits, images, multiplier and cost", () => {
    for (const expected of GPT_6_2_MODELS) {
      const model = curated(expected.id);
      expect({
        id: expected.id,
        reasoning: model.reasoning,
        mode: model.thinking?.mode,
        efforts: effortsOf(expected.id),
        defaultLevel: defaultOf(expected.id),
        requiresEffort: model.thinking?.requiresEffort,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        premiumMultiplier: model.premiumMultiplier,
        cost: model.cost,
      }).toEqual({
        id: expected.id,
        reasoning: true,
        mode: "effort",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
        requiresEffort: true,
        input: ["text", "image"],
        contextWindow: 1_050_000,
        maxTokens: 128_000,
        premiumMultiplier: expected.multiplier,
        cost: expected.cost,
      });
    }
  });

  test("sends the GPT-6.2 family to the openai upstream Droid 1.14.0 picks in each region", () => {
    // Droid 1.14.0 adds an "in" inference region; these rows carry no override
    // for it, so India is not an offered region for the family.
    for (const expected of GPT_6_2_MODELS) {
      expect({
        id: expected.id,
        global: upstreamProviderFor(expected.id, "global"),
        eu: upstreamProviderFor(expected.id, "eu"),
        us: upstreamProviderFor(expected.id, "us"),
        in: upstreamProviderFor(expected.id, "in"),
      }).toEqual({ id: expected.id, global: "openai", eu: expected.eu, us: "openai", in: undefined });
    }
  });

  test("keeps the GPT-6 Astra ultrafast estimate, which upstream carries no rates for", () => {
    const model = curated("gpt-6-astra-ultrafast");
    expect(model.premiumMultiplier).toBe(24);
    // Droid's row has only apiProviderConfig.openai.modelId and no pricing block.
    expect(model.cost).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 0 });
    expect(model.reasoning).toBe(true);
    expect(effortsOf("gpt-6-astra-ultrafast")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(defaultOf("gpt-6-astra-ultrafast")).toBe("medium");
    expect(model.input).toEqual(["text", "image"]);
    expect(upstreamProviderFor("gpt-6-astra-ultrafast", "global")).toBe("openai");
    expect(upstreamProviderFor("gpt-6-astra-ultrafast", "eu")).toBeUndefined();
    expect(upstreamProviderFor("gpt-6-astra-ultrafast", "us")).toBe("openai");
    expect(upstreamProviderFor("gpt-6-astra-ultrafast", "in")).toBeUndefined();
  });
});

// Droid 1.14.0 bills each model from one pool: "standard" or "core". Muse Spark
// models are in the Standard pool even though they run on open-model hosts.
// Droid's row set is exactly the CLI-visible models; it no longer carries a
// hidden row without a pool.
describe("quota tiers follow Droid 1.14.0 billing pools", () => {
  test("every Droid 1.14.0 row carries its billing pool", () => {
    const missing = Object.entries(DROID_MODELS)
      .filter(([, droid]) => !droid.billingPool)
      .map(([id]) => id);
    expect(missing).toEqual([]);
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
