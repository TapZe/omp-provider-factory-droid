import { describe, expect, it } from "bun:test";
import type { AssistantMessage, Context, ToolCall, ToolChoice } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { createFactoryToolAliases } from "./factory-tool-aliases";
import { normalizeFactoryToolCallStream } from "./tool-call-normalization";

const tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: { name: { type: "string" } } } };
function message(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant", api: "openai-responses", provider: "factory", model: "gpt-5.6-sol", content,
    stopReason: "toolUse", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}
function call(name = "read"): ToolCall {
  return { type: "toolCall", id: "call_1", name, arguments: { name: "read", text: "inspect_file" }, thoughtSignature: "opaque" };
}

describe("Factory tool alias boundary", () => {
  it("preserves native custom calls and metadata through both directions without editing arguments", () => {
    const originalCall = { ...call(), customWireName: "apply_patch" };
    const original = message([originalCall]);
    original.providerPayload = {
      type: "openaiResponsesHistory", provider: "factory", dt: true,
      items: [
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", arguments: '{"name":"read"}', extra: "read" },
        { type: "custom_tool_call", id: "custom_1", call_id: "custom_1", name: "edit", input: "literal edit", opaque: { name: "read" } },
        { type: "reasoning", id: "rs_1", encrypted_content: "read", name: "read" },
      ],
    };
    const context: Context = { messages: [original], tools: [tool, { ...tool, name: "edit" }] };
    const aliases = createFactoryToolAliases(context);
    const mapped = aliases.context.messages[0];
    expect(mapped.role).toBe("assistant");
    if (mapped.role !== "assistant" || mapped.providerPayload?.type !== "openaiResponsesHistory") throw new Error("Missing replay payload");
    expect(mapped.content[0]).toEqual({ ...originalCall, name: "inspect_file" });
    expect(mapped.content[0]).not.toBe(originalCall);
    expect(mapped.content[0].type === "toolCall" && mapped.content[0].arguments).toBe(originalCall.arguments);
    expect(mapped.providerPayload.items).toEqual([
      { ...original.providerPayload.items[0], name: "inspect_file" },
      { ...original.providerPayload.items[1], name: "edit_file" },
      original.providerPayload.items[2],
    ]);
    expect(aliases.fromMessage(mapped)).toEqual(original);
    expect(original.content[0]).toBe(originalCall);
    expect(original.providerPayload.items[0].name).toBe("read");
    expect(aliases.context.tools?.[0].parameters).toBe(tool.parameters);
  });

  it("translates deferred Anthropic tool changes without rewriting developer text", () => {
    const context: Context = {
      tools: [tool],
      messages: [{ role: "developer", content: "read and inspect_file", timestamp: 0,
        providerPayload: { type: "anthropicMessage", clearAt: "never", effort: "low", toolChanges: [{ type: "tool_addition", name: "read" }] } }],
    };
    const original = context.messages[0];
    if (original.role !== "developer") throw new Error("Missing developer fixture");
    expect(createFactoryToolAliases(context).context.messages[0]).toEqual({
      ...original,
      providerPayload: { type: "anthropicMessage", clearAt: "never", effort: "low", toolChanges: [{ type: "tool_addition", name: "inspect_file" }] },
    });
  });

  it("aliases custom wire names only when they match a known original and restores them", () => {
    const context: Context = { messages: [], tools: [{ ...tool, name: "patch", customWireName: "edit", customFormat: { syntax: "lark", definition: "start: /.+/" } }] };
    const aliases = createFactoryToolAliases(context);
    expect(aliases.context.tools?.[0]).toEqual({ ...tool, name: "patch", customWireName: "edit_file", customFormat: { syntax: "lark", definition: "start: /.+/" } });
    const customCall = { ...call("patch"), customWireName: "edit_file" };
    expect(aliases.fromToolCall(customCall)).toEqual({ ...customCall, customWireName: "edit" });
  });

  it("does not reinterpret prototype keys or other tools", () => {
    const context: Context = { messages: [], tools: [{ ...tool, name: "toString" }, { ...tool, name: "constructor" }, { ...tool, name: "inspect_file" }] };
    const aliases = createFactoryToolAliases(context);
    expect(aliases.context.tools).toEqual(context.tools);
    expect(aliases.fromToolCall(call("inspect_file")).name).toBe("inspect_file");
  });

  it("aliases history even when a tool is no longer offered", () => {
    const original = message([call()]);
    const aliases = createFactoryToolAliases({ messages: [original, { role: "toolResult", toolCallId: "call_1", toolName: "read", content: [{ type: "text", text: "read" }], isError: false, timestamp: 0 }] });
    expect(aliases.context.messages[0]).toMatchObject({ content: [{ name: "inspect_file" }] });
    expect(aliases.context.messages[1]).toMatchObject({ toolName: "inspect_file", content: [{ text: "read" }] });
    expect(aliases.fromToolCall(call("inspect_file")).name).toBe("read");
  });

  it.each(["auto", "none", "any", "required", { type: "computer" }] satisfies ToolChoice[])("preserves non-named tool choice %j", (choice) => {
    expect(createFactoryToolAliases({ messages: [], tools: [tool] }).toolChoice(choice)).toBe(choice);
  });

  it("rejects custom wire name collisions and collisions introduced by history", () => {
    expect(() => createFactoryToolAliases({ messages: [], tools: [tool, { ...tool, name: "patch", customWireName: "inspect_file" }] })).toThrow("collision");
    expect(() => createFactoryToolAliases({ messages: [message([call()])], tools: [{ ...tool, name: "inspect_file" }] })).toThrow("collision");
  });
});

describe("Factory alias stream normalization", () => {
  it("restores partials, completed and terminal calls while preserving raw argument deltas and provider-owned objects", async () => {
    const aliases = createFactoryToolAliases({ messages: [], tools: [tool] });
    const inner = new AssistantMessageEventStream();
    const normalized = normalizeFactoryToolCallStream(inner, aliases.context.tools, false, aliases);
    const wireCall = call("inspect_file");
    const wireMessage = message([wireCall]);
    const delta = '{"name":"inspect_file"}';
    inner.push({ type: "toolcall_start", contentIndex: 0, partial: wireMessage });
    inner.push({ type: "toolcall_delta", contentIndex: 0, delta, partial: wireMessage });
    inner.push({ type: "toolcall_end", contentIndex: 0, toolCall: wireCall, partial: wireMessage });
    inner.push({ type: "done", reason: "toolUse", message: wireMessage });
    const received = [];
    for await (const event of normalized) received.push(event);
    for (const event of received) {
      if (event.type === "error") throw new Error("Unexpected error");
      const partial = event.type === "done" ? event.message : event.partial;
      expect(partial.content[0]).toMatchObject({ name: "read", arguments: wireCall.arguments, thoughtSignature: "opaque" });
      if (event.type === "toolcall_end") expect(event.toolCall.name).toBe("read");
      if (event.type === "toolcall_delta") expect(event.delta).toBe(delta);
    }
    expect((await normalized.result()).content[0]).toMatchObject({ name: "read" });
    expect(wireCall.name).toBe("inspect_file");
    expect(wireMessage.content[0]).toBe(wireCall);
  });

  it("decodes aliases after embedded-JSON and Hermes healing", async () => {
    const aliases = createFactoryToolAliases({ messages: [], tools: [tool] });
    for (const markup of [false, true]) {
      const inner = new AssistantMessageEventStream();
      const normalized = normalizeFactoryToolCallStream(inner, aliases.context.tools, markup, aliases);
      const wire = markup
        ? message([{ type: "text", text: '<tool_call>{"name":"inspect_file","arguments":{"name":"read"}}</tool_call>' }])
        : message([{ ...call(), name: '{"name":"inspect_file","arguments":{"name":"read"}}' }]);
      inner.push({ type: "start", partial: message([]) });
      inner.push({ type: "done", reason: "toolUse", message: wire });
      expect((await normalized.result()).content).toContainEqual(expect.objectContaining({ type: "toolCall", name: "read", arguments: { name: "read" } }));
    }
  });

  it("normalizes terminal error calls without dropping the error classification", async () => {
    const aliases = createFactoryToolAliases({ messages: [], tools: [tool] });
    const inner = new AssistantMessageEventStream();
    const normalized = normalizeFactoryToolCallStream(inner, aliases.context.tools, false, aliases);
    const error = { ...message([call("inspect_file")]), stopReason: "error" as const, errorStatus: 403, errorMessage: "policy" };
    inner.push({ type: "error", reason: "error", error });
    const result = await normalized.result();
    expect(result).toMatchObject({ stopReason: "error", errorStatus: 403, errorMessage: "policy", content: [{ name: "read" }] });
    expect(error.content[0]).toMatchObject({ name: "inspect_file" });
  });
});

describe("Factory custom dispatch and native-payload ownership", () => {
  it("resolves a raw custom-tool wire name to the declared local tool", () => {
    const aliases = createFactoryToolAliases({ messages: [], tools: [{ ...tool, name: "patch", customWireName: "edit", customFormat: { syntax: "lark", definition: "start: /.+/" } }] });
    const incoming = { ...call("edit_file"), customWireName: "edit_file" };
    expect(aliases.fromToolCall(incoming)).toEqual({ ...incoming, name: "patch", customWireName: "edit" });
    expect(aliases.fromMessage(message([incoming])).content[0]).toEqual({ ...incoming, name: "patch", customWireName: "edit" });
  });

  it("rejects uncorrelated native payload names that collide with a local alias", () => {
    const native = message([]);
    native.providerPayload = { type: "openaiResponsesHistory", provider: "factory", items: [{ type: "function_call", id: "fc_2", call_id: "other_call", name: "inspect_file", arguments: "{}" }] };
    expect(() => createFactoryToolAliases({ messages: [native], tools: [tool] })).toThrow("collision");
  });

  it("accepts an already-aliased native item correlated with its canonical public call", () => {
    const native = message([call()]);
    native.providerPayload = { type: "openaiResponsesHistory", provider: "factory", items: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "inspect_file", arguments: "{}" }] };
    const aliases = createFactoryToolAliases({ messages: [native], tools: [tool] });
    expect(aliases.context.messages[0]).toMatchObject({ content: [{ name: "inspect_file" }], providerPayload: { items: [{ name: "inspect_file" }] } });
  });

  it("rejects two tools that share an effective custom-tool name", () => {
    const tools = [tool, { ...tool, name: "patch", customWireName: "read" }];
    expect(() => createFactoryToolAliases({ messages: [], tools })).toThrow("collision");
  });
});

describe("Factory cross-version opaque history", () => {
  it.each([
    { type: "anthropicCompaction", provider: "anthropic", content: "summary", signature: "signed", toolChanges: [{ type: "tool_removal", name: "read" }] },
    { type: "cursorHistory", wireRoute: "opaque-route", digest: "opaque-digest", records: ['{"name":"read"}'] },
    { type: "geminiNativeContent", digest: "opaque-digest", content: { role: "model", parts: [{ functionCall: { name: "read", args: {} }, thoughtSignature: "signature" }] } },
    { type: "antigravityCli", conversationId: "test", digest: "opaque-digest", checkpoint: { steps: 1, generations: 1, executions: 1 } },
  ])("preserves the runtime peer's opaque $type payload unchanged", (providerPayload) => {
    // Runtime peers can add payload variants beyond this package's dev types.
    const original = Object.assign(message([call()]), { providerPayload });
    const aliases = createFactoryToolAliases({ messages: [original], tools: [tool] });
    const outbound = aliases.context.messages[0];
    if (outbound.role !== "assistant") throw new Error("Missing assistant fixture");
    expect(outbound.content[0]).toMatchObject({ name: "inspect_file" });
    expect(Object.is(outbound.providerPayload, providerPayload)).toBe(true);
    expect(Object.is(aliases.fromMessage(outbound).providerPayload, providerPayload)).toBe(true);
    expect(original.content[0]).toMatchObject({ name: "read" });
  });
});
