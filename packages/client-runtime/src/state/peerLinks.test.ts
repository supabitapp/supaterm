import { EnvironmentId, type PeerLinkSummary } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { incomingLinkNames, linkThroughRoutes } from "./peerLinks.ts";

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

describe("linkThroughRoutes", () => {
  const id = (value: string) => EnvironmentId.make(value);
  const to = (target: string, overrides: Partial<PeerLinkSummary> = {}) =>
    link({
      environmentId: id(target),
      label: target,
      urls: [`https://${target}.example`],
      expiresAt: DateTime.makeUnsafe("2026-12-20T00:00:00.000Z"),
      ...overrides,
    });

  it("offers only machines another environment reaches over a full-access link that answers", () => {
    const routes = linkThroughRoutes({
      sourceEnvironmentId: id("source"),
      hosts: [
        { environmentId: id("source"), links: [to("own")] },
        {
          environmentId: id("via"),
          links: [
            to("open"),
            to("source"),
            to("supervised", { access: "approval-required" }),
            to("down", { status: "unreachable" }),
            to("lapsed", { expiresAt: now }),
          ],
        },
        { environmentId: id("later"), links: [to("open")] },
      ],
      now,
    });
    expect([...routes.values()]).toEqual([
      {
        viaEnvironmentId: id("via"),
        environmentId: id("open"),
        label: "open",
        urls: ["https://open.example"],
      },
    ]);
  });
});
