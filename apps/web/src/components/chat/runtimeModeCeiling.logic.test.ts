import type { ManagedPolicySummary, RuntimeMode } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { capRuntimeModeOptions } from "./runtimeModeCeiling.logic";

const ALL_MODES: ReadonlyArray<{ mode: RuntimeMode }> = [
  { mode: "approval-required" },
  { mode: "auto-accept-edits" },
  { mode: "auto" },
  { mode: "full-access" },
];
const capped: ManagedPolicySummary = {
  organization: "Example Corp",
  lockedSettings: [],
  limits: { maxRuntimeMode: "auto-accept-edits" },
};
const CEILING_MESSAGE = "Example Corp limits threads to Auto-accept edits.";

describe("capRuntimeModeOptions", () => {
  it("disables modes above the ceiling with the policy's reason", () => {
    const { options, denial } = capRuntimeModeOptions(capped, ALL_MODES, "approval-required");
    expect(options.map((option) => [option.mode, option.disabledReason])).toEqual([
      ["approval-required", undefined],
      ["auto-accept-edits", undefined],
      ["auto", CEILING_MESSAGE],
      ["full-access", CEILING_MESSAGE],
    ]);
    expect(denial).toBeUndefined();
  });

  it("refuses a thread above the ceiling and offers the broadest mode the provider has", () => {
    expect(capRuntimeModeOptions(capped, ALL_MODES, "full-access")).toMatchObject({
      denial: CEILING_MESSAGE,
      fallback: "auto-accept-edits",
    });
    const supervisedOrFull = [
      { mode: "approval-required" as const },
      { mode: "full-access" as const },
    ];
    expect(capRuntimeModeOptions(capped, supervisedOrFull, "full-access").fallback).toBe(
      "approval-required",
    );
  });

  it("leaves every mode open without a ceiling", () => {
    const unmanaged = capRuntimeModeOptions(undefined, ALL_MODES, "full-access");
    expect(unmanaged.options).toBe(ALL_MODES);
    expect(unmanaged.denial).toBeUndefined();
    const noCeiling = { ...capped, limits: {} };
    expect(capRuntimeModeOptions(noCeiling, ALL_MODES, "full-access").denial).toBeUndefined();
  });
});
