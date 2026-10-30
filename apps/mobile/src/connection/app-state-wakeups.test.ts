import { describe, expect, it } from "@effect/vitest";

import { mobileApplicationStateWakeup } from "./app-state-wakeups";

describe("mobileApplicationStateWakeup", () => {
  it("parks background connections and probes them on return", () => {
    expect(mobileApplicationStateWakeup("active", "background")).toBe("application-background");
    expect(mobileApplicationStateWakeup("background", "active")).toBe("application-resumed");
  });

  it("keeps connections during a temporary inactive state", () => {
    expect(mobileApplicationStateWakeup("active", "inactive")).toBeNull();
    expect(mobileApplicationStateWakeup("inactive", "active")).toBe("application-resumed");
  });

  it("marks only long background returns for route revalidation", () => {
    expect(mobileApplicationStateWakeup("background", "active", 9999)).toBe("application-resumed");
    expect(mobileApplicationStateWakeup("background", "active", 10000)).toBe(
      "application-active-long",
    );
  });

  it("ignores repeated app-state reports", () => {
    expect(mobileApplicationStateWakeup("active", "active")).toBeNull();
    expect(mobileApplicationStateWakeup("background", "background")).toBeNull();
  });
});
