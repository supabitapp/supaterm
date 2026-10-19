import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderOptionDescriptor,
} from "@supaterm/contracts";
import { getSpeedToggle } from "@supaterm/client-runtime/provider-speed-toggle";
import { buildTraitsTriggerLabel, buildUnavailableModelOptionDescriptors } from "./TraitsPicker";

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
      expect(label([EFFORT, fastModeDescriptor(fastMode), CONTEXT_WINDOW])).toBe("High · 1M");
    }
    const unsetFastMode: ProviderOptionDescriptor = {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    };
    expect(label([EFFORT, unsetFastMode])).toBe("High");
    for (const tier of ["default", "priority", "ultrafast"] as const) {
      expect(label([EFFORT, serviceTierDescriptor(tier)])).toBe("High");
    }
  });

  it("keeps other Codex service tiers in the label", () => {
    expect(label([EFFORT, serviceTierDescriptor("flex")])).toBe("High · Flex");
  });

  it("keeps Standard as text for models without speed tiers", () => {
    const descriptor = serviceTierDescriptor("default");
    const nonSpeedDescriptor = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id === "default" || id === "flex"),
    };
    expect(label([EFFORT, nonSpeedDescriptor])).toBe("High · Standard");
    expect(label([nonSpeedDescriptor])).toBe("Standard");
  });

  it("keeps the Codex service tier readable when it is the only trait", () => {
    expect(label([serviceTierDescriptor("default")])).toBe("Standard");
    expect(label([serviceTierDescriptor("priority")])).toBe("Fast");
    expect(label([serviceTierDescriptor("ultrafast")])).toBe("Ultrafast");
  });

  it("keeps non-fastMode booleans as text labels", () => {
    const thinking: Extract<ProviderOptionDescriptor, { type: "boolean" }> = {
      id: "thinking",
      label: "Thinking",
      type: "boolean",
      currentValue: true,
    };
    expect(label([EFFORT, thinking])).toBe("High · Thinking On");
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
    expect(label([unresolved])).toBe("");
    expect(label([fastModeDescriptor(true)])).toBe("");
  });

  it("still renders the prompt-controlled ultrathink label", () => {
    expect(label([EFFORT, serviceTierDescriptor("priority")], true)).toBe("Ultrathink");
  });
});

describe("buildUnavailableModelOptionDescriptors", () => {
  it("shows only saved values without inventing alternatives", () => {
    expect(
      buildUnavailableModelOptionDescriptors([
        { id: "variant", value: "max" },
        { id: "agent", value: "build" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([
      {
        id: "variant",
        label: "Reasoning",
        type: "select",
        options: [{ id: "max", label: "max" }],
        currentValue: "max",
      },
      {
        id: "agent",
        label: "Agent",
        type: "select",
        options: [{ id: "build", label: "build" }],
        currentValue: "build",
      },
      {
        id: "fastMode",
        label: "Fast Mode",
        type: "boolean",
        currentValue: true,
      },
    ]);
  });
});

it("shows Unknown until a matching provider report provides Default", () => {
  const selection = {
    instanceId: ProviderInstanceId.make("opencode"),
    model: "ling",
    options: [],
  };
  const input = {
    speedToggle: null,
    descriptors: [
      selectDescriptor(
        "variant",
        [
          { id: "none", label: "None" },
          { id: "thinking", label: "Thinking" },
        ],
        "",
      ),
    ],
    primarySelectDescriptorId: "variant",
    ultrathinkPromptControlled: false,
    modelSelection: selection,
  };
  expect(buildTraitsTriggerLabel(input)).toBe("Unknown");
  expect(
    buildTraitsTriggerLabel({
      ...input,
      reportedModelSelection: { ...selection, options: [{ id: "variant", value: "default" }] },
    }),
  ).toBe("Default");
});
