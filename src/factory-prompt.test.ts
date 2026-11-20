import { describe, expect, it } from "bun:test";
import type { Context } from "@oh-my-pi/pi-ai";
import { FACTORY_DROID_SYSTEM_PROMPT } from "./constants";
import { prepareContextForFactory } from "./router";

const greeting = "You are omp's trusted coding assistant.\n\n";

describe("Factory prompt compatibility", () => {
  it("removes only the known initial greeting and preserves all subsequent instruction bytes", () => {
    const instructions = "# Engineering\nKeep safety rules.\n\nUser rules: keep read and write unchanged.\n";
    const context: Context = {
      systemPrompt: [greeting + instructions, "Project instructions\n", "Project instructions\n"],
      messages: [{ role: "user", content: "Do not edit instructions", timestamp: 0 }],
    };
    const prepared = prepareContextForFactory(context);
    expect(prepared.systemPrompt).toEqual([
      FACTORY_DROID_SYSTEM_PROMPT,
      instructions,
      "Project instructions\n",
      "Project instructions\n",
    ]);
    expect(context.systemPrompt?.[0]).toBe(greeting + instructions);
    expect(prepared.messages).toBe(context.messages);
    expect(prepareContextForFactory(prepared).systemPrompt).toEqual(prepared.systemPrompt);
  });

  it.each([
    "You are omp's trusted coding assistant.\n# Engineering\nKeep everything.",
    "You are omp's trusted coding assistant.\r\n\r\nKeep everything.",
    "Custom instructions\n\n" + greeting + "Keep everything.",
    "You are a different assistant.\n\nKeep everything.",
  ])("does not guess how to adapt an unfamiliar prompt: %s", (prompt) => {
    expect(prepareContextForFactory({ systemPrompt: [prompt], messages: [] }).systemPrompt).toEqual([
      FACTORY_DROID_SYSTEM_PROMPT,
      prompt,
    ]);
  });

  it("preserves an existing Droid block and omits an exhausted greeting-only block", () => {
    expect(prepareContextForFactory({
      systemPrompt: [FACTORY_DROID_SYSTEM_PROMPT, greeting, "Retain this rule."],
      messages: [],
    }).systemPrompt).toEqual([FACTORY_DROID_SYSTEM_PROMPT, "Retain this rule."]);
  });
});

describe("Factory prompt block boundaries", () => {
  it("does not strip a greeting quoted at the start of a later project block", () => {
    const main = greeting + "# Engineering\nKeep this instruction.";
    const later = greeting + "This is authored project text, not the main prompt.";
    const prepared = prepareContextForFactory({ messages: [], systemPrompt: [main, later] });
    expect(prepared.systemPrompt).toEqual([FACTORY_DROID_SYSTEM_PROMPT, "# Engineering\nKeep this instruction.", later]);
  });

  it("leaves a later greeting alone when the initial prompt is unfamiliar", () => {
    const later = greeting + "Project instruction.";
    expect(prepareContextForFactory({ messages: [], systemPrompt: ["Custom prompt.", later] }).systemPrompt)
      .toEqual([FACTORY_DROID_SYSTEM_PROMPT, "Custom prompt.", later]);
  });

  it("does not mistake a quoted Droid identity for the canonical prefix", () => {
    const quote = "Documented quote: You are Droid, an AI software engineering agent built by Factory.";
    expect(prepareContextForFactory({ messages: [], systemPrompt: [quote] }).systemPrompt)
      .toEqual([FACTORY_DROID_SYSTEM_PROMPT, quote]);
  });
});

describe("Factory subagent prompt compatibility", () => {
  const original = "You are operating on a piece of work assigned to you by the main agent.";
  const adapted = "You are working on a piece of work assigned to you by the main agent.";
  const coop = `\n⁂ Coop\n${original}\n`;
  const subagent = `⁂ Role\nKeep the assigned scope.\n${coop}\nKeep coordination rules.\n\n⁂ Completion\nReturn the result.\n`;

  it("adapts the generated cooperation line without mutating other instructions, tools, or messages", () => {
    const context: Context = {
      systemPrompt: [greeting + "Keep safety rules.", "Project instructions.", subagent],
      messages: [{ role: "user", content: original, timestamp: 0 }],
      tools: [{ name: "read", description: original, parameters: { type: "object", properties: {} } }],
    };
    const prepared = prepareContextForFactory(context);
    expect(prepared.systemPrompt).toEqual([
      FACTORY_DROID_SYSTEM_PROMPT,
      "Keep safety rules.",
      "Project instructions.",
      subagent.replace(coop, `\n⁂ Coop\n${adapted}\n`),
    ]);
    expect(context.systemPrompt).toEqual([greeting + "Keep safety rules.", "Project instructions.", subagent]);
    expect(prepared.messages).toBe(context.messages);
    expect(prepared.tools).toBe(context.tools);
    expect(prepareContextForFactory(prepared).systemPrompt).toEqual(prepared.systemPrompt);
  });

  it("recognizes a standalone child block and an existing Droid prefix", () => {
    expect(prepareContextForFactory({ systemPrompt: [FACTORY_DROID_SYSTEM_PROMPT, subagent], messages: [] }).systemPrompt)
      .toEqual([FACTORY_DROID_SYSTEM_PROMPT, subagent.replace(original, adapted)]);
  });

  it.each([
    original,
    coop,
    `Project quote:\n${subagent}`,
    `\`\`\`text\n${subagent}\`\`\``,
    subagent.replace("⁂ Role", "Custom role"),
    subagent.replace("⁂ Coop", "⁂ Cooperation"),
    subagent.replace("⁂ Completion", "Custom completion"),
    subagent.replace(original, original.replace("operating", "acting")),
    subagent.replaceAll("\n", "\r\n"),
  ])("preserves quoted text and unfamiliar prompt layouts: %s", (prompt) => {
    expect(prepareContextForFactory({ systemPrompt: [prompt], messages: [] }).systemPrompt)
      .toEqual([FACTORY_DROID_SYSTEM_PROMPT, prompt]);
  });

  it("leaves quoted cooperation text outside the generated section unchanged", () => {
    const prompt = `⁂ Role\nDocumented example:${coop}\n⁂ Context\nKeep this quote: ${original}\n${coop}\nKeep peer rules.\n\n⁂ Completion\nQuoted example:${coop}`;
    const expected = `⁂ Role\nDocumented example:${coop}\n⁂ Context\nKeep this quote: ${original}\n\n⁂ Coop\n${adapted}\n\nKeep peer rules.\n\n⁂ Completion\nQuoted example:${coop}`;
    const prepared = prepareContextForFactory({ systemPrompt: [prompt], messages: [] });
    expect(prepared.systemPrompt).toEqual([FACTORY_DROID_SYSTEM_PROMPT, expected]);
    expect(prepareContextForFactory(prepared).systemPrompt).toEqual(prepared.systemPrompt);
  });
});
