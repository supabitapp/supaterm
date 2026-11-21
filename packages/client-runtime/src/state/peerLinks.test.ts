import { EnvironmentId, type PeerLinkSummary } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { incomingLinkNames } from "./peerLinks.ts";

const now = DateTime.makeUnsafe("2026-11-21T00:00:00.000Z");
const vps = EnvironmentId.make("vps");
const link = (overrides: Partial<PeerLinkSummary>): PeerLinkSummary => ({
  environmentId: vps,
  label: "vps",
  urls: ["https://vps.example.ts.net"],
  access: "full-access",
  linkedAt: DateTime.makeUnsafe("2026-11-01T00:00:00.000Z"),
  expiresAt: DateTime.makeUnsafe("2026-12-01T00:00:00.000Z"),
  lastReachedAt: null,
  lastError: null,
  status: "reachable",
  ...overrides,
});

describe("incomingLinkNames", () => {
  it("names each machine that links to an environment, leaving out expired links", () => {
    expect(
      incomingLinkNames({
        sources: [
          { label: "laptop", links: [link({})] },
          { label: "desktop", links: [link({ status: "unreachable" })] },
          { label: "old", links: [link({ status: "expired" })] },
          {
            label: "stale",
            links: [link({ expiresAt: DateTime.makeUnsafe("2026-11-20T00:00:00.000Z") })],
          },
        ],
        now,
      }),
    ).toEqual(new Map([[vps, ["laptop", "desktop"]]]));
  });
});
