import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "./index";

type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

const textEncoder = new TextEncoder();

const sha256 = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fetchUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof Request ? input.url : input.href;
};

const installDownloadCache = () => {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      store.set(request.url, response.clone());
    }),
  };

  vi.stubGlobal("caches", { default: cache });
  return { cache, store };
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-supaterm-cache")).toBe("bypass");
    await expect(response.text()).resolves.toBe("dmg");
  });

  it("caches versioned binaries after checksum validation", async () => {
    installDownloadCache();
    const body = "verified dmg";
    const digest = await sha256(body);
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchUrl(input);
      if (
        url === "https://github.com/supabitapp/supaterm/releases/download/v26.0.0/checksums.json"
      ) {
        return Response.json({
          assets: {
            "supaterm.dmg": {
              sha256: digest,
              size: textEncoder.encode(body).byteLength,
            },
          },
        });
      }

      expect(url).toBe(
        "https://github.com/supabitapp/supaterm/releases/download/v26.0.0/supaterm.dmg?build=1",
      );
      return new Response(body, { headers: { etag: '"dmg"' } });
    });

    vi.stubGlobal("fetch", upstreamFetch);

    const first = await worker.fetch(
      new Request("https://supaterm.com/download/v26.0.0/supaterm.dmg?build=1"),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(first.headers.get("x-supaterm-cache")).toBe("validated");
    await expect(first.text()).resolves.toBe(body);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);

    upstreamFetch.mockClear();

    const second = await worker.fetch(
      new Request("https://supaterm.com/download/v26.0.0/supaterm.dmg?build=1"),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(second.headers.get("x-supaterm-cache")).toBe("hit");
    await expect(second.text()).resolves.toBe(body);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("keeps volatile cache control on tip cache hits", async () => {
    installDownloadCache();
    const body = "tip dmg";
    const digest = await sha256(body);
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (fetchUrl(input).endsWith("/checksums.json")) {
        return Response.json({
          assets: {
            "supaterm.dmg": {
              sha256: digest,
              size: textEncoder.encode(body).byteLength,
            },
          },
        });
      }

      return new Response(body, { headers: { "cache-control": "public, max-age=14400" } });
    });

    vi.stubGlobal("fetch", upstreamFetch);

    await worker.fetch(new Request("https://supaterm.com/download/tip/supaterm.dmg?build=1"), {
      ASSETS: { fetch: vi.fn() } as AssetBinding,
    });

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/tip/supaterm.dmg?build=1"),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-supaterm-cache")).toBe("hit");
  });

  it("blocks checksum mismatches without caching", async () => {
    const { store } = installDownloadCache();
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (fetchUrl(input).endsWith("/checksums.json")) {
        return Response.json({
          assets: {
            "supaterm.dmg": {
              sha256: "0".repeat(64),
              size: 5,
            },
          },
        });
      }

      return new Response("wrong");
    });

    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/v26.0.0/supaterm.dmg"),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-supaterm-cache")).toBe("checksum-mismatch");
    expect(store.size).toBe(0);
  });

  it("bypasses caching when the checksum manifest is missing the asset", async () => {
    const { store } = installDownloadCache();
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (fetchUrl(input).endsWith("/checksums.json")) {
        return Response.json({ assets: {} });
      }

      return new Response("available");
    });

    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/v26.0.0/supaterm.dmg"),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-supaterm-cache")).toBe("bypass");
    await expect(response.text()).resolves.toBe("available");
    expect(store.size).toBe(0);
  });

  it("bypasses checksum caching for range requests", async () => {
    installDownloadCache();
    const upstreamFetch = vi.fn().mockResolvedValue(new Response("range"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/v26.0.0/supaterm.dmg", {
        headers: { Range: "bytes=0-4" },
      }),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [target, init] = upstreamFetch.mock.calls[0] as [URL, RequestInit & { headers: Headers }];
    expect(target.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/download/v26.0.0/supaterm.dmg",
    );
    expect(init.headers.get("range")).toBe("bytes=0-4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-supaterm-cache")).toBe("bypass");
    await expect(response.text()).resolves.toBe("range");
  });

  it("bypasses checksum caching for HEAD requests", async () => {
    installDownloadCache();
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request("https://supaterm.com/download/v26.0.0/supaterm.dmg", { method: "HEAD" }),
      { ASSETS: { fetch: vi.fn() } as AssetBinding },
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [target, init] = upstreamFetch.mock.calls[0] as [URL, RequestInit & { headers: Headers }];
    expect(target.toString()).toBe(
      "https://github.com/supabitapp/supaterm/releases/download/v26.0.0/supaterm.dmg",
    );
    expect(init.method).toBe("HEAD");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-supaterm-cache")).toBe("bypass");
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
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
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

  it("rewrites OG meta tags for the changelog route", async () => {
    const shellHtml = [
      "<!doctype html><html><head>",
      "<title>Supaterm</title>",
      '<meta name="description" content="The terminal with skills" />',
      '<meta property="og:title" content="Supaterm - The terminal with skills" />',
      '<meta property="og:description" content="Fast native terminal for you and your agents." />',
      '<meta property="og:url" content="https://supaterm.com" />',
      '<meta name="twitter:title" content="Supaterm" />',
      '<meta name="twitter:description" content="The terminal with skills" />',
      "</head><body></body></html>",
    ].join("\n");

    const assetsFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response(shellHtml, { headers: { "content-type": "text/html" } }));

    const response = await worker.fetch(new Request("https://supaterm.com/changelog"), {
      ASSETS: { fetch: assetsFetch } as AssetBinding,
    });

    const html = await response.text();
    expect(html).toContain("<title>Supaterm - What's New</title>");
    expect(html).toContain('og:title" content="Supaterm - What\'s New"');
    expect(html).toContain('og:description" content="See what\'s new in Supaterm');
    expect(html).toContain('og:url" content="https://supaterm.com/changelog"');
    expect(html).toContain('twitter:title" content="Supaterm - What\'s New"');
    expect(html).toContain('twitter:description" content="See what\'s new in Supaterm');
    expect(html).not.toContain("The terminal with skills");
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
