import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PeerLink, PeerLinkCreateInput, PeerLinkRequestAnswerInput } from "./peerLink.ts";

const decodeCreate = Schema.decodeUnknownSync(PeerLinkCreateInput);
const decodeAnswer = Schema.decodeUnknownSync(PeerLinkRequestAnswerInput);
const linkJson = Schema.toCodecJson(PeerLink);
const decodeLink = Schema.decodeUnknownSync(linkJson);
const encodeLink = Schema.encodeSync(linkJson);

const relay = {
  relayEndpoint: "stable-peer-identity",
  relayUrl: "wss://relay.example.com",
};
const access = { pairingCode: "pairing-code", access: "approval-required" } as const;

describe("peer link routes", () => {
  it("preserves direct routes from existing clients", () => {
    const input = {
      ...access,
      url: "https://peer.example.com",
      alternateUrls: ["http://peer.tailnet.ts.net:3773"],
    };
    expect(decodeCreate(input)).toEqual(input);
  });

  it("accepts a pinned relay without a temporary loopback URL", () => {
    expect(decodeCreate({ ...access, relay })).toEqual({ ...access, relay });
    expect(decodeCreate({ ...access, url: undefined, relay })).toEqual({
      ...access,
      url: undefined,
      relay,
    });
  });

  it("preserves both relay and direct routes", () => {
    const input = { ...access, relay, url: "https://peer.example.com" };
    expect(decodeCreate(input)).toEqual(input);
  });

  it("rejects an input with no primary route", () => {
    expect(() => decodeCreate(access)).toThrow();
    expect(() =>
      decodeCreate({ ...access, alternateUrls: ["https://peer.example.com"] }),
    ).toThrow();
    expect(() => decodeCreate({ ...access, relay: {} })).toThrow();
  });

  it("round-trips a saved relay identity without inventing a direct URL", () => {
    const stored = {
      environmentId: "peer-environment",
      label: "Peer",
      urls: [],
      relay,
      access: "approval-required",
      linkedAt: "2026-10-29T00:00:00.000Z",
      expiresAt: "2026-10-30T00:00:00.000Z",
      lastReachedAt: null,
      lastError: null,
    };
    expect(encodeLink(decodeLink(stored))).toEqual(stored);
  });
});

describe("peer link card answers", () => {
  const target = { threadId: "thread", turnItemId: "card" };

  it("accepts a relay-only answer and supplies the direct-route list", () => {
    const answer = { type: "link", ...access, relay };
    expect(decodeAnswer({ ...target, answer })).toEqual({
      ...target,
      answer: { ...answer, urls: [] },
    });
  });

  it("preserves direct answers and rejects an empty answer", () => {
    const answer = { type: "link", ...access, urls: ["https://peer.example.com"] };
    expect(decodeAnswer({ ...target, answer })).toEqual({ ...target, answer });
    expect(() => decodeAnswer({ ...target, answer: { ...answer, urls: [] } })).toThrow();
  });

  it("carries a relay-only card answer into the create contract", () => {
    const { answer } = decodeAnswer({
      ...target,
      answer: { type: "link", ...access, relay },
    });
    if (answer.type !== "link") throw new Error("Expected a link answer");
    const [url, ...alternateUrls] = answer.urls;
    const input: PeerLinkCreateInput = {
      url,
      alternateUrls,
      pairingCode: answer.pairingCode,
      access: answer.access,
      ...(answer.relay === undefined ? {} : { relay: answer.relay }),
    };
    expect(decodeCreate(input)).toEqual({ ...access, url: undefined, alternateUrls: [], relay });
  });
});
