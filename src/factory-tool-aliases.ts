import type { AssistantMessage, Context, Message, ProviderPayload, ToolCall, ToolChoice } from "@oh-my-pi/pi-ai";

const TOOL_ALIASES: Readonly<Record<string, string>> = {
  read: "inspect_file",
  write: "write_file",
  edit: "edit_file",
  bash: "tool_bash",
  glob: "tool_glob",
  grep: "tool_grep",
  task: "tool_task",
  web_search: "tool_web_search",
};

type NameMapper = (name: string) => string;

const toWireName: NameMapper = (name) => Object.hasOwn(TOOL_ALIASES, name) ? TOOL_ALIASES[name] : name;

function mapToolCall(call: ToolCall, mapName: NameMapper, mapCustomName: NameMapper = mapName): ToolCall {
  const name = mapName(call.name);
  const customWireName = call.customWireName === undefined ? undefined : mapCustomName(call.customWireName);
  if (name === call.name && customWireName === call.customWireName) return call;
  return { ...call, name, ...(customWireName === undefined ? {} : { customWireName }) };
}

function mapPayload(payload: ProviderPayload | undefined, mapName: NameMapper): ProviderPayload | undefined {
  if (!payload) return payload;
  if (payload.type === "anthropicMessage") {
    if (!payload.toolChanges) return payload;
    let changed = false;
    const toolChanges = payload.toolChanges.map((change) => {
      const name = mapName(change.name);
      if (name === change.name) return change;
      changed = true;
      return { ...change, name };
    });
    return changed ? { ...payload, toolChanges } : payload;
  }
  // Newer peers carry other providers' opaque, sometimes signed history here.
  // Only rewrite the two payload formats consumed by our selected serializers.
  if (payload.type !== "openaiResponsesHistory") return payload;
  let changed = false;
  const items = payload.items.map((item) => {
    // Native replay can bypass the public ToolCall array. Do not walk argument
    // objects or opaque provider metadata looking for coincidental name keys.
    if ((item.type !== "function_call" && item.type !== "custom_tool_call") || typeof item.name !== "string") return item;
    const name = mapName(item.name);
    if (name === item.name) return item;
    changed = true;
    return { ...item, name };
  });
  return changed ? { ...payload, items } : payload;
}

function mapMessage<T extends Message>(message: T, mapName: NameMapper, mapCall: (call: ToolCall) => ToolCall): T {
  if (message.role === "toolResult") {
    const toolName = mapName(message.toolName);
    return toolName === message.toolName ? message : { ...message, toolName };
  }
  const providerPayload = mapPayload(message.providerPayload, mapName);
  if (message.role !== "assistant") {
    return providerPayload === message.providerPayload ? message : { ...message, providerPayload };
  }
  let changed = providerPayload !== message.providerPayload;
  const content = message.content.map((part) => {
    if (part.type !== "toolCall") return part;
    const mapped = mapCall(part);
    changed ||= mapped !== part;
    return mapped;
  });
  return changed ? { ...message, content, providerPayload } : message;
}

function localToolNames(context: Context): Set<string> {
  const names = new Set<string>();
  for (const tool of context.tools ?? []) {
    names.add(tool.name);
    if (tool.customWireName) names.add(tool.customWireName);
  }
  for (const message of context.messages) {
    if (message.role === "toolResult") names.add(message.toolName);
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        names.add(part.name);
        if (part.customWireName) names.add(part.customWireName);
      }
      if (message.providerPayload?.type === "openaiResponsesHistory") {
        for (const item of message.providerPayload.items) {
          if ((item.type !== "function_call" && item.type !== "custom_tool_call") || typeof item.name !== "string") continue;
          const publicCall = message.content.find((part): part is ToolCall =>
            part.type === "toolCall" && part.id === item.call_id);
          const publicName = item.type === "custom_tool_call"
            ? publicCall?.customWireName ?? publicCall?.name
            : publicCall?.name;
          // Some peers retain wire names only in native replay. Trust that
          // correlation only when the call ID and expected wire name agree.
          if (publicName !== undefined && toWireName(publicName) === item.name) continue;
          names.add(item.name);
        }
      }
    }
    if (message.role !== "toolResult" && message.providerPayload?.type === "anthropicMessage") {
      for (const change of message.providerPayload.toolChanges ?? []) names.add(change.name);
    }
  }
  return names;
}

export interface FactoryToolAliases {
  context: Context;
  toolChoice: (choice: ToolChoice | undefined) => ToolChoice | undefined;
  fromToolCall: (call: ToolCall) => ToolCall;
  fromMessage: (message: AssistantMessage) => AssistantMessage;
}

export function createFactoryToolAliases(context: Context): FactoryToolAliases {
  const names = localToolNames(context);
  const reverse = new Map<string, string>();
  for (const [name, alias] of Object.entries(TOOL_ALIASES)) {
    if (!names.has(name)) continue;
    if (names.has(alias)) throw new Error(`factory: tool name collision between ${name} and ${alias}`);
    reverse.set(alias, name);
  }
  const fromWire: NameMapper = (name) => reverse.get(name) ?? name;
  const dispatchNames = new Map<string, string>();
  for (const tool of context.tools ?? []) {
    for (const localName of [tool.name, ...(tool.customWireName ? [tool.customWireName] : [])]) {
      const wireName = toWireName(localName);
      const owner = dispatchNames.get(wireName);
      if (owner !== undefined && owner !== tool.name) {
        throw new Error(`factory: tool name collision between ${owner} and ${tool.name}`);
      }
      dispatchNames.set(wireName, tool.name);
    }
  }
  const fromCall = (call: ToolCall): ToolCall => mapToolCall(
    call,
    (name) => dispatchNames.get(name) ?? fromWire(name),
    fromWire,
  );
  const tools = context.tools?.map((tool) => {
    const name = toWireName(tool.name);
    const customWireName = tool.customWireName === undefined ? undefined : toWireName(tool.customWireName);
    if (name === tool.name && customWireName === tool.customWireName) return tool;
    return { ...tool, name, ...(customWireName === undefined ? {} : { customWireName }) };
  });
  const messages = context.messages.map((message) => mapMessage(message, toWireName, (call) => mapToolCall(call, toWireName)));
  return {
    context: { ...context, tools, messages },
    toolChoice(choice) {
      if (!choice || typeof choice === "string" || choice.type === "computer") return choice;
      if (choice.type === "function" && "function" in choice) {
        const name = toWireName(choice.function.name);
        return name === choice.function.name ? choice : { ...choice, function: { ...choice.function, name } };
      }
      const name = toWireName(choice.name);
      return name === choice.name ? choice : { ...choice, name };
    },
    fromToolCall: fromCall,
    fromMessage: (message) => mapMessage(message, fromWire, fromCall),
  };
}
