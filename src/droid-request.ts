import type { FetchImpl } from "@oh-my-pi/pi-ai";

import { DROID_MODELS, type DroidApi, type DroidEffort, type DroidModel, type DroidRequest } from "./droid-registry";

// Fields Droid 1.3.0 decides per model, effort, and provider. Our request
// drops each of them and takes Droid's value, so a field Droid leaves out is
// left out here too.
const DROID_OWNED_FIELDS: Record<DroidApi, readonly string[]> = {
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
  ],
  google: [
    "generationConfig.thinkingConfig",
    "generationConfig.temperature",
    "generationConfig.topP",
    "generationConfig.topK",
    "generationConfig.maxOutputTokens",
  ],
};

// Droid adds fine-grained tool streaming whenever a request carries tools on
// these Anthropic providers.
const TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const TOOL_STREAMING_PROVIDERS = new Set(["anthropic", "vertex_anthropic", "azure_anthropic"]);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The requested effort when Droid lists it; otherwise off when the model has
// it, else its lowest effort, which is what Droid sends for an effort-only model.
export function droidEffortFor(droid: DroidModel, requested: string | undefined): DroidEffort {
  const effort = requested === "none" ? "off" : requested;
  if (effort && droid.efforts.includes(effort as DroidEffort)) return effort as DroidEffort;
  return droid.efforts.includes("off") ? "off" : droid.efforts[0];
}

function dropField(body: JsonObject, path: string): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  let parent: unknown = body;
  for (const key of keys) parent = isObject(parent) ? parent[key] : undefined;
  if (!isObject(parent)) return;
  delete parent[last];
  if (keys.length > 0 && Object.keys(parent).length === 0) dropField(body, keys.join("."));
}

function mergeInto(target: JsonObject, source: JsonObject): void {
  for (const [key, value] of Object.entries(source)) {
    if (isObject(value) && isObject(target[key])) mergeInto(target[key] as JsonObject, value);
    else target[key] = structuredClone(value);
  }
}

function fillSession(value: unknown, sessionId: string): unknown {
  if (value === "$session") return sessionId;
  if (Array.isArray(value)) return value.map((item) => fillSession(item, sessionId));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillSession(v, sessionId)]));
  return value;
}

export function applyDroidRequest(api: DroidApi, body: JsonObject, request: DroidRequest, sessionId: string): JsonObject {
  const next = structuredClone(body);
  for (const path of DROID_OWNED_FIELDS[api]) dropField(next, path);
  // Droid's chat body sends max_tokens (yt ?? Gn ?? oz) and never max_completion_tokens.
  if (api === "completions" && "max_completion_tokens" in next) {
    next.max_tokens = next.max_completion_tokens;
    delete next.max_completion_tokens;
  }
  mergeInto(next, fillSession(request.body, sessionId) as JsonObject);
  return next;
}

export function droidAnthropicBetas(request: DroidRequest, provider: string, hasTools: boolean): string[] {
  return [
    ...(request.betas ?? []),
    ...(hasTools && TOOL_STREAMING_PROVIDERS.has(provider) ? [TOOL_STREAMING_BETA] : []),
  ];
}

async function readBody(input: string | URL | Request, init?: RequestInit): Promise<string | undefined> {
  if (typeof init?.body === "string") return init.body;
  if (input instanceof Request) return input.clone().text().catch(() => undefined);
  return undefined;
}

export interface DroidRequestTarget {
  modelId: string;
  provider: string;
  requestedEffort: string | undefined;
  sessionId: string;
}

// Rewrites each outgoing request so the Droid-owned fields carry what Droid
// 1.3.0 sends for this model, effort, and provider. Models without a Droid row
// pass through unchanged.
export function createDroidRequestFetch(baseFetch: FetchImpl, target: DroidRequestTarget): FetchImpl {
  const droid = DROID_MODELS[target.modelId];
  const request = droid?.requests[target.provider]?.[droidEffortFor(droid, target.requestedEffort)];
  if (!droid || !request) return baseFetch;

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = await readBody(input, init);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    if (!isObject(body)) return baseFetch(input, init);

    const next = applyDroidRequest(droid.api, body, request, target.sessionId);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (droid.api === "anthropic") {
      const hasTools = Array.isArray(next.tools) && next.tools.length > 0;
      const betas = droidAnthropicBetas(request, target.provider, hasTools);
      if (betas.length > 0) headers.set("anthropic-beta", betas.join(","));
      else headers.delete("anthropic-beta");
    }
    const url = input instanceof Request ? input.url : input;
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return baseFetch(url, {
      ...init,
      method: init?.method ?? (input instanceof Request ? input.method : "POST"),
      headers,
      body: JSON.stringify(next),
      signal,
    });
  }) as FetchImpl;
}
