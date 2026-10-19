import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import ingest from "./ingest";

afterEach(() => vi.unstubAllGlobals());

describe("ingestion proxy", () => {
  it("forwards batch bytes and trusted client IP without site credentials", async () => {
    const body = new Uint8Array([0, 31, 139, 255]);
    const upstream = new Response("accepted", {
      status: 202,
      headers: { "Access-Control-Allow-Origin": "*", "Retry-After": "5" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetch);

    const response = await ingest.fetch(
      new Request("https://i.supaterm.com/batch/?compression=gzip", {
        method: "POST",
        body,
        headers: {
          Cookie: "session=private",
          Authorization: "Bearer private",
          Host: "i.supaterm.com",
          "CF-Connecting-IP": "203.0.113.7",
          "X-Forwarded-For": "198.51.100.1",
          "Content-Type": "application/octet-stream",
          Origin: "https://app.supaterm.com",
        },
      }),
    );

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://us.i.posthog.com/batch/?compression=gzip");
    expect(request.method).toBe("POST");
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(body);
    expect(request.headers.get("Cookie")).toBeNull();
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.headers.get("Host")).toBeNull();
    expect(request.headers.get("X-Forwarded-For")).toBe("203.0.113.7");
    expect(request.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(request.headers.get("Origin")).toBe("https://app.supaterm.com");
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("manual");
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("accepted");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Retry-After")).toBe("5");
  });

  it.each(["/static/array.js?v=42", "/array/project/config.js?v=42"])(
    "routes %s to the asset host with conditional request headers",
    async (path) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 304 }));
      vi.stubGlobal("fetch", fetch);

      const response = await ingest.fetch(
        new Request(`https://i.supaterm.com${path}`, {
          headers: { "If-None-Match": "sdk-v1" },
        }),
      );

      const request = fetch.mock.calls[0]?.[0] as Request;
      expect(request.url).toBe(`https://us-assets.i.posthog.com${path}`);
      expect(request.headers.get("If-None-Match")).toBe("sdk-v1");
      expect(request.headers.get("X-Forwarded-For")).toBe("");
      expect(response.status).toBe(304);
    },
  );

  it.each(["HEAD", "OPTIONS"])("forwards %s and upstream CORS responses", async (method) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Methods": "GET, POST, OPTIONS" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await ingest.fetch(
      new Request("https://i.supaterm.com/flags/?v=2", { method }),
    );

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://us.i.posthog.com/flags/?v=2");
    expect(request.method).toBe(method);
    expect((await request.arrayBuffer()).byteLength).toBe(0);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });
});
