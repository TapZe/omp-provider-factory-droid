import { describe, expect, it } from "bun:test";
import type { AssistantMessage, Context, FetchImpl, ToolCall, ToolChoice } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Api } from "@oh-my-pi/pi-catalog/types";
import { FACTORY_MODELS } from "./catalog";
import { factoryStreamSimple } from "./router";
import { isRecord } from "./object-fields";

const pairs = [
  ["read", "inspect_file"],
  ["write", "write_file"],
  ["edit", "edit_file"],
  ["bash", "omp_bash"],
  ["glob", "omp_glob"],
  ["grep", "omp_grep"],
  ["task", "omp_task"],
  ["web_search", "omp_web_search"],
] as const;
const tools: NonNullable<Context["tools"]> = pairs.map(([name]) => ({
  name,
  description: `Use ${name}`,
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
}));
const credential = JSON.stringify({ token: "test-token", orgId: "test-org", apiEndpoint: "https://api.test.factory.ai" });
const protocols = [
  ["completions", "deepseek-v4.1-flash-1017"],
  ["responses", "gpt-5.6-sol"],
  ["anthropic", "claude-opus-5"],
  ["google", "gemini-3.8-flash"],
] as const;
type Protocol = typeof protocols[number][0];

function sse(events: Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `${typeof event.type === "string" ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function toolResponse(protocol: Protocol, name: string, args: Record<string, unknown>): Response {
  const argumentsJson = JSON.stringify(args);
  switch (protocol) {
    case "completions":
      return sse([
        { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "" } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentsJson } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]);
    case "responses": {
      const item = { type: "function_call", id: "fc_1", call_id: "call_1", name, arguments: argumentsJson, status: "completed" };
      return sse([
        { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
        { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: argumentsJson },
        { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: argumentsJson },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: "resp_1", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1 } } },
      ]);
    }
    case "anthropic":
      return sse([
        { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "echo", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name, input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argumentsJson } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]);
    case "google":
      return sse([{
        candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args }, thoughtSignature: "opaque-signature" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }]);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected wire object");
  return value;
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Expected wire array");
  return value.map(record);
}
function declarationNames(body: Record<string, unknown>, protocol: Protocol): unknown[] {
  const declared = records(body.tools);
  if (protocol === "google") return records(declared[0].functionDeclarations).map((tool) => tool.name);
  if (protocol === "completions") return declared.map((tool) => record(tool.function).name);
  return declared.map((tool) => tool.name);
}
function historyNames(body: Record<string, unknown>, protocol: Protocol): unknown[] {
  if (protocol === "responses") {
    return records(body.input).filter((item) => item.type === "function_call").map((item) => item.name);
  }
  if (protocol === "google") {
    return records(body.contents).flatMap((item) => records(item.parts))
      .filter((part) => part.functionCall || part.functionResponse)
      .map((part) => record(part.functionCall ?? part.functionResponse).name);
  }
  const messages = records(body.messages);
  if (protocol === "completions") {
    return messages.flatMap((message) => message.tool_calls ? records(message.tool_calls).map((call) => record(call.function).name) : []);
  }
  return messages.flatMap((message) => Array.isArray(message.content) ? records(message.content).filter((part) => part.type === "tool_use").map((part) => part.name) : []);
}

async function request(
  modelId: string,
  context: Context,
  fetchImpl: FetchImpl,
  toolChoice?: ToolChoice,
): Promise<AssistantMessage> {
  const model = FACTORY_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown fixture model ${modelId}`);
  const routedModel = buildModel<Api>({ ...model, api: "openai-completions", provider: "factory", baseUrl: "https://api.test.factory.ai" });
  const stream = factoryStreamSimple(routedModel, context, { apiKey: credential, fetch: fetchImpl, disableReasoning: true, toolChoice });
  return stream.result();
}

describe("Factory compatibility across all wire protocols", () => {
  for (const [protocol, modelId] of protocols) {
    it(`${protocol}: aliases declarations, restores calls, and replays a continuation without mutating history`, async () => {
      const args = { path: "read/write/edit/bash/inspect_file" };
      const bodies: Record<string, unknown>[] = [];
      const fetchImpl: FetchImpl = async (_input, init) => {
        bodies.push(record(JSON.parse(String(init?.body))));
        return toolResponse(protocol, "inspect_file", args);
      };
      const context: Context = {
        systemPrompt: ["You are omp's trusted coding assistant.\n\n# Rules\nPreserve read/write/edit/bash here."],
        messages: [{ role: "user", content: "Read the file", timestamp: 0 }],
        tools,
      };
      const first = await request(modelId, context, fetchImpl);
      expect(first.stopReason).toBe("toolUse");
      const call = first.content.find((part): part is ToolCall => part.type === "toolCall");
      expect(call?.name).toBe("read");
      expect(call?.arguments).toEqual(args);
      expect(declarationNames(bodies[0], protocol)).toEqual(pairs.map(([, alias]) => alias));
      expect(context.tools?.map((tool) => tool.name)).toEqual(pairs.map(([name]) => name));
      expect(context.systemPrompt?.[0]).toStartWith("You are omp's trusted coding assistant.");
      if (!call) throw new Error("Missing call");
      const before = { ...first, content: first.content.map((part) => ({ ...part })) };
      const second = await request(modelId, {
        ...context,
        messages: [...context.messages, first, { role: "toolResult", toolCallId: call.id, toolName: "read", content: [{ type: "text", text: "contents" }], isError: false, timestamp: 0 }],
      }, fetchImpl);
      expect(second.stopReason).toBe("toolUse");
      expect(historyNames(bodies[1], protocol)).toContain("inspect_file");
      expect(historyNames(bodies[1], protocol)).not.toContain("read");
      expect(first).toEqual(before);
      expect(tools.map((tool) => tool.name)).toEqual(pairs.map(([name]) => name));
    });
  }

  it.each(pairs)("completions restores %s from %s without modifying arguments", async (name, alias) => {
    const args = { path: "literal inspect_file write_file edit_file omp_bash" };
    const result = await request("deepseek-v4.1-flash-1017", { messages: [], tools }, async () => toolResponse("completions", alias, args));
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toContainEqual(expect.objectContaining({ type: "toolCall", name, arguments: args }));
  });

  it.each([
    { type: "function", name: "read" },
    { type: "function", function: { name: "read" } },
    { type: "tool", name: "read" },
  ] satisfies ToolChoice[])("preserves a caller's explicit forced choice on the wire: %j", async (choice) => {
    let body: Record<string, unknown> = {};
    const result = await request("deepseek-v4.1-flash-1017", { messages: [], tools }, async (_input, init) => {
      body = record(JSON.parse(String(init?.body)));
      return toolResponse("completions", "inspect_file", {});
    }, choice);
    expect(result.stopReason).toBe("toolUse");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "inspect_file" } });
  });

  it.each(pairs)("rejects a %s/%s namespace collision before any network call", async (_name, alias) => {
    let called = false;
    const context: Context = { messages: [], tools: [...tools, { ...tools[0], name: alias }] };
    const result = await request("deepseek-v4.1-flash-1017", context, async () => {
      called = true;
      return toolResponse("completions", "inspect_file", {});
    });
    expect(called).toBe(false);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("collision");
  });

  it("does not reinterpret a legitimate alias-named tool without the original tool", async () => {
    const context: Context = { messages: [], tools: [{ ...tools[0], name: "inspect_file" }] };
    const result = await request("deepseek-v4.1-flash-1017", context, async () => toolResponse("completions", "inspect_file", {}));
    expect(result.content).toContainEqual(expect.objectContaining({ type: "toolCall", name: "inspect_file" }));
  });
});
