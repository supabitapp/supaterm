import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { GuestRedeemRequest } from "./guestShare.ts";

const isRedeem = Schema.is(GuestRedeemRequest);

describe("GuestRedeemRequest", () => {
  it("accepts a one-line name and rejects names that break the attribution line", () => {
    expect(isRedeem({ credential: "invite", name: "Maya Chen" })).toBe(true);
    for (const name of [
      "Maya\nowner",
      "Maya owner",
      "Maya owner",
      "Maya\u0007",
      "Theo\u202E (owner)",
      "Theo\u2066x",
    ]) {
      expect(isRedeem({ credential: "invite", name })).toBe(false);
    }
  });
});

import { GuestLinkPayload, GuestShareCreateInput } from "./guestShare.ts";

it("only accepts an explicit guest bootstrap page without URL credentials", () => {
  const valid = Schema.is(GuestShareCreateInput);
  expect(valid({ threadId: "thread", guestPageUrl: "https://app.example/guest" })).toBe(true);
  for (const guestPageUrl of [
    "javascript:alert(1)",
    "https://user:password@app.example/guest",
    "https://app.example/guest?token=owner",
    "https://app.example/guest#owner",
    "https://app.example/settings",
  ])
    expect(valid({ threadId: "thread", guestPageUrl })).toBe(false);
});

it("bounds the versioned encrypted guest invitation", () => {
  const valid = Schema.is(GuestLinkPayload);
  const invite = {
    version: 1,
    address: "relay-address",
    relayUrl: "wss://relay.example",
    credential: "share.signature",
  };
  expect(valid(invite)).toBe(true);
  expect(valid({ ...invite, version: 2 })).toBe(false);
  expect(valid({ ...invite, relayUrl: "https://relay.example" })).toBe(false);
  expect(valid({ ...invite, credential: "a".repeat(257) })).toBe(false);
});
