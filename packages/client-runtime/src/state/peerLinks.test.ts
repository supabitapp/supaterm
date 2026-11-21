import { EnvironmentId, type PeerLinkSummary } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { incomingLinkNames, linkIntermediaries } from "./peerLinks.ts";

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

describe("linkIntermediaries", () => {
  const id = (value: string) => EnvironmentId.make(value);
  const host = (name: string, links: ReadonlyArray<PeerLinkSummary>) => ({
    environmentId: id(name),
    label: name,
    links,
  });

  it("offers only hosts whose full-access link to the target answers", () => {
    expect(
      linkIntermediaries({
        targetId: vps,
        hosts: [
          host("vps", [link({ environmentId: id("other") })]),
          host("via", [link({ environmentId: id("other") }), link({})]),
          host("supervised", [link({ access: "approval-required" })]),
          host("down", [link({ status: "unreachable" })]),
          host("lapsed", [link({ expiresAt: now })]),
          host("elsewhere", [link({ environmentId: id("other") })]),
          host("later", [link({})]),
        ],
        now,
      }),
    ).toEqual([
      { environmentId: id("via"), label: "via" },
      { environmentId: id("later"), label: "later" },
    ]);
  });
});
