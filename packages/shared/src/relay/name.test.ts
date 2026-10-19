import { describe, expect, it } from "vite-plus/test";
import { relayName } from "./name.ts";
import { relayHttpBaseUrl, relayPublicKey } from "./protocol.ts";

const address = (seed: number) => relayHttpBaseUrl(relayPublicKey(new Uint8Array(32).fill(seed)));

describe("relayName", () => {
  it("names a relay address with three words that stay stable", () => {
    const name = relayName(address(7));
    expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(relayName(address(7))).toBe(name);
    expect(relayName(`${address(7)}api/test?x=1`)).toBe(name);
    expect(relayName(address(8))).not.toBe(name);
  });

  it("leaves ordinary and malformed addresses unnamed", () => {
    expect(relayName("https://host.test/")).toBeNull();
    expect(relayName("https://abc.relay.supaterm.alt/")).toBeNull();
    expect(relayName("not a url")).toBeNull();
  });
});
