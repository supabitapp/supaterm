import { describe, expect, it } from "vite-plus/test";

import {
  isSidebarStageBackdropSupported,
  resolveEnvironmentIdentificationPillLabel,
  shouldShowSidebarStageBackdrop,
} from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("resolves production artwork for every supported channel", () => {
    expect(isSidebarStageBackdropSupported("Dev")).toBe(true);
    expect(isSidebarStageBackdropSupported("Nightly")).toBe(true);
    expect(isSidebarStageBackdropSupported("Latest")).toBe(true);
    expect(isSidebarStageBackdropSupported(null)).toBe(true);
    expect(isSidebarStageBackdropSupported("Preview")).toBe(false);
  });

  it.each(["light", "dark"] as const)(
    "applies production artwork rules under %s themes",
    (appearance) => {
      expect(shouldShowSidebarStageBackdrop("Nightly", appearance)).toBe(appearance === "dark");
      expect(shouldShowSidebarStageBackdrop("Dev", appearance)).toBe(appearance === "dark");
    },
  );

  it("shows the production artwork only under dark themes", () => {
    expect(shouldShowSidebarStageBackdrop(null, "dark")).toBe(true);
    expect(shouldShowSidebarStageBackdrop("Latest", "dark")).toBe(true);
    expect(shouldShowSidebarStageBackdrop(null, "light")).toBe(false);
    expect(shouldShowSidebarStageBackdrop("Latest", "light")).toBe(false);
  });

  it.each(["light", "dark"] as const)(
    "keeps unsupported stage labels hidden under %s themes",
    (appearance) => {
      expect(shouldShowSidebarStageBackdrop("Preview", appearance)).toBe(false);
    },
  );

  it("resolves supported environment pill labels", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Dev")).toBe("Dev");
    expect(resolveEnvironmentIdentificationPillLabel("nightly")).toBe("Nightly");
    expect(resolveEnvironmentIdentificationPillLabel("Latest")).toBeNull();
    expect(resolveEnvironmentIdentificationPillLabel(null)).toBeNull();
  });
});
