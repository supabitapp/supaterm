import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "./index";

type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("worker", () => {
  it("proxies tip release assets", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response("appcast", {
        headers: { etag: '"abc"' },
      }),
    );
    const assetsFetch = vi.fn().mockResolvedValue(new Response("asset"));

    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/tip/appcast.xml?build=1"),
      { ASSETS: { fetch: assetsFetch } as AssetBinding },
    );

    expect(assetsFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    const [target, init] = upstreamFetch.mock.calls[0] as [URL, RequestInit & { headers: Headers }];

    expect(target.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/download/tip/appcast.xml?build=1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.get("host")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.text()).resolves.toBe("appcast");
  });

  it("returns 405 for non-read download requests", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/tip/supaterm.dmg", { method: "POST" }),
      {
        ASSETS: { fetch: vi.fn() } as AssetBinding,
      },
    );

    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("falls back to static assets for non-download routes", async () => {
    const assetsFetch = vi.fn().mockResolvedValue(new Response("site"));

    const response = await worker.fetch(new Request("https://supaterm.com/"), {
      ASSETS: { fetch: assetsFetch } as AssetBinding,
    });

    expect(assetsFetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("site");
  });

  it("returns 404 when the download path is missing an asset name", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(new Request("https://supaterm.com/download/tip/"), {
      ASSETS: { fetch: vi.fn() } as AssetBinding,
    });

    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });
});
