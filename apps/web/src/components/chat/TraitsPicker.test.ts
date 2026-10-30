import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ProviderOptionDescriptor } from "@supaterm/contracts";
import { getSpeedToggle } from "@supaterm/client-runtime/provider-speed-toggle";
import { buildTraitsTriggerLabel } from "@supaterm/client-runtime/model-traits";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  currentValue: string,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", options: [...options], currentValue };
}

function fastModeDescriptor(
  currentValue: boolean,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue };
}

function serviceTierDescriptor(
  currentValue: "default" | "priority" | "ultrafast" | "flex",
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue,
  };
}

const EFFORT = selectDescriptor(
  "reasoningEffort",
  [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  "high",
);
const CONTEXT_WINDOW = selectDescriptor(
  "contextWindow",
  [
    { id: "200k", label: "200k" },
    { id: "1m", label: "1M" },
  ],
  "1m",
);

const CODEX = ProviderDriverKind.make("codex");

function label(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  ultrathinkPromptControlled = false,
) {
  return buildTraitsTriggerLabel({
    descriptors,
    speedToggle: getSpeedToggle(CODEX, descriptors),
    primarySelectDescriptorId: "reasoningEffort",
    ultrathinkPromptControlled,
  });
}

describe("buildTraitsTriggerLabel", () => {
  it("leaves speed to the toggle", () => {
    for (const fastMode of [false, true]) {
      expect(label([EFFORT, fastModeDescriptor(fastMode), CONTEXT_WINDOW])).toEqual({
        label: "High · 1M",
        speedLabel: fastMode ? "Fast" : null,
        otherLabels: ["1M"],
      });
    }
    const unsetFastMode: ProviderOptionDescriptor = {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    };
    expect(label([EFFORT, unsetFastMode])).toEqual({
      label: "High",
      speedLabel: null,
      otherLabels: [],
    });
    for (const tier of ["default", "priority", "ultrafast"] as const) {
      expect(label([EFFORT, serviceTierDescriptor(tier)])).toEqual({
        label: "High",
        speedLabel: tier === "default" ? null : tier === "priority" ? "Fast" : "Ultrafast",
        otherLabels: [],
      });
    }
  });

  it("keeps other Codex service tiers in the label", () => {
    expect(label([EFFORT, serviceTierDescriptor("flex")])).toEqual({
      label: "High · Flex",
      speedLabel: null,
      otherLabels: ["Flex"],
    });
  });

  it("keeps Standard as text for models without speed tiers", () => {
    const descriptor = serviceTierDescriptor("default");
    const nonSpeedDescriptor = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id === "default" || id === "flex"),
    };
    expect(label([EFFORT, nonSpeedDescriptor])).toEqual({
      label: "High · Standard",
      speedLabel: null,
      otherLabels: ["Standard"],
    });
    expect(label([nonSpeedDescriptor])).toEqual({
      label: "Standard",
      speedLabel: null,
      otherLabels: ["Standard"],
    });
  });

  it("keeps the Codex service tier readable when it is the only trait", () => {
    expect(label([serviceTierDescriptor("default")])).toEqual({
      label: "Standard",
      speedLabel: null,
      otherLabels: [],
    });
    expect(label([serviceTierDescriptor("priority")])).toEqual({
      label: "Fast",
      speedLabel: "Fast",
      otherLabels: [],
    });
    expect(label([serviceTierDescriptor("ultrafast")])).toEqual({
      label: "Ultrafast",
      speedLabel: "Ultrafast",
      otherLabels: [],
    });
  });

  it("keeps non-fastMode booleans as text labels", () => {
    const thinking: Extract<ProviderOptionDescriptor, { type: "boolean" }> = {
      id: "thinking",
      label: "Thinking",
      type: "boolean",
      currentValue: true,
    };
    expect(label([EFFORT, thinking])).toEqual({
      label: "High · Thinking On",
      speedLabel: null,
      otherLabels: ["Thinking On"],
    });
    expect(label([EFFORT, { ...thinking, currentValue: false }])).toEqual({
      label: "High · Thinking Off",
      speedLabel: null,
      otherLabels: ["Thinking Off"],
    });
  });

  it("stays blank when descriptors resolve to no label and there is no speed tier", () => {
    const unresolved: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: "effort",
      label: "effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    };
    expect(label([unresolved])).toEqual({ label: "", speedLabel: null, otherLabels: [] });
    expect(label([fastModeDescriptor(true)])).toEqual({
      label: "",
      speedLabel: "Fast",
      otherLabels: [],
    });
  });

  it("still renders the prompt-controlled ultrathink label", () => {
    expect(label([EFFORT, serviceTierDescriptor("priority")], true)).toEqual({
      label: "Ultrathink",
      speedLabel: "Fast",
      otherLabels: [],
    });
  });
});
