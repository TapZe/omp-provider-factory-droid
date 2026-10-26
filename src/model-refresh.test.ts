import { afterEach, describe, expect, test } from "bun:test";
import { Effort } from "@oh-my-pi/pi-ai";

import { fetchFactoryDynamicModels, parseFactoryModelDocs } from "./model-refresh";
import { FACTORY_MODELS } from "./catalog";

// Replicates the live docs.factory.ai/models.md shape: section headings with
// styled spans, header/separator rows, footnote daggers, and a section
// (Google) the parser has never seen before.
const FIXTURE = `
# Models

## <span style="color:#000">Anthropic</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Claude Fable 5<sup>\\*†</sup> | \`claude-fable-5\` | 4× | Standard |
| Claude Opus 4.8 | \`claude-opus-4-8\` | 2× | Standard |

## <span style="color:#000">Google</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Gemini 3.5 Flash | \`gemini-3.5-flash\` | 0.5× | Standard |

## <span style="color:#000">Droid Core (Open Models)</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Kimi K2.6 | \`kimi-k2.6\` | 0.4× | Standard |
| Claude Opus 4.8 | \`claude-opus-4-8\` | 2× | Standard |

## <span style="color:#000">Unsupported</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Other Model | \`cohere-command-r\` | 1× | Standard |
`;

const EXPECTED_LIMIT_GROUPS = [
  // Droid Ue: input 872_000 + output 128_000.
  [1_000_000, 128_000, ["claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5-5-fast", "claude-haiku-5-5"]],
  // Droid rBT: input 867_000 + output 128_000.
  [
    995_000,
    128_000,
    [
      "claude-fable-5.1",
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-5-fast",
      "claude-opus-4-8",
      "claude-opus-4-8-fast",
      "claude-opus-4-7",
      "claude-opus-4-7-fast",
      "claude-opus-4-6",
      "claude-opus-4-6-fast",
      "atlas-07-21",
      "aster-07-15",
    ],
  ],
  [200_000, 64_000, ["claude-opus-4-5-20251101"]],
  // Droid Bpu: input 931_000 + output 64_000.
  [995_000, 64_000, ["claude-sonnet-4-6"]],
  [200_000, 32_000, ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"]],
  [
    1_050_000,
    128_000,
    [
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6.1-sol",
      "gpt-6-luna",
      "gpt-6-luna-fast",
      "gpt-6-sol-fast",
      "gpt-6.1-sol-ultrafast",
      "gpt-5.6-sol",
      "gpt-5.6-sol-fast",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.5-fast",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-fast",
    ],
  ],
  [
    400_000,
    128_000,
    ["gpt-5.4-mini", "gpt-5.4-mini-fast", "gpt-5.3-codex", "gpt-5.3-codex-fast", "gpt-5.2", "gpt-5.2-codex"],
  ],
  [400_000, 32_768, ["gpt-5.1-codex-max"]],
  // Droid eo(): input + output is the total window.
  [500_000, 63_356, ["grok-4.7"]],
  [263_356, 63_356, ["grok-4.6", "grok-4.5"]],
  [1_040_000, 32_768, ["inkling"]],
  [1_040_000, 131_072, ["glm-5.3", "glm-5.2"]],
  [1_048_576, 131_072, ["glm-5.3-flash"]],
  [524_288, 131_072, ["glm-5.2-fast"]],
  [200_000, 65_536, ["glm-5.1"]],
  [222_000, 32_000, ["glm-5"]],
  [223_344, 25_344, ["glm-4.7"]],
  [328_000, 128_000, ["glm-4.6"]],
  [262_144, 65_536, ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"]],
  [288_768, 32_768, ["kimi-k2.5"]],
  [262_144, 131_072, ["qwen3.8-max"]],
  [1_040_000, 131_072, ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017", "deepseek-v4-flash-0731", "deepseek-v4-pro", "muse-spark-1.2"]],
  [512_000, 64_000, ["minimax-m3"]],
  [1_000_000, 131_072, ["minimax-m3.1-flash"]],
  // Droid binary limits for beam-1.0: 1_048_576 total window / 32_768 output.
  [1_048_576, 32_768, ["beam-1.0"]],
  [260_600, 64_000, ["minimax-m2.7"]],
  [268_800, 64_000, ["minimax-m2.5"]],
  [202_000, 65_536, ["nemotron-3-ultra"]],
  [256_000, 64_000, ["mistral-medium-3.5"]],
  [588_288, 64_000, ["mistral-large-4"]],
  // Droid rnT(1e6, 65536): input 1_000_000 + output 65_536.
  [
    1_065_536,
    65_536,
    [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3-pro-preview",
      "garnet-07-15",
    ],
  ],
] as const;

describe("Factory model token limits", () => {
  test("covers every curated model exactly once", () => {
    const expectedIds: string[] = EXPECTED_LIMIT_GROUPS.flatMap(([, , ids]) => [...ids]);
    expect(new Set(expectedIds).size).toBe(expectedIds.length);
    expect([...expectedIds].sort()).toEqual(FACTORY_MODELS.map((model) => model.id).sort());
  });

  test("uses audited total-context and synchronous-output limits", () => {
    const modelsById = new Map(FACTORY_MODELS.map((model) => [model.id, model]));

    for (const [contextWindow, maxTokens, ids] of EXPECTED_LIMIT_GROUPS) {
      for (const id of ids) {
        expect(modelsById.get(id)?.contextWindow, `${id} contextWindow`).toBe(contextWindow);
        expect(modelsById.get(id)?.maxTokens, `${id} maxTokens`).toBe(maxTokens);
      }
    }
  });
});

describe("static catalog gating", () => {
  test("curates deepseek-v4.1-flash now that Factory docs publish it", () => {
    // docs.factory.ai/models lists deepseek-v4.1-flash and Droid 0.228.1 ships
    // binary-audited limits for it, so the ID is now curated statically.
    const v41 = FACTORY_MODELS.find((model) => model.id === "deepseek-v4.1-flash");
    expect(v41).toBeDefined();
    // Binary-audited V4.1 limits: 1_040_000 total window / 131_072 output, image input.
    expect(v41?.contextWindow).toBe(1_040_000);
    expect(v41?.maxTokens).toBe(131_072);
    expect(v41?.input).toEqual(["text", "image"]);
    // Deprecated DeepSeek siblings stay curated and text-only.
    expect(FACTORY_MODELS.some((model) => model.id === "deepseek-v4-flash-0731")).toBe(true);
    expect(FACTORY_MODELS.some((model) => model.id === "deepseek-v4-pro")).toBe(true);
    expect(FACTORY_MODELS.find((model) => model.id === "deepseek-v4-flash-0731")?.input).toEqual(["text"]);
    expect(FACTORY_MODELS.find((model) => model.id === "deepseek-v4-pro")?.input).toEqual(["text"]);
  });
  test("curates gpt-6.1-sol with sol-family cost and Droid binary thinking ladder", () => {
    const sol61 = FACTORY_MODELS.find((model) => model.id === "gpt-6.1-sol");
    expect(sol61).toBeDefined();
    expect(sol61?.input).toEqual(["text", "image"]);
    // No live $/M pricing yet: cost must come from the gpt-6-sol family
    // branch, never the generic defaultCostFor fallback.
    expect(sol61?.cost).toEqual({ input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 });
    expect(sol61?.premiumMultiplier).toBe(0.8);
    // Droid 0.230.0 registry: default medium, ladder low→max, minimal
    // degraded to low on the wire.
    expect(sol61?.thinking?.mode).toBe("effort");
    expect(sol61?.thinking?.efforts.map(String)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(sol61?.thinking?.defaultLevel).toBe(Effort.Medium);
    expect(sol61?.thinking?.effortMap?.minimal).toBe("low");
  });

  test("curates claude-haiku-5-5 and mistral-large-4 from Droid 0.240.0", () => {
    const haiku55 = FACTORY_MODELS.find((model) => model.id === "claude-haiku-5-5");
    expect(haiku55).toBeDefined();
    expect(haiku55?.input).toEqual(["text", "image"]);
    expect(haiku55?.contextWindow).toBe(1_000_000);
    expect(haiku55?.maxTokens).toBe(128_000);
    expect(haiku55?.premiumMultiplier).toBe(0.04);
    expect(haiku55?.reasoning).toBe(true);

    const large4 = FACTORY_MODELS.find((model) => model.id === "mistral-large-4");
    expect(large4).toBeDefined();
    expect(large4?.input).toEqual(["text", "image"]);
    expect(large4?.contextWindow).toBe(588_288);
    expect(large4?.maxTokens).toBe(64_000);
    expect(large4?.premiumMultiplier).toBe(0.544);

    const m3 = FACTORY_MODELS.find((model) => model.id === "minimax-m3");
    expect(m3?.input).toEqual(["text", "image"]);
    expect(FACTORY_MODELS.find((model) => model.id === "kimi-k3")?.input).toEqual(["text", "image"]);
    expect(FACTORY_MODELS.find((model) => model.id === "glm-5.3-flash")?.input).toEqual(["text", "image"]);
    expect(FACTORY_MODELS.find((model) => model.id === "inkling")?.input).toEqual(["text", "image"]);
    expect(FACTORY_MODELS.find((model) => model.id === "mistral-medium-3.5")?.input).toEqual(["text", "image"]);
  });

  test("curates the seven Factory 0.249.0 models with binary inputs, multipliers, cost branches and disable states", () => {
    const byId = (id: string) => FACTORY_MODELS.find((model) => model.id === id);

    // GPT variants: cost comes from the existing sol/luna estimate branches.
    const ultrafast = byId("gpt-6.1-sol-ultrafast");
    expect(ultrafast?.input).toEqual(["text", "image"]);
    expect(ultrafast?.premiumMultiplier).toBe(4.8);
    expect(ultrafast?.cost).toEqual({ input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 });
    expect(ultrafast?.thinking?.requiresEffort).toBe(true);
    expect(ultrafast?.thinking?.efforts.map(String)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(ultrafast?.thinking?.defaultLevel).toBe(Effort.Medium);

    const solFast = byId("gpt-6-sol-fast");
    expect(solFast?.input).toEqual(["text", "image"]);
    expect(solFast?.premiumMultiplier).toBe(1.6);
    expect(solFast?.cost).toEqual({ input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 });
    expect(solFast?.thinking?.requiresEffort).toBeUndefined();
    expect(solFast?.thinking?.efforts.map(String)).toEqual(["low", "medium", "high", "xhigh", "max"]);

    const lunaFast = byId("gpt-6-luna-fast");
    expect(lunaFast?.premiumMultiplier).toBe(0.08);
    expect(lunaFast?.cost).toEqual({ input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0 });
    expect(lunaFast?.thinking?.requiresEffort).toBeUndefined();
    expect(lunaFast?.thinking?.defaultLevel).toBe(Effort.Medium);

    const deepseek = byId("deepseek-v4.1-flash-1017");
    expect(deepseek?.input).toEqual(["text", "image"]);
    expect(deepseek?.premiumMultiplier).toBe(0.12);
    expect(deepseek?.cost).toEqual({ input: 0.1, output: 0.27, cacheRead: 0.01, cacheWrite: 0 });
    expect(deepseek?.thinking?.efforts.map(String)).toEqual(["low", "high", "max"]);
    expect(deepseek?.thinking?.requiresEffort).toBeUndefined();
    expect(deepseek?.thinking?.defaultLevel).toBe(Effort.High);

    // MiniMax M3.1 has no published price; it reuses the minimax-m3 estimate branch.
    const minimax = byId("minimax-m3.1-flash");
    expect(minimax?.input).toEqual(["text", "image"]);
    expect(minimax?.premiumMultiplier).toBe(0.06);
    expect(minimax?.cost).toEqual({ input: 0.12, output: 0.48, cacheRead: 0.012, cacheWrite: 0 });
    expect(minimax?.thinking?.requiresEffort).toBe(true);
    expect(minimax?.thinking?.defaultLevel).toBe(Effort.Max);

    // Factory does not publish per-token prices for Muse or Beam.
    const muse = byId("muse-spark-1.2");
    expect(muse?.input).toEqual(["text"]);
    expect(muse?.premiumMultiplier).toBe(0.5);
    expect(muse?.thinking?.efforts.map(String)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(muse?.thinking?.requiresEffort).toBe(true);

    const beam = byId("beam-1.0");
    expect(beam?.input).toEqual(["text"]);
    expect(beam?.premiumMultiplier).toBe(0.52);
    expect(beam?.thinking?.efforts.map(String)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(beam?.thinking?.requiresEffort).toBe(true);
    expect(beam?.thinking?.defaultLevel).toBe(Effort.High);
  });
});

describe("parseFactoryModelDocs", () => {
  const entries = parseFactoryModelDocs(FIXTURE);

  test("keeps daggered rows and strips footnote glyphs from the display name", () => {
    const fable = entries.find((entry) => entry.id === "claude-fable-5");
    expect(fable).toBeDefined();
    expect(fable?.displayName).toBe("Claude Fable 5");
  });

  test("parses rows regardless of section heading", () => {
    expect(entries.some((entry) => entry.id === "kimi-k2.6")).toBe(true);
    expect(entries.some((entry) => entry.id === "claude-opus-4-8")).toBe(true);
  });

  test("parses supported google gemini family", () => {
    const gemini = entries.find((entry) => entry.id === "gemini-3.5-flash");
    expect(gemini).toBeDefined();
    expect(gemini?.displayName).toBe("Gemini 3.5 Flash");
    expect(gemini?.multiplier).toBe(0.5);
  });

  test("excludes unsupported families", () => {
    expect(entries.some((entry) => entry.id.startsWith("cohere-"))).toBe(false);
    // Droid 0.249.0 serves Muse Spark 1.3 over Responses, unlike 1.2.
    expect(parseFactoryModelDocs("| Muse Spark 1.3 | `muse-spark-1.3` | 0.5× | high |")).toEqual([]);
  });

  test("extracts numeric multiplier from the multiplier column", () => {
    const fable = entries.find((entry) => entry.id === "claude-fable-5");
    expect(fable?.multiplier).toBe(4);
    const kimi = entries.find((entry) => entry.id === "kimi-k2.6");
    expect(kimi?.multiplier).toBe(0.4);
  });

  test("parses inkling open model", () => {
    const inklingFixture = `
| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Inkling | \`inkling\` | 0.4× | Standard |
`;
    const inklingEntries = parseFactoryModelDocs(inklingFixture);
    expect(inklingEntries.length).toBe(1);
    expect(inklingEntries[0]?.id).toBe("inkling");
    expect(inklingEntries[0]?.multiplier).toBe(0.4);
  });

  test("returns no entries for non-markdown input", () => {
    expect(parseFactoryModelDocs("<html>not markdown</html>")).toEqual([]);
  });
});

describe("fetchFactoryDynamicModels", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws on non-OK response instead of returning the fallback catalog", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("", { status: 503 }))) as unknown as typeof fetch;
    await expect(fetchFactoryDynamicModels()).rejects.toThrow(/model docs/);
  });

  test("throws when the docs parse to zero entries", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("<html>not markdown</html>", { status: 200 }))) as unknown as typeof fetch;
    await expect(fetchFactoryDynamicModels()).rejects.toThrow(/zero entries/);
  });
  test("carries an abort signal on the docs request and rejects on timeout/abort", async () => {
    let docsSignal: AbortSignal | null | undefined;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("docs.factory.ai")) {
        docsSignal = init?.signal;
        const err = new Error("The operation was aborted");
        err.name = "TimeoutError";
        return Promise.reject(err);
      }
      return Promise.resolve(Response.json({ data: [] }));
    }) as typeof fetch;

    await expect(fetchFactoryDynamicModels()).rejects.toThrow();
    expect(docsSignal).toBeDefined();
    expect(docsSignal).toBeInstanceOf(AbortSignal);
  });

  test("succeeds when OpenRouter pricing fetch fails", async () => {
    const docs = `
| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Future Claude | \`claude-future\` | 1× | Standard |
`;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("docs.factory.ai")) {
        return new Response(docs, { status: 200 });
      }
      throw new Error("OpenRouter network error");
    }) as typeof fetch;

    const models = await fetchFactoryDynamicModels();
    expect(models.some((model) => model.id === "claude-future")).toBe(true);
    // Now curated statically, so docs discovery keeps the entry (via the static
    // catalog) rather than dropping it.
    expect(models.some((model) => model.id === "deepseek-v4.1-flash")).toBe(true);
  });

  test("uses conservative family limits for newly discovered model IDs", async () => {
    const docs = `
| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Future Claude | \`claude-future\` | 1× | Standard |
| Future GPT | \`gpt-future\` | 1× | Standard |
| Future Kimi | \`kimi-future\` | 1× | Standard |
`;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes("docs.factory.ai")
        ? new Response(docs, { status: 200 })
        : Response.json({ data: [] });
    }) as typeof fetch;

    const models = await fetchFactoryDynamicModels();
    const limitsFor = (id: string) => {
      const model = models.find((candidate) => candidate.id === id);
      return model ? [model.contextWindow, model.maxTokens] : undefined;
    };

    expect(limitsFor("claude-future")).toEqual([200_000, 64_000]);
    expect(limitsFor("gpt-future")).toEqual([400_000, 128_000]);
    expect(limitsFor("kimi-future")).toEqual([200_000, 32_000]);
  });

  test("docs discovery neither duplicates nor downgrades the static deepseek-v4.1-flash entry", async () => {
    const docs = `
| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash | \`deepseek-v4.1-flash\` | 0.12× | Standard |
`;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("docs.factory.ai")) {
        return new Response(docs, { status: 200 });
      }
      throw new Error("OpenRouter network error");
    }) as typeof fetch;

    const models = await fetchFactoryDynamicModels();
    const v41 = models.filter((model) => model.id === "deepseek-v4.1-flash");
    // The merge path must keep exactly one entry: the static audited one.
    expect(v41).toHaveLength(1);
    // Binary-audited limits survive the merge; conservative family defaults
    // must not replace them.
    expect(v41[0]?.contextWindow).toBe(1_040_000);
    expect(v41[0]?.maxTokens).toBe(131_072);
    expect(v41[0]?.input).toEqual(["text", "image"]);
    expect(v41[0]?.cost).toEqual({ input: 0.1, output: 0.27, cacheRead: 0.01, cacheWrite: 0 });
  });
});

describe("matchLivePrice", () => {
  const { matchLivePrice } = require("./model-refresh");
  const liveMap = new Map([
    ["anthropic/claude-opus-5", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 0 }],
    ["openai/gpt-6-astra", { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 0 }],
    ["moonshotai/kimi-k3", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }],
  ]);

  test("matches direct and prefixed model IDs from live OpenRouter map", () => {
    const opus = matchLivePrice("claude-opus-5", liveMap);
    expect(opus).toBeDefined();
    expect(opus.input).toBe(5);
    expect(opus.output).toBe(25);

    const astra = matchLivePrice("gpt-6-astra", liveMap);
    expect(astra).toBeDefined();
    expect(astra.input).toBe(10);
    expect(astra.output).toBe(50);

    const kimi = matchLivePrice("kimi-k3", liveMap);
    expect(kimi).toBeDefined();
    expect(kimi.input).toBe(3);
    expect(kimi.output).toBe(15);
  });

  test("returns undefined when no match found in live map", () => {
    expect(matchLivePrice("unknown-model", liveMap)).toBeUndefined();
  });
});
