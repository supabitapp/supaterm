import type { DesktopUpdateState } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { installLocalUpdate, shouldUseSidebarUpdateReleaseNotesPopover } from "./SidebarUpdatePill";

const nightlyState: DesktopUpdateState = {
  enabled: true,
  status: "available",
  channel: "nightly",
  currentVersion: "0.0.35",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "0.0.36-nightly.3",
  downloadedVersion: null,
  releaseNotes: [{ version: "0.0.36-nightly.3", items: ["Newest change"], totalItems: 1 }],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("sidebar update release notes popover", () => {
  it("uses the popover only for nightly release notes", () => {
    expect(shouldUseSidebarUpdateReleaseNotesPopover(nightlyState)).toBe(true);
    expect(shouldUseSidebarUpdateReleaseNotesPopover({ ...nightlyState, channel: "latest" })).toBe(
      false,
    );
    expect(shouldUseSidebarUpdateReleaseNotesPopover({ ...nightlyState, releaseNotes: [] })).toBe(
      false,
    );
  });
});

describe("local update installation", () => {
  it("installs only the downloaded version approved by the track switch", async () => {
    const approvedVersion = "26.10.29-nightly.2";
    const reportError = vi.fn();
    const bridge = {
      installUpdate: async (expectedVersion?: string) => ({
        accepted: expectedVersion === approvedVersion,
        completed: false,
        state: {
          ...nightlyState,
          status: "downloaded" as const,
          downloadedVersion: approvedVersion,
        },
      }),
    };
    expect(await installLocalUpdate(bridge, reportError, approvedVersion)).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });
});
