import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";
import { resolveRemotePairingTarget } from "@supaterm/shared/remote";

import {
  resolveDesktopPairingUrl,
  resolveHostedPairingUrl,
  resolvePairingShareValue,
} from "./pairingUrls";

describe("settings pairing URL helpers", () => {
  it.each(["supaterm://app", "file:///Applications/Supaterm/index.html"])(
    "shows the code instead of creating a remote link from %s",
    (origin) => {
      expect(resolvePairingShareValue("PAIRCODE", origin)).toEqual({
        value: "PAIRCODE",
        kind: "code",
        qrShareable: false,
      });
    },
  );
  it("keeps incompatible HTTPS endpoints on the direct pairing route", () => {
    const result = resolvePairingShareValue("PAIRCODE", "https://private-host.invalid", {}, false);
    expect(result.value).toBe("https://private-host.invalid/pair#token=PAIRCODE");
    expect(result.qrShareable).toBe(true);
  });
  it("shows a relay link and a scannable QR before access-list updates arrive", () => {
    const relayUrl = "wss://custom-relay.invalid";
    const host = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
    const result = resolvePairingShareValue("PAIRCODE", host, {
      environmentId: EnvironmentId.make("machine"),
      relayUrl,
    });
    expect(result.kind).toBe("link");
    expect(result.qrShareable).toBe(true);
    expect(resolveRemotePairingTarget({ pairingUrl: result.value })).toMatchObject({
      credential: "PAIRCODE",
      httpBaseUrl: host,
      relayUrl,
      environmentId: "machine",
    });
  });

  it("shows the creation credential when no reachable URL is available", () => {
    expect(resolvePairingShareValue("PAIRCODE", null)).toEqual({
      value: "PAIRCODE",
      kind: "code",
      qrShareable: false,
    });
  });

  it.each(["http://localhost:3773", "http://127.0.0.1:3773", "http://[::1]:3773"])(
    "keeps %s copyable without offering a QR that would dial the scanning device",
    (origin) => {
      const result = resolvePairingShareValue("PAIRCODE", origin);
      expect(result.kind).toBe("link");
      expect(result.qrShareable).toBe(false);
      expect(result.value).toContain("#token=PAIRCODE");
    },
  );
  it("carries the same identity and routes through direct and hosted links", () => {
    const hints = {
      environmentId: EnvironmentId.make("machine"),
      routes: ["https://machine.ts.net", "http://100.64.1.2:3773"],
    };
    for (const pairingUrl of [
      resolveDesktopPairingUrl("https://public.test", "code", hints),
      resolveHostedPairingUrl("https://public.test", "code", hints),
    ]) {
      expect(resolveRemotePairingTarget({ pairingUrl: pairingUrl! })).toMatchObject({
        environmentId: hints.environmentId,
        routes: ["https://machine.ts.net/", "http://100.64.1.2:3773/"],
      });
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses direct backend pairing URLs for HTTP endpoints", () => {
    expect(resolveHostedPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBeNull();
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
  });

  it("uses hosted pairing URLs for HTTPS endpoints", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.supaterm.com");

    expect(resolveHostedPairingUrl("https://host.tailnet.example.ts.net:3773", "PAIRCODE")).toBe(
      "https://preview.supaterm.com/pair?host=https%3A%2F%2Fhost.tailnet.example.ts.net%3A3773#token=PAIRCODE",
    );
  });
});
