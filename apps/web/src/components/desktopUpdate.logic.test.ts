import { describe, expect, it } from "vite-plus/test";
import type { DesktopUpdateState } from "@supaterm/contracts";

import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
  resolveDesktopUpdateButtonAction,
  resolveDesktopUpdateIndicator,
} from "./desktopUpdate.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("desktop update button state", () => {
  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("keeps install action available after an install error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      downloadedVersion: "1.1.0",
      availableVersion: "1.1.0",
      message: "shutdown timeout",
      errorContext: "install",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("install");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("prefers a newly available release over a stale downloaded version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
      downloadedVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("hides the install action while checking for a newer release", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "checking",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });
});

describe("desktop update UI helpers", () => {
  it.each([
    "owner/repo/extra",
    "owner#notes/repo",
    "owner/repo#notes",
    "owner?tab=notes/repo",
    "owner/repo?tab=notes",
  ])("falls back to upstream for an invalid configured repository: %s", (repository) => {
    expect(getDesktopUpdateReleaseHistoryUrl(repository)).toBe(
      "https://github.com/supabitapp/supaterm/releases",
    );
    expect(getDesktopUpdateReleaseUrl("1.2.3", repository)).toBe(
      "https://github.com/supabitapp/supaterm/releases/tag/v1.2.3",
    );
  });
});

describe("canCheckForUpdate", () => {
  it("returns true once an update has been downloaded so newer releases can be found", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(true);
  });

  it("returns true on error so the user can retry", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "error",
        errorContext: "check",
        message: "network",
      }),
    ).toBe(true);
  });
});

describe("resolveDesktopUpdateIndicator", () => {
  it("hides the indicator when there is no update to act on", () => {
    expect(resolveDesktopUpdateIndicator(null)).toBeNull();
    expect(resolveDesktopUpdateIndicator({ ...baseState, status: "idle" })).toBeNull();
    expect(resolveDesktopUpdateIndicator({ ...baseState, status: "up-to-date" })).toBeNull();
    expect(resolveDesktopUpdateIndicator({ ...baseState, status: "checking" })).toBeNull();
    expect(
      resolveDesktopUpdateIndicator({ ...baseState, status: "error", errorContext: "check" }),
    ).toBeNull();
  });

  it("follows an update from available to downloaded", () => {
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "available",
        availableVersion: "1.1.0",
      }),
    ).toBe("available");
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "downloading",
        availableVersion: "1.1.0",
        downloadPercent: 40,
      }),
    ).toBe("downloading");
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe("downloaded");
  });

  it("keeps a found update visible while a background check runs", () => {
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "checking",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe("downloaded");
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "checking",
        availableVersion: "1.1.0",
      }),
    ).toBe("available");
  });

  it("offers a retry after a failed download or install", () => {
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "error",
        errorContext: "download",
        availableVersion: "1.1.0",
      }),
    ).toBe("available");
    expect(
      resolveDesktopUpdateIndicator({
        ...baseState,
        status: "error",
        errorContext: "install",
        downloadedVersion: "1.1.0",
      }),
    ).toBe("downloaded");
  });
});
