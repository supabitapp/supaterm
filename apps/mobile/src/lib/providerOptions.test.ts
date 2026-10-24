import { describe, expect, it } from "vite-plus/test";

import type { ModelCapabilities } from "@supaterm/contracts";

import {
  applyProviderOptionSelection,
  getReasoningOptionDescriptor,
  resolveProviderOptionDescriptors,
} from "./providerOptions";

const CODEX_CAPABILITIES = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      currentValue: "default",
    },
  ],
} as const satisfies ModelCapabilities;

describe("mobile provider options", () => {
  it.each(["reasoningEffort", "effort", "reasoning", "variant", "thinking"])(
    "finds the %s reasoning option without selecting other model settings",
    (id) => {
      const reasoning = { ...CODEX_CAPABILITIES.optionDescriptors[0], id };
      const descriptors = [CODEX_CAPABILITIES.optionDescriptors[1], reasoning];

      expect(getReasoningOptionDescriptor(descriptors)).toBe(reasoning);
      expect(applyProviderOptionSelection(descriptors, { id, value: "high" })).toEqual([
        { id: "serviceTier", value: "default" },
        { id, value: "high" },
      ]);
    },
  );

  it("prefers effort over a thinking toggle and preserves the toggle when changing effort", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: [
          { id: "thinking", label: "Thinking", type: "boolean", currentValue: true },
          ...CODEX_CAPABILITIES.optionDescriptors,
        ],
      },
      selections: [{ id: "serviceTier", value: "priority" }],
    });

    expect(getReasoningOptionDescriptor(descriptors)?.id).toBe("reasoningEffort");
    expect(
      applyProviderOptionSelection(descriptors, { id: "reasoningEffort", value: "high" }),
    ).toEqual([
      { id: "thinking", value: true },
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ]);
  });

  it("supports a thinking toggle and hides reasoning for models without it", () => {
    const thinking = { id: "thinking", label: "Thinking", type: "boolean" as const };
    expect(getReasoningOptionDescriptor([thinking])).toBe(thinking);
    expect(getReasoningOptionDescriptor([CODEX_CAPABILITIES.optionDescriptors[1]])).toBeUndefined();
    expect(getReasoningOptionDescriptor([])).toBeUndefined();
  });
});
