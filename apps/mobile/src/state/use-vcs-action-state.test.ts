import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  notificationAsync: vi.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: vi.fn(() => Promise.resolve()),
  platform: { OS: "ios", Version: 0 },
}));

vi.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success", Error: "error" },
  AndroidHaptics: { Confirm: "confirm", Reject: "reject" },
  notificationAsync: mocks.notificationAsync,
  performAndroidHapticsAsync: mocks.performAndroidHapticsAsync,
}));

vi.mock("react-native", () => ({ Platform: mocks.platform }));

vi.mock("./vcs", () => ({ vcsActionManager: {} }));

import { dismissGitActionResult, showGitActionResult } from "./use-vcs-action-state";

function setup(platform: { OS: string; Version: number }) {
  Object.assign(mocks.platform, platform);
  mocks.notificationAsync.mockClear();
  mocks.performAndroidHapticsAsync.mockClear();
}

describe("showGitActionResult", () => {
  it.each([
    { OS: "ios", Version: 0, notification: [["success"], ["error"]], android: [] },
    { OS: "android", Version: 29, notification: [["success"], ["error"]], android: [] },
    { OS: "android", Version: 30, notification: [], android: [["confirm"], ["reject"]] },
  ])(
    "buzzes once per reported result on $OS $Version",
    ({ OS, Version, notification, android }) => {
      setup({ OS, Version });
      showGitActionResult({ type: "success", title: "Pushed" });
      showGitActionResult({ type: "error", title: "Git action failed", description: "rejected" });
      dismissGitActionResult();

      expect(mocks.notificationAsync.mock.calls).toEqual(notification);
      expect(mocks.performAndroidHapticsAsync.mock.calls).toEqual(android);
    },
  );
});
