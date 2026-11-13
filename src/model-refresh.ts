import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import {
  defaultCostFor,
  droidMultiplierFor,
  FACTORY_MODELS,
  factoryModel,
  familyOf,
  type FactoryModelInput,
} from "./catalog";

const FACTORY_MODEL_DOCS_URL = "https://docs.factory.ai/models.md";
const FACTORY_MODEL_DOCS_TIMEOUT_MS = 10_000;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Factory's public model table does not publish token limits. For a newly
// discovered ID with no curated entry, use conservative family defaults until
// its upstream and Droid-hosted limits have been audited explicitly.
const DISCOVERED_MODEL_LIMITS = {
  anthropic: { contextWindow: 200_000, maxTokens: 64_000 },
  "openai-responses": { contextWindow: 400_000, maxTokens: 128_000 },
  "openai-completions": { contextWindow: 200_000, maxTokens: 32_000 },
  google: { contextWindow: 1_000_000, maxTokens: 65_536 },
} as const;

// Factory ids whose OpenRouter id is spelled differently. Only clear one-to-one
// equivalents are listed; a model with none (fast variants, qwen3.8-max,
// nemotron-3.5-super, Atlas, Aster, Garnet) keeps its static estimate.
export const OPENROUTER_IDS: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "anthropic/claude-opus-5.5",
  "claude-opus-4-8": "anthropic/claude-opus-4.8",
  "claude-opus-4-7": "anthropic/claude-opus-4.7",
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-opus-4-5-20251101": "anthropic/claude-opus-4.5",
  "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-sonnet-4-5-20250929": "anthropic/claude-sonnet-4.5",
  "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  // Droid's baseten model is NVIDIA-Nemotron-3-Ultra-550B-A55B.
  "nemotron-3-ultra": "nvidia/nemotron-3-ultra-550b-a55b",
  // Droid's baseten model is reflection/Beam-1.0.
  "beam-1.0": "reflection/beam-1.0-501b-a23b",
  "mistral-large-4": "mistralai/mistral-large-4-0",
  // Droid's mistral model id is mistral-medium-3-5.
  "mistral-medium-3.5": "mistralai/mistral-medium-3-5",
};

const PROVIDER_PREFIXES = [
  "anthropic/",
  "openai/",
  "google/",
  "moonshotai/",
  "deepseek/",
  "z-ai/",
  "minimax/",
  "x-ai/",
  "nvidia/",
  "qwen/",
  "alibaba/",
  "mistralai/",
  "mistral/",
] as const;

function parsePerMillionCost(rawPricePerToken: string | undefined): number {
  return Math.round(Number(rawPricePerToken || 0) * 1_000_000 * 1000) / 1000;
}

export type FactoryModelDocsEntry = {
  id: string;
  displayName: string;
  multiplier?: number;
  reasoning: string;
};

export type LiveTokenCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

function stripDocsMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMultiplier(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const match = cell.match(/([\d.]+)[\s*×xX]/);
  if (match && match[1]) {
    const parsed = parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export async function fetchOpenRouterPrices(): Promise<Map<string, LiveTokenCost>> {
  const priceMap = new Map<string, LiveTokenCost>();
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return priceMap;
    const payload = (await response.json()) as {
      data?: Array<{
        id: string;
        pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
      }>;
    };
    if (!Array.isArray(payload.data)) return priceMap;

    for (const model of payload.data) {
      if (model.id && model.pricing) {
        const input = parsePerMillionCost(model.pricing.prompt);
        const output = parsePerMillionCost(model.pricing.completion);
        const cacheRead = parsePerMillionCost(model.pricing.input_cache_read);
        const cacheWrite = parsePerMillionCost(model.pricing.input_cache_write);
        if (input > 0 || output > 0) {
          priceMap.set(model.id.toLowerCase(), { input, output, cacheRead, cacheWrite });
        }
      }
    }
  } catch {
    // Non-critical: network timeout or offline falls back cleanly to default catalog pricing
  }
  return priceMap;
}

export function matchLivePrice(id: string, priceMap: Map<string, LiveTokenCost>): LiveTokenCost | undefined {
  if (priceMap.size === 0) return undefined;
  const normalizedId = id.toLowerCase();
  const mapped = OPENROUTER_IDS[normalizedId];
  if (mapped) return priceMap.get(mapped);
  const directMatch = priceMap.get(normalizedId);
  if (directMatch) return directMatch;

  for (const prefix of PROVIDER_PREFIXES) {
    const prefixedCost = priceMap.get(prefix + normalizedId);
    if (prefixedCost) return prefixedCost;
  }

  for (const [candidateId, tokenCost] of priceMap.entries()) {
    if (candidateId.endsWith("/" + normalizedId) || candidateId.endsWith(":" + normalizedId)) {
      return tokenCost;
    }
  }
  return undefined;
}

// Section-independent: the model ID's family is the only gate. Any table row
// with a backticked ID whose family we can route is kept, no matter which
// heading it appears under and no matter what footnote glyphs decorate it —
// new or renamed docs sections must never silently drop models.
export function parseFactoryModelDocs(markdown: string): FactoryModelDocsEntry[] {
  const entries: FactoryModelDocsEntry[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (!line.startsWith("|")) {
      continue;
    }

    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) {
      continue;
    }

    // Header/separator rows have no backticked ID, so this skips them too.
    const idMatch = (cells[2] ?? "").match(/`([^`]+)`/);
    if (!idMatch) {
      continue;
    }

    const id = idMatch[1].trim();
    if (id.length === 0 || familyOf(id) === "unsupported") {
      continue;
    }

    const displayName = stripDocsMarkup(cells[1] ?? "").replace(/[\s*†‡§]+$/u, "");
    const multiplier = parseMultiplier(cells[3]);

    entries.push({
      id,
      displayName: displayName.length > 0 ? displayName : id,
      multiplier,
      reasoning: cells[4] ?? "",
    });
  }

  return entries;
}

function docsEntryToModel(entry: FactoryModelDocsEntry, liveCost?: LiveTokenCost): ProviderModelConfig | null {
  const cost = liveCost ?? defaultCostFor(entry.id);
  switch (familyOf(entry.id)) {
    case "anthropic":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        cost,
        premiumMultiplier: entry.multiplier,
        ...DISCOVERED_MODEL_LIMITS.anthropic,
      });
    case "openai-responses":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        cost,
        premiumMultiplier: entry.multiplier,
        ...DISCOVERED_MODEL_LIMITS["openai-responses"],
      });
    case "openai-completions":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory Core)`,
        reasoning: true,
        input: ["text"],
        cost,
        premiumMultiplier: entry.multiplier,
        contextWindow: DISCOVERED_MODEL_LIMITS["openai-completions"].contextWindow,
        maxTokens: DISCOVERED_MODEL_LIMITS["openai-completions"].maxTokens,
      });
    case "google":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        cost,
        premiumMultiplier: entry.multiplier,
        ...DISCOVERED_MODEL_LIMITS.google,
      });
    case "unsupported":
      return null;
  }
}

function mergeDocsModels(
  entries: FactoryModelDocsEntry[],
  livePrices: Map<string, LiveTokenCost> = new Map(),
): ProviderModelConfig[] {
  // Promotions start and end by date, so each refresh recomputes the multiplier.
  const merged: ProviderModelConfig[] = FACTORY_MODELS.map((model) => {
    const liveCost = matchLivePrice(model.id, livePrices);
    const premiumMultiplier = droidMultiplierFor(model.id) ?? model.premiumMultiplier;
    return liveCost ? { ...model, cost: liveCost, premiumMultiplier } : { ...model, premiumMultiplier };
  });

  const seenModelIds = new Set<string>(merged.map((model) => model.id));

  for (const entry of entries) {
    if (seenModelIds.has(entry.id)) {
      continue;
    }

    const liveCost = matchLivePrice(entry.id, livePrices);
    const model = docsEntryToModel(entry, liveCost);
    if (!model) {
      continue;
    }

    merged.push(model);
    seenModelIds.add(entry.id);
  }

  return merged;
}

// Throws on any fetch/parse failure. pi-catalog catches the error, keeps the
// last-good cached catalog non-authoritatively, and retries in 5 minutes —
// strictly better than returning the static fallback, which would be recorded
// as a successful authoritative fetch and drop every docs-only model for 24 h.
export async function fetchFactoryDynamicModels(_apiKey?: string): Promise<readonly ProviderModelConfig[]> {
  const [docsResponse, livePrices] = await Promise.all([
    fetch(FACTORY_MODEL_DOCS_URL, {
      signal: AbortSignal.timeout(FACTORY_MODEL_DOCS_TIMEOUT_MS),
      headers: { Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
    }),
    fetchOpenRouterPrices(),
  ]);

  if (!docsResponse.ok) {
    throw new Error(`factory: model docs fetch failed: HTTP ${docsResponse.status}`);
  }

  const markdown = await docsResponse.text();

  const entries = parseFactoryModelDocs(markdown);
  if (entries.length === 0) {
    throw new Error("factory: model docs parsed to zero entries — docs format changed?");
  }

  return mergeDocsModels(entries, livePrices);
}
