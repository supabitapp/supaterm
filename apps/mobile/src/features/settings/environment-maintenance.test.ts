import { AuthEnvironmentMaintainScope } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { canMaintainEnvironment, findEnvironmentUpdate } from "./environment-maintenance";

describe("environment maintenance access", () => {
  it("requires a connected authenticated session with maintenance permission", () => {
    const session = {
      authenticated: true,
      auth: {
        policy: "remote-reachable" as const,
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "session",
      },
      scopes: [AuthEnvironmentMaintainScope],
    };
    expect(canMaintainEnvironment(session, true)).toBe(true);
    expect(canMaintainEnvironment(session, false)).toBe(false);
    expect(canMaintainEnvironment({ ...session, authenticated: false }, true)).toBe(false);
    expect(canMaintainEnvironment({ ...session, scopes: [] }, true)).toBe(false);
    const { scopes: _, ...legacy } = session;
    expect(canMaintainEnvironment(legacy, true)).toBe(false);
    expect(canMaintainEnvironment(null, true)).toBe(false);
  });
});

describe("environment release checks", () => {
  const signal = new AbortController().signal;
  const feed = (...tags: ReadonlyArray<string>) =>
    new Response(
      `<feed><id>tag:github.com,2008:https://github.com/supabitapp/supaterm/releases</id>${tags
        .map((tag) => `<entry><id>tag:github.com,2008:Repository/1/${tag}</id></entry>`)
        .join("")}</feed>`,
    );

  it("keeps nightly and preview hosts on their channel without using the anonymous API quota", async () => {
    const releases = async (url: string) =>
      url === "https://github.com/supabitapp/supaterm/releases.atom"
        ? feed(
            "desktop-preview",
            "v1.0.0-preview.20260924.3",
            "v1.0.0-nightly.20260924.2",
            "v1.0.0",
            "v1.0.0-nightly.20260923.1",
          )
        : new Response(null, { status: 403 });
    expect(await findEnvironmentUpdate("1.0.0-nightly.20260923.1", signal, releases)).toBe(
      "1.0.0-nightly.20260924.2",
    );
    expect(await findEnvironmentUpdate("1.0.0-nightly.20260924.2", signal, releases)).toBeNull();
    expect(await findEnvironmentUpdate("1.0.0-preview.20260923.1", signal, releases)).toBe(
      "1.0.0-preview.20260924.3",
    );
    expect(await findEnvironmentUpdate("1.0.0-preview.20260925.1", signal, releases)).toBeNull();
  });

  it("finds a published preview beyond the ten-entry feed and first API page", async () => {
    const nightlies = Array.from({ length: 10 }, (_, i) => `v1.0.0-nightly.20260930.${i}`);
    const releases = async (url: string) => {
      if (url === "https://github.com/supabitapp/supaterm/releases.atom") return feed(...nightlies);
      if (url === "https://api.github.com/repos/supabitapp/supaterm/releases?per_page=100&page=1") {
        return Response.json(Array.from({ length: 100 }, () => ({ tag_name: "v2.0.0" })));
      }
      if (url === "https://api.github.com/repos/supabitapp/supaterm/releases?per_page=100&page=2") {
        return Response.json([
          { tag_name: "v1.0.0-preview.20260925.1", draft: true },
          { tag_name: "v1.0.0-preview.20260924.3" },
        ]);
      }
      throw new Error(`Unexpected release request: ${url}`);
    };
    expect(await findEnvironmentUpdate("1.0.0-preview.20260923.1", signal, releases)).toBe(
      "1.0.0-preview.20260924.3",
    );
  });

  it("reports failed checks instead of claiming the server is current", async () => {
    for (const status of [403, 429]) {
      await expect(
        findEnvironmentUpdate("1.0.0", signal, async () => new Response(null, { status })),
      ).rejects.toThrow(String(status));
    }
    await expect(
      findEnvironmentUpdate("1.0.0-nightly.20260923.1", signal, async (url) =>
        url.endsWith(".atom") ? feed("v1.0.0") : Response.json([{ tag_name: "v1.0.0" }]),
      ),
    ).rejects.toThrow("No nightly release");
    await expect(
      findEnvironmentUpdate("1.0.0", signal, async () => Response.json({ error: "invalid" })),
    ).rejects.toThrow();
  });
});
