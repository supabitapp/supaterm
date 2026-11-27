import type { TailnetOwner } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { tailnetRequestDecision } from "./TailnetAdmission.ts";
import type { TailnetPeer } from "./tailnetPeer.ts";

const owner: TailnetOwner = { type: "user", login: "Alice@Example.com", displayName: "Alice" };
const caller = (login: string | null, tls = true): TailnetPeer => ({
  tls,
  remoteAddress: "100.64.0.7",
  identity: login === null ? null : { login },
});
const ownerOnly = { admission: "owner" as const, allowedLogins: [] };

describe("tailnetRequestDecision", () => {
  it.each([
    ["the owner", caller("alice@example.com"), "/api/x", ownerOnly, { _tag: "Pass" }],
    [
      "someone else",
      caller("bob@example.com"),
      "/ws",
      ownerOnly,
      { _tag: "Refused", login: "bob@example.com" },
    ],
    [
      "an allow-listed account",
      caller("bob@example.com"),
      "/ws",
      { admission: "owner" as const, allowedLogins: ["BOB@example.com"] },
      { _tag: "Pass" },
    ],
    [
      "anyone when the tailnet decides",
      caller("bob@example.com"),
      "/ws",
      { admission: "tailnet" as const, allowedLogins: [] },
      { _tag: "Pass" },
    ],
    [
      "an unidentified caller",
      caller(null),
      "/ws",
      { admission: "tailnet" as const, allowedLogins: [] },
      { _tag: "Refused", login: null },
    ],
    [
      "anyone asking for the descriptor",
      caller(null),
      "/.well-known/supaterm/environment",
      ownerOnly,
      { _tag: "Pass" },
    ],
    [
      "the owner on plain HTTP outside the tunnel",
      caller("alice@example.com", false),
      "/",
      ownerOnly,
      { _tag: "NotFound" },
    ],
    [
      "someone else on the plain HTTP tunnel",
      caller("bob@example.com", false),
      "/v1/connect",
      ownerOnly,
      { _tag: "Refused", login: "bob@example.com" },
    ],
    [
      "the owner on the plain HTTP tunnel",
      caller("alice@example.com", false),
      "/v1/connect",
      ownerOnly,
      { _tag: "Pass" },
    ],
  ])("decides for %s", (_name, peer, pathname, settings, expected) => {
    expect(tailnetRequestDecision({ peer, pathname, settings, owner })).toEqual(expected);
  });

  it("refuses everyone but allow-listed accounts on a tagged node in owner mode", () => {
    const tagged: TailnetOwner = { type: "tagged", tags: ["tag:server"] };
    expect(
      tailnetRequestDecision({
        peer: caller("alice@example.com"),
        pathname: "/ws",
        settings: { admission: "owner", allowedLogins: ["alice@example.com"] },
        owner: tagged,
      }),
    ).toEqual({ _tag: "Pass" });
    expect(
      tailnetRequestDecision({
        peer: caller("bob@example.com"),
        pathname: "/ws",
        settings: ownerOnly,
        owner: tagged,
      }),
    ).toEqual({ _tag: "Refused", login: "bob@example.com" });
  });
});
