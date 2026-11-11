import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@supaterm/client-runtime/model-traits";
import { ProviderInstanceId, type ProviderOptionDescriptor } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyProviderOptionSelection,
  resolveProviderOptionDescriptors,
  withImplicitFastModeSelection,
} from "../../lib/providerOptions";
import { reasoningSliderOptions, selectableChoices } from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("fast mode switch", () => {
  // regression: #29729 Cursor reports Fast on by default, but its picker shows an unset fastMode as off
  it("shows an unset fast mode as off, saves it as off and turns it on when toggled", () => {
    const capabilities = {
      optionDescriptors: [
        { id: "fastMode", label: "Fast", type: "boolean", currentValue: true } as const,
      ],
    };
    const selection = { instanceId: ProviderInstanceId.make("cursor"), model: "composer-2.5" };
    const descriptors = resolveProviderOptionDescriptors({ capabilities, selections: undefined });
    const shown = descriptors.find((descriptor) => descriptor.id === "fastMode")?.currentValue;

    expect({
      shown,
      saved: withImplicitFastModeSelection(selection, [
        { instanceId: selection.instanceId, models: [{ slug: selection.model, capabilities }] },
      ]).options,
      afterToggle: applyProviderOptionSelection(descriptors, { id: "fastMode", value: !shown }),
    }).toEqual({
      shown: false,
      saved: [{ id: "fastMode", value: false }],
      afterToggle: [{ id: "fastMode", value: true }],
    });
  });
});

describe("selectableChoices", () => {
  it("leaves out prompt-injected choices and keeps workflow choices in declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
      "ultracode",
    ]);
  });
});

describe("reasoningSliderOptions", () => {
  it("positions the thumb among selectable levels after hidden choices are removed", () => {
    const descriptor = {
      ...effortDescriptor,
      options: [
        effortDescriptor.options[3]!,
        effortDescriptor.options[0]!,
        effortDescriptor.options[4]!,
        effortDescriptor.options[1]!,
        effortDescriptor.options[2]!,
      ],
    };
    expect(reasoningSliderOptions(descriptor, "high")).toEqual({
      choices: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      selectedIndex: 2,
    });
  });

  it.each(["ultrathink", "ultracode", "unknown", undefined])(
    "preserves the choice picker when the current level is %s",
    (currentValue) => {
      expect(reasoningSliderOptions(effortDescriptor, currentValue)).toBeNull();
    },
  );

  it("supports a model with one fixed reasoning level", () => {
    expect(
      reasoningSliderOptions(
        { ...effortDescriptor, options: [{ id: "high", label: "High" }] },
        "high",
      ),
    ).toEqual({ choices: [{ id: "high", label: "High" }], selectedIndex: 0 });
  });

  it("does not create stops for a model with no selectable levels", () => {
    expect(reasoningSliderOptions({ ...effortDescriptor, options: [] }, "high")).toBeNull();
  });
});

describe("prompt-controlled reasoning", () => {
  it("removes the prefix when choosing a regular effort and saves Ultracode as an option", () => {
    const descriptors = [effortDescriptor];
    const prompt = "Ultrathink:\nsolve it";
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, prompt), descriptors },
        effortDescriptor,
        prompt,
        "ultracode",
      ),
    ).toEqual({ prompt: "solve it", modelOptions: [{ id: "effort", value: "ultracode" }] });
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, prompt), descriptors },
        effortDescriptor,
        prompt,
        "low",
      ),
    ).toEqual({ prompt: "solve it", modelOptions: [{ id: "effort", value: "low" }] });
  });

  it("keeps body-controlled Ultrathink locked", () => {
    const descriptors = [effortDescriptor];
    const prompt = "please ultrathink about this";
    const selected = { ...getPromptControlledTraits(descriptors, prompt), descriptors };
    expect(selected.ultrathinkInBodyText).toBe(true);
    expect(getTraitSelectChange(selected, effortDescriptor, prompt, "low")).toBeNull();
  });
});
