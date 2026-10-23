import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@supaterm/client-runtime/model-traits";
import type { ProviderOptionDescriptor } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  reasoningSliderOptions,
  runtimeModeChoicesForSupportedModes,
  selectableChoices,
} from "./thread-settings-options";

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

describe("selectableChoices", () => {
  it("includes prompt-injected and workflow choices in declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
      "ultrathink",
      "ultracode",
    ]);
  });
});

describe("runtimeModeChoicesForSupportedModes", () => {
  it("keeps controls usable when forward-compatible decoding removes every advertised mode", () => {
    expect(runtimeModeChoicesForSupportedModes([])).toHaveLength(4);
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
  it("adds Ultrathink to the prompt without persisting an injected option", () => {
    const descriptors = [effortDescriptor];
    const change = getTraitSelectChange(
      { ...getPromptControlledTraits(descriptors, "solve it"), descriptors },
      effortDescriptor,
      "solve it",
      "ultrathink",
    );
    expect(change).toEqual({ prompt: "Ultrathink:\nsolve it" });
    expect(
      getPromptControlledTraits(descriptors, change?.prompt ?? "").ultrathinkPromptControlled,
    ).toBe(true);
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, ""), descriptors },
        effortDescriptor,
        "",
        "ultrathink",
      ),
    ).toEqual({ prompt: "Ultrathink:\n" });
  });

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

  it("keeps body-controlled Ultrathink locked and preserves slash commands", () => {
    const descriptors = [effortDescriptor];
    const prompt = "please ultrathink about this";
    const selected = { ...getPromptControlledTraits(descriptors, prompt), descriptors };
    expect(selected.ultrathinkInBodyText).toBe(true);
    expect(getTraitSelectChange(selected, effortDescriptor, prompt, "low")).toBeNull();
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, "/review"), descriptors },
        effortDescriptor,
        "/review",
        "ultrathink",
      ),
    ).toEqual({ prompt: "/review" });
  });
});
