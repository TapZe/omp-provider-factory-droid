import { describe, expect, it } from "bun:test";
import { Effort, type AssistantMessage, type Context, type ToolCall } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { StreamMarkupHealing } from "@oh-my-pi/pi-ai/utils/stream-markup-healing";
import { ANTHROPIC_BETAS, FACTORY_CLIENT_VERSION, FACTORY_DROID_SYSTEM_PROMPT } from "./constants";
import { factoryStreamSimple, prepareContextForFactory } from "./router";
import { FACTORY_MODELS } from "./catalog";
import {
  factoryStreamMarkupHealingPattern,
  normalizeFactoryToolCallStream,
} from "./tool-call-normalization";

const READ_TOOL: NonNullable<Context["tools"]>[number] = {
  name: "read",
  description: "Read a file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

function assistantMessage(model: string, content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "factory",
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

async function normalizeLeakedText(model: string, markup: string): Promise<AssistantMessage> {
  const inner = new AssistantMessageEventStream();
  const normalized = normalizeFactoryToolCallStream(inner, [READ_TOOL], true);
  const empty = assistantMessage(model, []);
  const complete = assistantMessage(model, [{ type: "text", text: markup }]);
  const splitAt = Math.floor(markup.length / 2);

  inner.push({ type: "start", partial: empty });
  inner.push({ type: "text_start", contentIndex: 0, partial: complete });
  inner.push({ type: "text_delta", contentIndex: 0, delta: markup.slice(0, splitAt), partial: complete });
  inner.push({ type: "text_delta", contentIndex: 0, delta: markup.slice(splitAt), partial: complete });
  inner.push({ type: "text_end", contentIndex: 0, content: markup, partial: complete });
  inner.push({ type: "done", reason: "stop", message: complete });

  return normalized.result();
}

function testFactoryModel(modelId: string): Parameters<typeof factoryStreamSimple>[0] {
  const model = FACTORY_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error(`Missing Factory model fixture: ${modelId}`);
  }

  return model as unknown as Parameters<typeof factoryStreamSimple>[0];
}

type CapturedFactoryCoreRequest = {
  body: Record<string, unknown>;
  apiProvider: string | null;
};

async function captureFactoryCoreRequest(modelId: string): Promise<CapturedFactoryCoreRequest> {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  let apiProvider: string | null | undefined;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.toString(), init);
    apiProvider = request.headers.get("x-api-provider");
    requestBody = (await request.json()) as Record<string, unknown>;

    return new Response(
      [
        'data: {"id":"chatcmpl_factory","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl_factory","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_factory_1",
      name: "read",
      arguments: { path: "src/index.ts" },
    };
    const stream = factoryStreamSimple(
      testFactoryModel(modelId),
      {
        systemPrompt: [],
        messages: [
          assistantMessage(modelId, [toolCall]),
          {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: "source" }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
        tools: [READ_TOOL],
      },
      {
        apiKey: JSON.stringify({
          token: "test-factory-oauth-token",
          orgId: "test-org",
          apiEndpoint: "https://api.test.factory.ai",
        }),
        sessionId: "test-session",
      },
    );

    await stream.result();
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!requestBody || apiProvider === undefined) {
    throw new Error("Factory request was not captured");
  }

  return { body: requestBody, apiProvider };
}

type CapturedFactoryAnthropicRequest = {
  body: Record<string, unknown>;
  betaHeader: string | null;
};

async function captureFactoryAnthropicRequest(
  modelId: string,
  reasoning: Effort,
): Promise<CapturedFactoryAnthropicRequest> {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  let betaHeader: string | null | undefined;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.toString(), init);
    requestBody = (await request.json()) as Record<string, unknown>;
    betaHeader = request.headers.get("anthropic-beta");

    return new Response(
      [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_factory","type":"message","role":"assistant","model":"echo","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    const stream = factoryStreamSimple(
      testFactoryModel(modelId),
      {
        systemPrompt: [],
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 }],
        tools: [READ_TOOL],
      },
      {
        apiKey: JSON.stringify({
          token: "test-factory-oauth-token",
          orgId: "test-org",
          apiEndpoint: "https://api.test.factory.ai",
        }),
        reasoning,
        sessionId: "test-session",
      },
    );

    await stream.result();
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!requestBody || betaHeader === undefined) {
    throw new Error("Factory Anthropic request was not captured");
  }

  return { body: requestBody, betaHeader };
}

describe("Factory Router & Tool Execution Configuration", () => {
  it("uses the latest Droid CLI client version", () => {
    expect(FACTORY_CLIENT_VERSION).toBe("0.223.0");
  });

  it("includes required Anthropic betas for tool streaming and thinking", () => {
    expect(ANTHROPIC_BETAS).toContain("fine-grained-tool-streaming-2025-05-14");
    expect(ANTHROPIC_BETAS).toContain("interleaved-thinking-2025-05-14");
  });

  it("uses Droid-compatible adaptive thinking for current Claude models", async () => {
    const adaptiveModels = ["claude-fable-5.1", "claude-fable-5", "claude-opus-5", "claude-opus-4-8"];

    for (const modelId of adaptiveModels) {
      const { body, betaHeader } = await captureFactoryAnthropicRequest(modelId, Effort.Medium);

      expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
      expect(body.output_config).toEqual({ effort: "medium" });
      expect(betaHeader).toContain("effort-2025-11-24");
    }
  });

  it("selects Claude generation-specific thinking without changing MiniMax", async () => {
    const sonnet = await captureFactoryAnthropicRequest("claude-sonnet-4-6", Effort.High);
    expect(sonnet.body.thinking).toEqual({ type: "adaptive" });
    expect(sonnet.body.output_config).toEqual({ effort: "high" });

    const opus45 = await captureFactoryAnthropicRequest("claude-opus-4-5-20251101", Effort.High);
    expect(opus45.body.thinking).toMatchObject({ type: "enabled", budget_tokens: 24_576 });
    // Current pi-ai forwards the same budget-effort control Droid sends.
    expect(opus45.body.output_config).toEqual({ effort: "high" });

    const minimax = await captureFactoryAnthropicRequest("minimax-m3", Effort.High);
    expect(minimax.body.thinking).toMatchObject({ type: "enabled" });
    expect(minimax.body.output_config).toBeUndefined();
  });

  it("contains the Droid system prompt prefix enforcing tool usage", () => {
    expect(FACTORY_DROID_SYSTEM_PROMPT).toStartWith(
      "You are Droid, an AI software engineering agent built by Factory.",
    );
    expect(FACTORY_DROID_SYSTEM_PROMPT).toContain("EXECUTION DIRECTIVES");
  });

  it("prepends Droid system prompt prefix while preserving tools and messages", () => {
    const context = {
      systemPrompt: ["You are Oh My Pi coding assistant."],
      messages: [],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
        {
          name: "bash",
          description: "Run bash command",
          parameters: { type: "object", properties: { command: { type: "string" } } },
        },
      ],
    };

    const prepared = prepareContextForFactory(context);

    expect(prepared.systemPrompt?.[0]).toBe(FACTORY_DROID_SYSTEM_PROMPT);
    expect(prepared.systemPrompt?.[1]).toBe("You are Oh My Pi coding assistant.");
    expect(prepared.tools?.[0].name).toBe("read_file");
    expect(prepared.tools?.[1].name).toBe("bash");
  });

  it("preserves assistant messages and tool results verbatim", () => {
    const context = {
      messages: [
        {
          role: "assistant" as const,
          content: [
            {
              type: "toolCall" as const,
              id: "tc_1",
              name: "read_file",
              arguments: { path: "src/index.ts" },
            },
          ],
        },
        {
          role: "toolResult" as const,
          toolCallId: "tc_1",
          toolName: "read_file",
          content: [{ type: "text" as const, text: "file content" }],
          isError: false,
        },
      ],
    };

    const prepared = prepareContextForFactory(context as any);

    const assistantMsg = prepared.messages?.[0];
    expect((assistantMsg?.content as any[])[0].name).toBe("read_file");

    const toolResultMsg = prepared.messages?.[1] as any;
    expect(toolResultMsg?.toolName).toBe("read_file");
  });

  it("correctly maps model families and upstream providers", () => {
    const { familyOf, upstreamProviderFor } = require("./catalog");
    expect(familyOf("claude-opus-5")).toBe("anthropic");
    expect(upstreamProviderFor("claude-opus-5")).toBe("anthropic");
    expect(familyOf("minimax-m3")).toBe("anthropic");
    expect(upstreamProviderFor("minimax-m3")).toBe("fireworks");
    expect(familyOf("gpt-5.6-sol")).toBe("openai-responses");
    expect(upstreamProviderFor("gpt-5.6-sol")).toBe("openai");
    expect(familyOf("gpt-6-astra")).toBe("openai-responses");
    expect(upstreamProviderFor("gpt-6-astra")).toBe("openai");
    expect(familyOf("kimi-k3")).toBe("openai-completions");
    expect(upstreamProviderFor("kimi-k3")).toBe("fireworks");
    expect(familyOf("grok-4.6")).toBe("openai-responses");
    expect(upstreamProviderFor("grok-4.6")).toBe("xai");
    expect(familyOf("gemini-3.8-flash")).toBe("google");
    expect(upstreamProviderFor("gemini-3.8-flash")).toBe("google");
    expect(familyOf("deepseek-v4-pro")).toBe("openai-completions");
    expect(upstreamProviderFor("deepseek-v4-pro")).toBe("fireworks");
  });
  it("preserves Factory Core reasoning and tool-call history", async () => {
    const expectedReasoningContent = new Map([
      ["glm-5.3", "."],
      ["kimi-k3", "."],
      ["deepseek-v4-pro", ""],
    ]);

    for (const [modelId, reasoningContent] of expectedReasoningContent) {
      const { body: request } = await captureFactoryCoreRequest(modelId);
      const messages = request.messages as Array<Record<string, unknown>>;
      const assistantToolCall = messages.find((message) => Array.isArray(message.tool_calls));

      expect(request.reasoning_history).toBe(modelId.startsWith("deepseek-") ? "interleaved" : "preserved");
      expect(request.tool_choice).toBe("auto");
      expect(request.tools).toHaveLength(1);
      expect(assistantToolCall?.reasoning_content).toBe(reasoningContent);
      const [wireToolCall] = (assistantToolCall?.tool_calls ?? []) as Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
      const toolResult = messages.find(
        (message) => message.role === "tool" && message.tool_call_id === "call_factory_1",
      );

      expect(wireToolCall?.id).toBe("call_factory_1");
      expect(wireToolCall?.function.name).toBe("read");
      expect(JSON.parse(wireToolCall?.function.arguments ?? "{}")).toEqual({
        path: "src/index.ts",
      });
      expect(toolResult).toMatchObject({
        role: "tool",
        tool_call_id: "call_factory_1",
        content: "source",
      });
      expect(toolResult?.name).toBe(modelId.startsWith("kimi-") ? "read" : undefined);
    }
  });

  it("routes Grok through Factory's OpenAI Responses gateway with xai provider", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const request = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.toString(), init);
      capturedUrl = request.url;
      capturedHeaders = request.headers;

      return new Response(
        [
          'data: {"id":"resp_grok","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    try {
      const stream = factoryStreamSimple(
        testFactoryModel("grok-4.6"),
        {
          systemPrompt: [],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
        },
        {
          apiKey: JSON.stringify({
            token: "test-factory-oauth-token",
            orgId: "test-org",
            apiEndpoint: "https://api.test.factory.ai",
          }),
        },
      );

      await stream.result();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedUrl).toBe("https://api.test.factory.ai/api/llm/o/v1/responses");
    expect(capturedHeaders?.get("x-api-provider")).toBe("xai");
    expect(capturedHeaders?.get("openai-platform")).toBe("org-bHuLtG1fGmYk5YaOihAAXFBw");
    expect(capturedHeaders?.get("x-factory-org-id")).toBe("test-org");
    expect(capturedHeaders?.get("x-provider-routing-source")).toBe("registry_default");
    expect(capturedHeaders?.get("x-client-version")).toBe("0.223.0");
    expect(capturedHeaders?.get("user-agent")).toBe("factory-cli/0.223.0");
    expect(capturedHeaders?.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("routes Gemini through Factory's Google gateway with google provider and custom fetch", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;
    let capturedBody: any;

    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const request = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.toString(), init);
      capturedUrl = request.url;
      capturedHeaders = request.headers;
      capturedBody = await request.json();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const chunk =
            "data: " +
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Hello from Factory Gemini!" }],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 20,
                candidatesTokenCount: 10,
                totalTokenCount: 30,
              },
            }) +
            "\n\n";
          controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });

      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    try {
      const stream = factoryStreamSimple(
        testFactoryModel("gemini-3.8-flash"),
        {
          systemPrompt: ["Project context instructions"],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
        },
        {
          apiKey: JSON.stringify({
            token: "test-factory-oauth-token",
            orgId: "test-org",
            apiEndpoint: "https://api.test.factory.ai",
          }),
          sessionId: "test-session-gemini",
          reasoning: Effort.High,
        },
      );

      const result = await stream.result();
      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ type: "text", text: "Hello from Factory Gemini!" }]);
      expect(result.usage.totalTokens).toBe(30);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedUrl).toBe("https://api.test.factory.ai/api/llm/g/v1/generate");
    expect(capturedHeaders?.get("x-api-provider")).toBe("google");
    expect(capturedHeaders?.get("x-provider-routing-source")).toBe("registry_default");
    expect(capturedHeaders?.get("x-client-version")).toBe(FACTORY_CLIENT_VERSION);
    expect(capturedHeaders?.get("x-factory-client")).toBe("cli");
    expect(capturedHeaders?.get("user-agent")).toBe(`factory-cli/${FACTORY_CLIENT_VERSION}`);
    expect(capturedHeaders?.get("authorization")).toBe("Bearer test-factory-oauth-token");
    expect(capturedHeaders?.get("x-factory-org-id")).toBe("test-org");
    expect(capturedHeaders?.get("x-session-id")).toBe("test-session-gemini");
    expect(capturedHeaders?.has("x-assistant-message-id")).toBe(true);
    expect(capturedHeaders?.has("x-goog-api-key")).toBe(false);

    // Body validation
    expect(capturedBody.model).toBe("gemini-3.8-flash");
    expect(capturedBody.contents).toBeDefined();
    expect(Array.isArray(capturedBody.contents)).toBe(true);
    expect(capturedBody.systemInstruction).toBeDefined();
    expect(capturedBody.systemInstruction.parts[0].text).toContain("You are Droid, an AI software engineering agent built by Factory");
    expect(capturedBody.generationConfig?.thinkingConfig?.thinkingLevel).toBe("HIGH");
  });

  it("handles tool calling with Gemini stream", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: any;

    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const request = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.toString(), init);
      capturedBody = await request.json();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const chunk =
            "data: " +
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: "read",
                          args: { path: "src/router.ts" },
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8, totalTokenCount: 23 },
            }) +
            "\n\n";
          controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });

      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    try {
      const stream = factoryStreamSimple(
        testFactoryModel("gemini-3.8-flash"),
        {
          systemPrompt: [],
          messages: [{ role: "user", content: [{ type: "text", text: "read router" }], timestamp: Date.now() }],
          tools: [READ_TOOL],
        },
        {
          apiKey: JSON.stringify({
            token: "test-factory-oauth-token",
            orgId: "test-org",
            apiEndpoint: "https://api.test.factory.ai",
          }),
        },
      );

      const result = await stream.result();
      expect(result.stopReason).toBe("toolUse");
      const toolCall = result.content.find((c): c is ToolCall => c.type === "toolCall");
      expect(toolCall).toBeDefined();
      expect(toolCall?.name).toBe("read");
      expect(toolCall?.arguments).toEqual({ path: "src/router.ts" });
      expect(capturedBody.tools).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("supports max thinking effort and attaches identity for all model families", async () => {
    const { identityFor, FACTORY_EFFORTS, factoryThinkingFor, defaultCostFor, FACTORY_MODELS } = require("./catalog");

    expect(identityFor("grok-4.5")).toEqual({ class: "xai", family: "grok" });
    expect(identityFor("glm-5.3-flash")).toEqual({ class: "glm", family: "glm" });
    expect(identityFor("gpt-5.6-sol")).toEqual({ class: "openai", family: "gpt" });
    expect(identityFor("gpt-6-astra")).toEqual({ class: "openai", family: "gpt" });
    expect(identityFor("claude-opus-5")).toEqual({ class: "anthropic", family: "opus" });
    expect(identityFor("gemini-3.8-flash")).toEqual({ class: "google", family: "gemini" });
    expect(identityFor("garnet-07-15")).toEqual({ class: "google", family: "garnet" });
    expect(identityFor("nemotron-3-ultra")).toEqual({ class: "nemotron", family: "nemotron" });
    expect(identityFor("qwen3.8-max")).toEqual({ class: "qwen", family: "qwen" });
    expect(identityFor("mistral-medium-3.5")).toEqual({ class: "mistral", family: "mistral" });
    expect(identityFor("atlas-07-21")).toEqual({ class: "anthropic", family: "atlas" });
    expect(FACTORY_EFFORTS).toContain("max");

    const { upstreamProviderFor } = require("./catalog");
    expect(upstreamProviderFor("mistral-medium-3.5")).toBe("mistral");
    expect(upstreamProviderFor("garnet-07-15")).toBe("google");
    expect(upstreamProviderFor("qwen3.8-max")).toBe("fireworks");
    expect(upstreamProviderFor("deepseek-v4.1-flash")).toBe("fireworks");
    expect(upstreamProviderFor("atlas-07-21")).toBe("anthropic");

    const gpt6Thinking = factoryThinkingFor("gpt-6-astra", true, undefined);
    expect(gpt6Thinking?.effortMap?.["max" as any]).toBe("xhigh");
    expect(gpt6Thinking?.effortMap?.[Effort.XHigh]).toBeUndefined();

    const atlasThinking = factoryThinkingFor("atlas-07-21", true, undefined);
    expect(atlasThinking?.mode).toBe("anthropic-adaptive");
    expect(atlasThinking?.supportsDisplay).toBe(true);

    const asterThinking = factoryThinkingFor("aster-07-15", true, undefined);
    expect(asterThinking?.mode).toBe("anthropic-adaptive");
    expect(asterThinking?.supportsDisplay).toBe(true);

    const glmThinking = factoryThinkingFor("glm-5.3", true, undefined);
    expect(glmThinking?.effortMap?.["max" as any]).toBe("xhigh");

    const nemoCost = defaultCostFor("nemotron-3-ultra");
    expect(nemoCost).toEqual({ input: 0.4, output: 1.0, cacheRead: 0.04, cacheWrite: 0 });
    const nemoModel = FACTORY_MODELS.find((m: any) => m.id === "nemotron-3-ultra");
    expect(nemoModel?.premiumMultiplier).toBe(0.24);
    expect(nemoModel?.contextWindow).toBe(202_000);
    expect(nemoModel?.maxTokens).toBe(65_536);

    const flashCost = defaultCostFor("glm-5.3-flash");
    expect(flashCost).toEqual({ input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 });
    const geminiFlashCost = defaultCostFor("gemini-3.8-flash");
    expect(geminiFlashCost).toEqual({ input: 0.3, output: 1.5, cacheRead: 0.075, cacheWrite: 0 });
    const geminiProCost = defaultCostFor("gemini-3.1-pro-preview");
    expect(geminiProCost).toEqual({ input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 });
    const flashModel = FACTORY_MODELS.find((m: any) => m.id === "glm-5.3-flash");
    expect(flashModel?.premiumMultiplier).toBe(0.06);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        [
          'data: {"id":"resp_test","choices":[{"delta":{"content":"ok"}}]}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;

    try {
      // Must not throw "Thinking effort max is not supported" or "undefined is not an object (evaluating 'e.identity.class')"
      const stream = factoryStreamSimple(
        testFactoryModel("glm-5.3-flash"),
        {
          systemPrompt: [],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
        },
        {
          apiKey: JSON.stringify({
            token: "test-factory-oauth-token",
            orgId: "test-org",
            apiEndpoint: "https://api.test.factory.ai",
          }),
          reasoning: "max" as any,
        },
      );

      await stream.result();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves 403 classification while redacting the selected organization", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify({ error: { message: "account is not entitled" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const stream = factoryStreamSimple(
        testFactoryModel("glm-5.3-flash"),
        {
          systemPrompt: [],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
        },
        {
          apiKey: JSON.stringify({
            token: "test-factory-oauth-token",
            orgId: "org-sensitive-123456",
            apiEndpoint: "https://api.test.factory.ai",
          }),
        },
      );

      const result = await stream.result();
      expect(result.stopReason).toBe("error");
      expect(result.errorStatus).toBe(403);
      expect(result.errorMessage).toContain("source=oauth-envelope");
      expect(result.errorMessage).toContain("X-Factory-Org-Id=org…56");
      expect(result.errorMessage).not.toContain("org-sensitive-123456");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});

describe("Factory Droid tool-call normalization", () => {

  it("selects Droid-compatible markup healing per open model family", () => {
    expect(factoryStreamMarkupHealingPattern("glm-5")).toBe("thinking");
    expect(factoryStreamMarkupHealingPattern("kimi-k3")).toBe("kimi");
    expect(factoryStreamMarkupHealingPattern("deepseek-v4-flash")).toBe("dsml");
    expect(factoryStreamMarkupHealingPattern("claude-opus-5")).toBeUndefined();
  });

  it("repairs GLM JSON markup instead of dispatching the JSON as the tool name", async () => {
    const markup = [
      "<tool_",
      'call>{"name":"read","arguments":{"path":"src/index.ts"}}</tool_',
      "call>",
    ].join("");
    const result = await normalizeLeakedText("glm-5", markup);
    const call = result.content.find((content): content is ToolCall => content.type === "toolCall");

    expect(result.stopReason).toBe("toolUse");
    expect(call?.name).toBe("read");
    expect(call?.arguments).toEqual({ path: "src/index.ts" });
    expect(result.content.some((content) => content.type === "text" && content.text.includes("<tool_call>"))).toBe(false);
  });

  it("repairs JSON embedded in an already-structured Factory tool name", async () => {
    const inner = new AssistantMessageEventStream();
    const normalized = normalizeFactoryToolCallStream(inner, [READ_TOOL], false);
    const call: ToolCall = {
      type: "toolCall",
      id: "call_factory_1",
      name: '{"name":"read","arguments":"{\\"path\\":\\"src/router.ts\\"}"}',
      arguments: {},
    };
    const message = assistantMessage("glm-5", [call]);

    inner.push({ type: "start", partial: message });
    inner.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    inner.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
    inner.push({ type: "done", reason: "toolUse", message: { ...message, stopReason: "toolUse" } });

    const result = await normalized.result();
    const repaired = result.content[0] as ToolCall;
    expect(repaired.name).toBe("read");
    expect(repaired.arguments).toEqual({ path: "src/router.ts" });
  });

  it("heals Kimi section and DeepSeek DSML calls", () => {
    const kimi = new StreamMarkupHealing({ pattern: "kimi" });
    const kimiMarkup = [
      "<|tool_calls_section_begin|><|tool_call_begin|>functions.read:0",
      '<|tool_call_argument_begin|>{"path":"a.ts"}<|tool_call_end|>',
      "<|tool_calls_section_end|>",
    ].join("");
    const kimiCall = kimi.feedEvents(kimiMarkup).find((event) => event.type === "toolCall");

    const deepseek = new StreamMarkupHealing({ pattern: "dsml" });
    const deepseekMarkup = [
      '<|DSML|tool_calls><|DSML|invoke name="read">',
      '<|DSML|parameter name="path">b.ts</|DSML|parameter>',
      "</|DSML|invoke></|DSML|tool_calls>",
    ].join("");
    const deepseekCall = deepseek.feedEvents(deepseekMarkup).find((event) => event.type === "toolCall");

    expect(kimiCall?.type === "toolCall" ? kimiCall.call.name : undefined).toBe("read");
    expect(kimiCall?.type === "toolCall" ? JSON.parse(kimiCall.call.arguments) : undefined).toEqual({ path: "a.ts" });
    expect(deepseekCall?.type === "toolCall" ? deepseekCall.call.name : undefined).toBe("read");
    expect(deepseekCall?.type === "toolCall" ? JSON.parse(deepseekCall.call.arguments) : undefined).toEqual({
      path: "b.ts",
    });
  });
});
