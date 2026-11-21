import { EnvironmentId, type PeerLinkSummary } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { linkPermissionRow } from "./EnvironmentLinkPermissions.logic";

const vps = EnvironmentId.make("vps");
const link = (overrides: Partial<PeerLinkSummary> = {}): PeerLinkSummary => ({
  environmentId: vps,
  label: "vps",
  urls: ["https://vps.example.ts.net"],
  access: "full-access",
  linkedAt: DateTime.makeUnsafe("2026-11-01T00:00:00.000Z"),
  expiresAt: DateTime.makeUnsafe("2026-12-15T00:00:00.000Z"),
  lastReachedAt: null,
  lastError: null,
  status: "reachable",
  ...overrides,
});
const base = {
  links: [] as ReadonlyArray<PeerLinkSummary> | null,
  listError: null as string | null,
  targetId: vps,
  now: DateTime.makeUnsafe("2026-11-21T00:00:00.000Z"),
  canLink: true,
  canUnlink: true,
  mayMint: true,
  connected: true,
  reachable: true,
  sourceLabel: "laptop",
  targetLabel: "vps",
};

describe("linkPermissionRow", () => {
  it.each([
    {
      name: "a list still loading allows nothing",
      input: { links: null },
      row: { value: null, canGrant: false, canForget: false, linked: false, note: null },
    },
    {
      name: "a failed list allows nothing, even with a link it read before",
      input: { links: [link()], listError: "timed out" },
      row: { value: null, canGrant: false, canForget: false, linked: false },
    },
    {
      name: "no link reads as Off",
      input: {},
      row: { value: "off", canGrant: true, canForget: false, linked: false, note: null },
    },
    {
      name: "a live link shows its level and can be replaced or forgotten",
      input: { links: [link()] },
      row: { value: "full-access", canGrant: true, canForget: true, linked: true },
    },
    {
      name: "an expired link reads as Off but can still be forgotten",
      input: { links: [link({ status: "expired" })] },
      row: { value: "off", canForget: true, linked: false, note: "Expired. Link it again." },
    },
    {
      name: "a link past its expiry reads as Off before the list says so",
      input: { links: [link({ expiresAt: DateTime.makeUnsafe("2026-11-20T00:00:00.000Z") })] },
      row: { value: "off", linked: false },
    },
    {
      name: "a revoked link can be linked again at its level",
      input: { links: [link({ lastError: "revoked there" })] },
      row: { value: "full-access", canRelink: true, note: "revoked there" },
    },
    {
      name: "without minting there, Off still forgets the link",
      input: { links: [link()], mayMint: false },
      row: { canGrant: false, canForget: true, canRelink: false },
    },
  ])("$name", ({ input, row }) => {
    expect(linkPermissionRow({ ...base, ...input })).toMatchObject(row);
  });
});
