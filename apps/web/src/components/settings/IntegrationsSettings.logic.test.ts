import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@supaterm/contracts";

import { clearBrowserProfileData, importFailureReason } from "./IntegrationsSettings";

const settles = () => vi.spyOn({ clear: async (..._args: Array<unknown>) => {} }, "clear");

const environmentId = "environment-a" as EnvironmentId;
const secondEnvironmentId = "environment-b" as EnvironmentId;

describe("clearBrowserProfileData", () => {
  it("does not report success without an environment or bridge", async () => {
    const bridge = {
      clearCookies: settles(),
      clearCache: settles(),
    };

    await expect(clearBrowserProfileData(bridge, [], "profile-a")).rejects.toThrow();
    await expect(clearBrowserProfileData(null, [environmentId], "profile-a")).rejects.toThrow();
    expect(bridge.clearCookies).not.toHaveBeenCalled();
    expect(bridge.clearCache).not.toHaveBeenCalled();
  });
});

describe("clearBrowserProfileData with server browsers", () => {
  it("clears server-hosted profiles without a desktop bridge", async () => {
    const clear = settles();
    await clearBrowserProfileData(null, [environmentId, secondEnvironmentId], "profile-a", {
      environmentIds: [secondEnvironmentId],
      clear,
    });
    expect(clear).toHaveBeenCalledExactlyOnceWith(secondEnvironmentId, "profile-a");
  });

  it("clears both copies and fails when the server copy fails", async () => {
    const bridge = {
      clearCookies: settles(),
      clearCache: settles(),
    };
    const failure = new Error("server failed");
    await expect(
      clearBrowserProfileData(bridge, [environmentId], "profile-a", {
        environmentIds: [environmentId],
        clear: vi.spyOn(
          { clear: async (..._args: Array<unknown>) => Promise.reject(failure) },
          "clear",
        ),
      }),
    ).rejects.toBe(failure);
    expect(bridge.clearCookies).toHaveBeenCalledWith(environmentId, "profile-a");
  });
});

const failure = (reason: string) => ({
  message: `Importing cookies from safari failed: ${reason}.`,
});

describe("importFailureReason", () => {
  it("recovers the reason token from the flattened message", () => {
    expect(importFailureReason(failure("needsFullDiskAccess"))).toBe("needsFullDiskAccess");
    expect(importFailureReason(failure("browserRunning"))).toBe("browserRunning");
    expect(importFailureReason(failure("readFailed"))).toBe("readFailed");
    expect(importFailureReason(failure("keychainUnavailable"))).toBe("keychainUnavailable");
    expect(importFailureReason(failure("profileNotSaved"))).toBe("profileNotSaved");
    expect(importFailureReason(failure("profileLimitReached"))).toBe("profileLimitReached");
  });
});
