import type { ProviderOptionDescriptor } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getSpeedToggle, getSpeedToggleNextValue } from "./providerSpeedToggle.ts";

const EFFORT: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning",
  type: "select",
  options: [{ id: "high", label: "High" }],
  currentValue: "high",
};

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

describe("getSpeedToggle", () => {
  it("toggles boolean fast mode on and off", () => {
    expect(getSpeedToggle([EFFORT, fastModeDescriptor(false)])).toEqual({
      descriptorId: "fastMode",
      level: "off",
      onValue: true,
      offValue: false,
      coversDescriptor: true,
    });
    expect(getSpeedToggle([fastModeDescriptor(true)])?.level).toBe("fast");
  });

  it("toggles Codex between Standard and Fast and reports Ultrafast", () => {
    expect(getSpeedToggle([EFFORT, serviceTierDescriptor("default")])).toEqual({
      descriptorId: "serviceTier",
      level: "off",
      onValue: "priority",
      offValue: "default",
      ultrafastValue: "ultrafast",
      coversDescriptor: false,
    });
    expect(getSpeedToggle([serviceTierDescriptor("priority")])?.level).toBe("fast");
    expect(getSpeedToggle([serviceTierDescriptor("ultrafast")])?.level).toBe("ultrafast");
    expect(getSpeedToggle([serviceTierDescriptor("flex")])?.level).toBe("off");
  });

  it("covers the Codex tier when Standard and Fast are its only options", () => {
    const descriptor = serviceTierDescriptor("default");
    const standardAndFast = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id === "default" || id === "priority"),
    };
    expect(getSpeedToggle([standardAndFast])?.coversDescriptor).toBe(true);
  });

  it("turns on Ultrafast when the model has no Fast tier", () => {
    const descriptor = serviceTierDescriptor("default");
    const withoutFast = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id !== "priority"),
    };
    expect(getSpeedToggle([withoutFast])?.onValue).toBe("ultrafast");
  });

  it("turns Fast or Ultrafast off to Standard", () => {
    const fast = getSpeedToggle([serviceTierDescriptor("priority")]);
    const ultrafast = getSpeedToggle([serviceTierDescriptor("ultrafast")]);
    const off = getSpeedToggle([serviceTierDescriptor("default")]);
    expect(fast && getSpeedToggleNextValue(fast)).toBe("default");
    expect(ultrafast && getSpeedToggleNextValue(ultrafast)).toBe("default");
    expect(off && getSpeedToggleNextValue(off)).toBe("priority");
  });

  it.each(["default", "priority", "ultrafast", "flex"] as const)(
    "enables Ultrafast from %s when requested",
    (currentValue) => {
      const toggle = getSpeedToggle([serviceTierDescriptor(currentValue)]);
      expect(toggle && getSpeedToggleNextValue(toggle, true)).toBe("ultrafast");
    },
  );

  it.each(["default", "priority"] as const)(
    "keeps the normal toggle behavior from %s when Ultrafast is unavailable",
    (currentValue) => {
      const descriptor = serviceTierDescriptor(currentValue);
      const toggle = getSpeedToggle([
        { ...descriptor, options: descriptor.options.filter(({ id }) => id !== "ultrafast") },
      ]);
      expect(toggle?.ultrafastValue).toBeUndefined();
      expect(toggle && getSpeedToggleNextValue(toggle, true)).toBe(
        currentValue === "default" ? "priority" : "default",
      );
    },
  );

  it.each([false, true])("keeps boolean Fast mode toggling from %s", (currentValue) => {
    const toggle = getSpeedToggle([fastModeDescriptor(currentValue)]);
    expect(toggle?.ultrafastValue).toBeUndefined();
    expect(toggle && getSpeedToggleNextValue(toggle, true)).toBe(!currentValue);
  });

  it("selects the provider's Ultrafast tier ID", () => {
    const descriptor = serviceTierDescriptor("default");
    const toggle = getSpeedToggle([
      {
        ...descriptor,
        options: descriptor.options.map((option) =>
          option.label === "Ultrafast" ? { ...option, id: "ultra-priority" } : option,
        ),
      },
    ]);
    expect(toggle && getSpeedToggleNextValue(toggle, true)).toBe("ultra-priority");
  });

  it("has no toggle for service tiers without a speed tier", () => {
    const descriptor = serviceTierDescriptor("default");
    const standardAndFlex = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id === "default" || id === "flex"),
    };
    expect(getSpeedToggle([EFFORT, standardAndFlex])).toBeNull();
  });
});
