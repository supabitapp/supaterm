import { describe, expect, it } from "vite-plus/test";

import router, { routeRequest } from "./router";

describe("hosted channel routing", () => {
  it.each(["nightly", "latest", "invalid"])(
    "sets a secure channel cookie for %s",
    async (channel) => {
      const response = await router.fetch(
        new Request(`https://app.supaterm.com/__supaterm/channel?channel=${channel}`),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
      expect(response.headers.get("Set-Cookie")).toBe(
        `supaterm_web_channel=${channel === "nightly" ? "nightly" : "latest"}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it.each([
    ["", "latest"],
    ["other=nightly", "latest"],
    ["supaterm_web_channel=nightly-extra", "latest"],
    ["other=x; supaterm_web_channel=nightly", "nightly"],
    ["supaterm_web_channel=latest", "latest"],
  ])("routes cookie %s to %s without changing the path or query", async (cookie, channel) => {
    const upstreamRequests: Array<Request> = [];
    const response = await routeRequest(
      new Request("https://app.supaterm.com/assets/app.js?v=42", {
        headers: { Cookie: cookie, "If-None-Match": "asset-v1" },
      }),
      async (input) => {
        upstreamRequests.push(new Request(input));
        return new Response("asset", { status: 200 });
      },
    );
    const request = upstreamRequests[0]!;
    expect(request.url).toBe(`https://${channel}.app.supaterm.com/assets/app.js?v=42`);
    expect(request.headers.get("If-None-Match")).toBe("asset-v1");
    expect(await response.text()).toBe("asset");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
