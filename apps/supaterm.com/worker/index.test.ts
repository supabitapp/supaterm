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
  it("proxies latest release assets", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response("stable", {
        headers: { etag: '"stable"' },
      }),
    );
    const assetsFetch = vi.fn().mockResolvedValue(new Response("asset"));

    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/latest/appcast.xml?build=1"),
      { ASSETS: { fetch: assetsFetch } as AssetBinding },
    );

    expect(assetsFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    const [target, init] = upstreamFetch.mock.calls[0] as [URL, RequestInit & { headers: Headers }];

    expect(target.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/latest/download/appcast.xml?build=1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.get("host")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.text()).resolves.toBe("stable");
  });

  it("proxies the tip appcast through the merged latest feed", async () => {
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
      "https://github.com/supabitapp/supaterm/releases/latest/download/appcast.xml?build=1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.get("host")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.text()).resolves.toBe("appcast");
  });

  it("keeps tip binary assets on the tip release", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response("dmg", {
        headers: { etag: '"tip"' },
      }),
    );

    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/tip/supaterm.dmg?build=1"),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    const [target, init] = upstreamFetch.mock.calls[0] as [URL, RequestInit & { headers: Headers }];

    expect(target.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/download/tip/supaterm.dmg?build=1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.get("host")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.text()).resolves.toBe("dmg");
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

  it("serves the SPA shell for missing routes without file extensions", async () => {
    const assetsFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("index"));

    const response = await worker.fetch(new Request("https://supaterm.com/changelog"), {
      ASSETS: { fetch: assetsFetch } as AssetBinding,
    });

    expect(assetsFetch).toHaveBeenCalledTimes(2);
    const fallbackRequest = assetsFetch.mock.calls[1]?.[0];
    expect(fallbackRequest).toBeInstanceOf(Request);
    expect((fallbackRequest as Request).url).toBe("https://supaterm.com/index.html");
    await expect(response.text()).resolves.toBe("index");
  });

  it("does not serve the SPA shell for missing routes with file extensions", async () => {
    const assetsFetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));

    const response = await worker.fetch(new Request("https://supaterm.com/missing.dmg"), {
      ASSETS: { fetch: assetsFetch } as AssetBinding,
    });

    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("missing");
  });

  it("serves MP4 range requests with partial content", async () => {
    const assetsFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), {
        headers: { "content-type": "video/mp4" },
      }),
    );

    const response = await worker.fetch(
      new Request("https://supaterm.com/assets/demo.mp4", {
        headers: { Range: "bytes=2-5" },
      }),
      {
        ASSETS: { fetch: assetsFetch } as AssetBinding,
      },
    );

    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/8");
    expect(response.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });

  it("advertises byte ranges for MP4 assets without a range request", async () => {
    const assetsFetch = vi.fn().mockResolvedValue(
      new Response("video", {
        headers: { "content-type": "video/mp4" },
      }),
    );

    const response = await worker.fetch(new Request("https://supaterm.com/assets/demo.mp4"), {
      ASSETS: { fetch: assetsFetch } as AssetBinding,
    });

    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    await expect(response.text()).resolves.toBe("video");
  });

  it("returns 416 for invalid MP4 range requests", async () => {
    const assetsFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2, 3]), {
        headers: { "content-type": "video/mp4" },
      }),
    );

    const response = await worker.fetch(
      new Request("https://supaterm.com/assets/demo.mp4", {
        headers: { Range: "bytes=8-9" },
      }),
      {
        ASSETS: { fetch: assetsFetch } as AssetBinding,
      },
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes */4");
  });

  it("returns 404 when the download path is missing an asset name", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(new Request("https://supaterm.com/download/latest/"), {
      ASSETS: { fetch: vi.fn() } as AssetBinding,
    });

    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });
});
