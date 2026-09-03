import { describe, expect, it } from "vite-plus/test";
import { buildDownloadTargetUrl, downloadHref } from "./downloads";

describe("downloads", () => {
  it("points the site download CTA at the latest dmg route", () => {
    expect(downloadHref).toBe("/download/latest/supaterm.dmg");
  });

  it("builds the latest release target URL", () => {
    const targetUrl = buildDownloadTargetUrl(
      new URL("https://supaterm.com/download/latest/supaterm.dmg?build=1"),
    );

    expect(targetUrl?.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/latest/download/supaterm.dmg",
    );
  });

  it("keeps tip binaries on the tip release", () => {
    const targetUrl = buildDownloadTargetUrl(
      new URL("https://supaterm.com/download/tip/supaterm.dmg?build=1"),
    );

    expect(targetUrl?.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/download/tip/supaterm.dmg",
    );
  });

  it("builds versioned release target URLs", () => {
    const targetUrl = buildDownloadTargetUrl(
      new URL("https://supaterm.com/download/v26.0.0/supaterm.dmg?build=1"),
    );

    expect(targetUrl?.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/download/v26.0.0/supaterm.dmg",
    );
  });

  it("merges the tip appcast through the latest release", () => {
    const targetUrl = buildDownloadTargetUrl(
      new URL("https://supaterm.com/download/tip/appcast.xml?build=1"),
    );

    expect(targetUrl?.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/latest/download/appcast.xml",
    );
  });

  it("returns null when the asset name is missing", () => {
    const targetUrl = buildDownloadTargetUrl(new URL("https://supaterm.com/download/latest/"));

    expect(targetUrl).toBeNull();
  });

  it("returns null when a versioned asset name is missing", () => {
    const targetUrl = buildDownloadTargetUrl(new URL("https://supaterm.com/download/v26.0.0/"));

    expect(targetUrl).toBeNull();
  });
});
