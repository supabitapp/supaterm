import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  selectEnvironmentAxis,
  selectProjectAxis,
  settingsScopeEnvironmentLabel,
} from "./settingsScopeAxis";

describe("settings scope environment labels", () => {
  it("names same-name relay machines by relay name instead of the relay host", () => {
    const relay = (environmentId: string, key: string) => ({
      environmentId: EnvironmentId.make(environmentId),
      label: "Development",
      displayUrl: `https://${key.repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`,
    });
    const environments = [relay("first", "11"), relay("second", "33")];
    expect(
      environments.map((environment) => settingsScopeEnvironmentLabel(environment, environments)),
    ).toEqual(["Development · Relay · cello-owl-wind", "Development · Relay · koala-otter-shore"]);
  });
});

describe("settings scope axes", () => {
  it("drops a checkout narrowing from older links when either axis changes", () => {
    const checkout = { project: "app", checkout: "app@first", machine: "first" };
    expect(selectEnvironmentAxis(checkout, "second")).toEqual({
      project: "app",
      machine: "second",
    });
    expect(selectProjectAxis(checkout, "app")).toEqual({ project: "app", machine: "first" });
  });
});
