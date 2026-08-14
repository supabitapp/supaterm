import { describe, expect, it } from "vite-plus/test";
import { githubOrigin } from "./src/lib/downloads";
import config from "./vite.config";

type ProxyEntry = {
  changeOrigin?: boolean;
  rewrite?: (path: string) => string;
  target?: string;
};

const proxy = (config.server?.proxy ?? {}) as Record<string, ProxyEntry>;

describe("vite config", () => {
  it("proxies latest downloads instead of falling back to the SPA shell", () => {
    const latestDownloadProxy = proxy["/download/latest/"];

    expect(latestDownloadProxy?.target).toBe(githubOrigin);
    expect(latestDownloadProxy?.changeOrigin).toBe(true);
    expect(latestDownloadProxy?.rewrite?.("/download/latest/supaterm.dmg?build=1")).toBe(
      "/supabitapp/supaterm/releases/latest/download/supaterm.dmg?build=1",
    );
  });

  it("proxies versioned downloads", () => {
    const versionedDownloadProxy = proxy["/download/v"];

    expect(versionedDownloadProxy?.target).toBe(githubOrigin);
    expect(versionedDownloadProxy?.changeOrigin).toBe(true);
    expect(versionedDownloadProxy?.rewrite?.("/download/v26.0.0/supaterm.dmg?build=1")).toBe(
      "/supabitapp/supaterm/releases/download/v26.0.0/supaterm.dmg?build=1",
    );
  });

  it("keeps direct changelog navigation on a real app route", () => {
    expect(proxy["/changelog"]).toBeUndefined();
  });
});
