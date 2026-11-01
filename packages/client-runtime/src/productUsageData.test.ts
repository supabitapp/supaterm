import { describe, expect, it } from "vite-plus/test";

import { resolveProductUsageDataControl } from "./productUsageData.ts";

const target = (label: string, telemetrySetting: boolean, forced?: boolean) => ({
  label,
  serverConfig: {
    environment: { capabilities: { telemetrySetting } },
    observability: forced === undefined ? {} : { telemetryEnabledByEnvironment: forced },
  },
});

describe("resolveProductUsageDataControl", () => {
  it.each([
    { name: "a server that ignores the setting", targets: [target("A", true), target("B", false)] },
    { name: "a target without a server config", targets: [{ label: "A", serverConfig: null }] },
    { name: "no connected environment", targets: [] },
  ])("hides the switch for $name", ({ targets }) => {
    expect(resolveProductUsageDataControl(targets)).toBeNull();
  });

  it.each([
    { forced: [undefined, undefined], value: undefined },
    { forced: [false, undefined], value: undefined },
    { forced: [false, false], value: false },
    { forced: [true, true], value: true },
    { forced: [true, false], value: null },
  ])("forces $value when the variable is $forced", ({ forced, value }) => {
    const control = resolveProductUsageDataControl(
      forced.map((variable, index) => target(`Env ${index}`, true, variable)),
    );
    expect(control?.forced).toEqual(value === undefined ? null : { value });
  });

  it("names each environment whose variable decides", () => {
    expect(
      resolveProductUsageDataControl([target("Laptop", true, false), target("Server", true)])
        ?.status,
    ).toBe("Set by SUPATERM_TELEMETRY_ENABLED=false on Laptop.");
  });
});
