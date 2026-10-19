import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vite-plus/test";

import {
  canonicalRelayAddress,
  decodeBase64,
  parseRelayAddress,
  relayEndpointId,
  relayHttpBaseUrl,
  relayPublicKey,
  signRelayChallenge,
  upgradeRelayAddresses,
} from "./protocol.ts";

describe("signRelayChallenge", () => {
  it("signs the challenge message the deployed relay verifies", () => {
    const secret = new Uint8Array(32).fill(9);
    const publicKey = relayPublicKey(secret);
    const nonce = "nonce-123";
    const message = new TextEncoder().encode(
      `supaterm-relay-v1\n${relayEndpointId(publicKey)}\n${nonce}`,
    );
    const signature = decodeBase64(signRelayChallenge(secret, nonce));
    expect(ed25519.verify(signature, message, publicKey)).toBe(true);
  });
});

describe("relay addresses", () => {
  const publicKey = relayPublicKey(new Uint8Array(32).fill(7));
  const address = relayHttpBaseUrl(publicKey);
  const legacy = address.replace(".relay.supaterm.alt/", ".relay.supaterm.invalid/");

  it("reads addresses issued under the legacy suffix as the same host", () => {
    expect(address).toMatch(/^https:\/\/[0-9a-f]{32}\.[0-9a-f]{32}\.relay\.supaterm\.alt\/$/);
    expect(parseRelayAddress(`${legacy}pair#token=code`)).toEqual(publicKey);
    expect(canonicalRelayAddress(legacy.replace("https:", "wss:"))).toBe(address.slice(0, -1));
    expect(canonicalRelayAddress("https://host.test/")).toBeNull();
  });

  it("moves every legacy relay host in a text to the current suffix", () => {
    const host = new URL(address).host;
    const legacyHost = new URL(legacy).host;
    expect(upgradeRelayAddresses(legacy.replace("https:", "wss:"))).toBe(
      address.replace("https:", "wss:"),
    );
    expect(upgradeRelayAddresses(JSON.stringify([JSON.stringify([`https://${legacyHost}`])]))).toBe(
      JSON.stringify([JSON.stringify([`https://${host}`])]),
    );
    expect(upgradeRelayAddresses(address)).toBe(address);
    expect(upgradeRelayAddresses(`https://${legacyHost}.example.test/`)).toBe(
      `https://${legacyHost}.example.test/`,
    );
    expect(upgradeRelayAddresses("https://aa.relay.supaterm.invalid/")).toBe(
      "https://aa.relay.supaterm.invalid/",
    );
  });
});
