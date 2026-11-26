import type { ServerConfig } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentIconPickerLock } from "./EnvironmentIconPicker";

const config = { environment: { capabilities: {} } } as unknown as ServerConfig;

describe("resolveEnvironmentIconPickerLock", () => {
  it("waits for a settings grant before allowing changes", () => {
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: config, operateAccess: "pending" }),
    ).toMatch(/cannot change/);
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: config, operateAccess: "granted" }),
    ).toBeNull();
  });

  it("names the organization whose policy locks the icon", () => {
    const managed = {
      ...config,
      managedPolicy: { organization: "Example Corp", lockedSettings: ["environmentIcon"] },
    };
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: managed, operateAccess: "granted" }),
    ).toBe("Managed by Example Corp.");
  });
});
