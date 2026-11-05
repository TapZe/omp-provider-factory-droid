import { describe, expect, test } from "bun:test";
import type { Context } from "@oh-my-pi/pi-ai";

import { FACTORY_MODELS } from "./catalog";
import { DROID_MODELS, type DroidApi, type DroidEffort, type DroidRegion } from "./droid-registry";
import { factoryStreamSimple } from "./router";

const SESSION = "wire-session";
const READ_TOOL: NonNullable<Context["tools"]>[number] = {
  name: "read",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

// The request fields Droid 1.3.0 decides for each API. Any of these that
// Droid leaves out must be absent from our request too.
const OWNED: Record<DroidApi, readonly string[]> = {
  anthropic: ["thinking", "output_config.effort", "speed", "context_management"],
  responses: [
    "reasoning",
    "include",
    "parallel_tool_calls",
    "prompt_cache_retention",
    "text.verbosity",
    "service_tier",
    "safety_identifier",
    "max_output_tokens",
    "tool_choice",
  ],
  completions: [
    "reasoning_effort",
    "reasoning_history",
    "chat_template_args",
    "chat_template_kwargs.enable_thinking",
    "enable_thinking",
    "allow_missing_thinking",
    "thinking",
    "reasoning",
    "temperature",
    "store",
    "tool_choice",
    "max_completion_tokens",
  ],
  google: [
    "generationConfig.thinkingConfig",
    "generationConfig.temperature",
    "generationConfig.topP",
    "generationConfig.topK",
    "generationConfig.maxOutputTokens",
  ],
};

// Droid adds this beta whenever tools are present on these providers.
const TOOL_STREAMING_PROVIDERS = new Set(["anthropic", "vertex_anthropic", "azure_anthropic"]);

function lookup(body: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], body);
}

function withSession(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll('"$session"', JSON.stringify(SESSION)));
}

type Captured = { body: Record<string, unknown>; provider: string | null; beta: string | null };

const REGIONS: readonly DroidRegion[] = ["global", "eu", "us"];

async function send(modelId: string, effort: DroidEffort, region: DroidRegion) {
  const model = FACTORY_MODELS.find((entry) => entry.id === modelId)!;
  const originalFetch = globalThis.fetch;
  let captured: Captured | undefined;
  let result: Awaited<ReturnType<ReturnType<typeof factoryStreamSimple>["result"]>> | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    captured = {
      body: (await request.json()) as Record<string, unknown>,
      provider: request.headers.get("x-api-provider"),
      beta: request.headers.get("anthropic-beta"),
    };
    return new Response("{}", { status: 400 });
  }) as typeof fetch;
  try {
    const stream = factoryStreamSimple(
      model as unknown as Parameters<typeof factoryStreamSimple>[0],
      {
        systemPrompt: [],
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 }],
        tools: [READ_TOOL],
      },
      {
        apiKey: JSON.stringify({
          token: "t",
          orgId: "o",
          apiEndpoint: "https://api.test.factory.ai",
          inferenceRegion: region,
        }),
        sessionId: SESSION,
        ...(effort === "off" ? {} : { reasoning: effort as never }),
      },
    );
    result = await stream.result();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { captured, result: result! };
}

async function capture(modelId: string, effort: DroidEffort, region: DroidRegion): Promise<Captured> {
  const { captured } = await send(modelId, effort, region);
  if (!captured) throw new Error(`no request captured for ${modelId} at ${effort} in ${region}`);
  return captured;
}

describe("request fields follow Droid 1.3.0 for every model, effort, and region", () => {
  for (const region of REGIONS) {
    for (const model of FACTORY_MODELS) {
      const droid = DROID_MODELS[model.id];
      const provider = droid.providers[region];
      if (!provider) {
        test(`${model.id} is not offered in ${region}`, async () => {
          const { captured, result } = await send(model.id, droid.defaultEffort, region);
          expect(captured).toBeUndefined();
          expect(result.errorMessage).toContain(`not available in the ${region} inference region`);
        });
        continue;
      }
      for (const effort of droid.efforts) {
        test(`${model.id} at ${effort} in ${region} on ${provider}`, async () => {
          const expected = droid.requests[provider][effort]!;
          const request = await capture(model.id, effort, region);
          const body = withSession(expected.body) as Record<string, unknown>;

          expect(request.provider).toBe(provider);
          expect(request.body).toMatchObject(body);
          for (const path of OWNED[droid.api]) {
            expect({ path, value: lookup(request.body, path) }).toEqual({ path, value: lookup(body, path) });
          }
          if (droid.api === "anthropic") {
            const betas = [
              ...(expected.betas ?? []),
              ...(TOOL_STREAMING_PROVIDERS.has(provider) ? ["fine-grained-tool-streaming-2025-05-14"] : []),
            ];
            expect(request.beta?.split(",").sort() ?? []).toEqual(betas.sort());
          }
        });
      }
    }
  }
});
