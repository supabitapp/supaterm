import { EnvironmentId, type PeerLinkSummary } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { linkPermissionRow } from "./EnvironmentLinkPermissions.logic";

const vps = EnvironmentId.make("vps");
const laptop = { environmentId: EnvironmentId.make("laptop"), label: "laptop" };
const desktop = { environmentId: EnvironmentId.make("desktop"), label: "desktop" };
const direct = { _tag: "Direct" };
const throughDesktop = { _tag: "Through", intermediary: desktop };
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
  sourceId: laptop.environmentId,
  targetId: vps,
  now: DateTime.makeUnsafe("2026-11-21T00:00:00.000Z"),
  canLink: true,
  canUnlink: true,
  mayMint: true,
  connected: true,
  reachable: true,
  sourceLabel: "laptop",
  targetLabel: "vps",
  intermediaries: [] as ReadonlyArray<typeof desktop>,
};

describe("linkPermissionRow", () => {
  it.each([
    {
      name: "a list still loading allows nothing",
      input: { links: null },
      row: { value: null, grant: null, canForget: false, linked: false, note: null },
    },
    {
      name: "a failed list allows nothing, even with a link it read before",
      input: { links: [link()], listError: "timed out" },
      row: { value: null, grant: null, canForget: false, linked: false },
    },
    {
      name: "no link reads as Off",
      input: {},
      row: { value: "off", grant: direct, canForget: false, linked: false, note: null },
    },
    {
      name: "a live link shows its level and can be replaced or forgotten",
      input: { links: [link()] },
      row: { value: "full-access", grant: direct, canForget: true, linked: true, expired: false },
    },
    {
      name: "an expired link reads as Off but can still be forgotten",
      input: { links: [link({ status: "expired" })] },
      row: {
        value: "off",
        canForget: true,
        linked: false,
        expired: true,
        note: "Expired. Link it again.",
      },
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
      row: { grant: null, canForget: true, canRelink: false },
    },
    {
      name: "without minting there, a machine with a full-access link gets the code",
      input: { mayMint: false, intermediaries: [desktop] },
      row: {
        grant: throughDesktop,
        note: "desktop links to vps at full access, so it gets the pairing code.",
      },
    },
    {
      name: "a disconnected target is linked through that machine too",
      input: { connected: false, intermediaries: [desktop] },
      row: { grant: throughDesktop },
    },
    {
      name: "this app mints itself when it can, whatever else links there",
      input: { intermediaries: [desktop] },
      row: { grant: direct, note: null },
    },
    {
      name: "no route through another machine still needs a connection there",
      input: { connected: false },
      row: { grant: null, note: "Connect to vps to change this." },
    },
    {
      name: "a source never gets the code through itself",
      input: { mayMint: false, intermediaries: [laptop, desktop] },
      row: { grant: throughDesktop },
    },
    {
      name: "a source that is the only route still needs this app to mint",
      input: { mayMint: false, intermediaries: [laptop] },
      row: { grant: null, note: "This app may not grant access on vps." },
    },
    {
      name: "a route through another machine still needs leave to change the source's links",
      input: { canLink: false, mayMint: false, intermediaries: [desktop] },
      row: { grant: null, note: "This app may not change links on laptop." },
    },
  ])("$name", ({ input, row }) => {
    expect(linkPermissionRow({ ...base, ...input })).toMatchObject(row);
  });
});
