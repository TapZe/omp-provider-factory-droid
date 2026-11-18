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
