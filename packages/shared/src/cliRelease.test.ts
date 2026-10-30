import { describe, expect, it } from "vite-plus/test";

import {
  acceptsTrackSwitchRelease,
  crossesReleaseTrack,
  desktopUpdateChannelOf,
  cliArchiveTarCommand,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  supaterm-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *supaterm-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("supaterm-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("supaterm-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });
});

describe("release track selection", () => {
  const stable = "1.2.3";
  const nightly = "1.2.4-nightly.20261029.1";
  const preview = "1.2.4-preview.20261029.1";
  it("distinguishes a track crossing from a preview", () => {
    expect(crossesReleaseTrack(stable, nightly)).toBe(true);
    expect(crossesReleaseTrack(nightly, stable)).toBe(true);
    expect(crossesReleaseTrack(preview, stable)).toBe(false);
    expect(crossesReleaseTrack(stable, stable)).toBe(false);
    expect(desktopUpdateChannelOf(nightly)).toBe("nightly");
    expect(desktopUpdateChannelOf(preview)).toBe("latest");
  });
  it("accepts only the checked release or a newer release on the same track", () => {
    expect(acceptsTrackSwitchRelease(nightly, "nightly", nightly)).toBe(true);
    expect(acceptsTrackSwitchRelease("1.2.4-nightly.20261029.2", "nightly", nightly)).toBe(true);
    expect(acceptsTrackSwitchRelease("1.2.4-nightly.20261028.9", "nightly", nightly)).toBe(false);
    expect(acceptsTrackSwitchRelease(preview, "nightly", nightly)).toBe(false);
    expect(acceptsTrackSwitchRelease("1.2.4", "latest", nightly)).toBe(true);
  });
});
