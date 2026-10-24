import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";

import {
  RemoteBackendUrlInvalidError,
  RemoteBackendUrlMissingError,
  RemotePairingTokenMissingError,
  RemotePairingUrlInvalidError,
  resolveRemotePairingTarget,
  buildPairingUrl,
  stripPairingTokenFromUrl,
  setPairingTokenOnUrl,
} from "./remote.ts";

describe("remote", () => {
  const environmentId = EnvironmentId.make("paired-environment");

  it("keeps the query when removing a pairing token", () => {
    expect(
      stripPairingTokenFromUrl(new URL(`https://host.test/?view=1#token=code&env=${environmentId}`))
        .href,
    ).toBe("https://host.test/?view=1");
  });

  it("round-trips identity and eligible routes while keeping tokens in the fragment", () => {
    const pairingUrl = buildPairingUrl("http://192.168.1.10:3773", "a token & code", {
      environmentId,
      routes: [
        "http://192.168.1.10:3773/",
        "http://100.64.1.2:3773/",
        "https://machine.ts.net/",
        "https://machine.ts.net/",
      ],
    });
    expect(new URL(pairingUrl).search).toBe("");
    expect(resolveRemotePairingTarget({ pairingUrl })).toMatchObject({
      credential: "a token & code",
      environmentId,
      routes: ["https://machine.ts.net/", "http://100.64.1.2:3773/"],
    });
    expect(stripPairingTokenFromUrl(new URL(`${pairingUrl}&keep=yes`)).hash).toBe("#keep=yes");
  });

  it.each(["", "env=", "env=%20", "env=one&env=two"])(
    "handles absent or malformed identity %s",
    (fragment) => {
      const pairingUrl = `https://host.test/pair#token=code&routes=https://other.test&${fragment}`;
      if (fragment === "") {
        expect(resolveRemotePairingTarget({ pairingUrl })).not.toHaveProperty("routes");
      } else {
        expect(() => resolveRemotePairingTarget({ pairingUrl })).toThrow(
          RemotePairingUrlInvalidError,
        );
      }
    },
  );

  it("carries a non-default relay with relay pairing links only", () => {
    const relayAddress = `https://${"ab".repeat(16)}.${"cd".repeat(16)}.relay.supaterm.alt/`;
    const relayUrl = "wss://relay.example/tunnel";
    const pairingUrl = buildPairingUrl(relayAddress, "code", { environmentId, relayUrl });
    expect(resolveRemotePairingTarget({ pairingUrl })).toMatchObject({
      httpBaseUrl: relayAddress,
      environmentId,
      relayUrl,
    });
    expect(stripPairingTokenFromUrl(new URL(pairingUrl)).hash).toBe("");
    expect(
      buildPairingUrl(relayAddress, "code", { relayUrl: "wss://relay.supaterm.com" }),
    ).not.toContain("relay=");
    expect(buildPairingUrl("https://host.test", "code", { relayUrl })).not.toContain("relay=");
    expect(() =>
      resolveRemotePairingTarget({ pairingUrl: `${relayAddress}pair#token=code&relay=https://x` }),
    ).toThrow(RemotePairingUrlInvalidError);
  });

  it("resolves links from hosts that still issue legacy relay addresses", () => {
    const relayAddress = `https://${"ab".repeat(16)}.${"cd".repeat(16)}.relay.supaterm.alt/`;
    const legacy = relayAddress.replace(".alt/", ".invalid/");
    expect(resolveRemotePairingTarget({ pairingUrl: `${legacy}pair#token=code` })).toMatchObject({
      httpBaseUrl: relayAddress,
      wsBaseUrl: relayAddress.replace("https:", "wss:"),
    });
    expect(
      resolveRemotePairingTarget({
        pairingUrl: `https://app.supaterm.com/pair?host=${encodeURIComponent(legacy)}#token=code`,
      }),
    ).toMatchObject({ httpBaseUrl: relayAddress });
  });

  it("discards unsafe route hints", () => {
    const routes = [
      "http://localhost",
      "https://127.0.0.2",
      "http://0.0.0.0",
      "http://169.254.1.1",
      "http://8.8.8.8",
      "http://machine.local",
      "https://user:pass@host.test",
      "https://host.test/path",
      "https://host.test?token=code",
    ];
    for (const route of routes) {
      expect(
        resolveRemotePairingTarget({
          pairingUrl: `https://host.test/pair#token=code&env=${environmentId}&routes=${encodeURIComponent(route)}`,
        }).routes,
      ).toEqual([]);
    }
  });

  it("caps hints without truncating mandatory fields or labels", () => {
    const routes = Array.from({ length: 10 }, (_, index) => `http://10.0.0.${index + 1}`);
    const pairingUrl = buildPairingUrl("https://host.test", "code", { environmentId, routes });
    expect(resolveRemotePairingTarget({ pairingUrl }).routes).toHaveLength(6);
    expect(new TextEncoder().encode(pairingUrl).length).toBeLessThanOrEqual(287);
    const hosted = new URL("https://app.test/pair?host=https://host.test");
    hosted.searchParams.set("label", "long label ".repeat(60));
    const longLink = setPairingTokenOnUrl(hosted, "long token ".repeat(50), {
      environmentId,
      routes,
    });
    expect(longLink.searchParams.get("label")).toBe(hosted.searchParams.get("label"));
    expect(resolveRemotePairingTarget({ pairingUrl: longLink.href })).toMatchObject({
      environmentId,
      credential: "long token ".repeat(50).trim(),
      routes: [],
    });
  });
  it("derives backend urls and token from a pairing url", () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl: "https://remote.example.com/pair#token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("derives backend urls from hosted app pairing links", () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl:
          "https://app.supaterm.com/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%3A44342%2F#token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://desktop.tailnet.ts.net:44342/",
      wsBaseUrl: "wss://desktop.tailnet.ts.net:44342/",
    });
  });

  it("derives backend urls from a host and pairing code", () => {
    expect(
      resolveRemotePairingTarget({
        host: "https://remote.example.com",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("treats a protocol-relative host as https", () => {
    expect(
      resolveRemotePairingTarget({
        host: "//remote.example.com",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("normalizes a protocol-relative host from a hosted pairing link", () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl:
          "https://app.supaterm.com/pair?host=%2F%2Fremote.example.com#token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("collapses extra leading slashes instead of producing an empty host", () => {
    expect(
      resolveRemotePairingTarget({
        host: "///example.com",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://example.com/",
      wsBaseUrl: "wss://example.com/",
    });
  });

  it("does not double-prepend https when the host already carries a scheme", () => {
    expect(
      resolveRemotePairingTarget({
        host: "//https://example.com",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://example.com/",
      wsBaseUrl: "wss://example.com/",
    });
  });

  it("preserves host ports when normalizing a bare host input", () => {
    expect(
      resolveRemotePairingTarget({
        host: "myserver.com:3000",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://myserver.com:3000/",
      wsBaseUrl: "wss://myserver.com:3000/",
    });
  });

  it("rejects unsupported direct pairing URL protocols", () => {
    let pairingUrlError: unknown;
    try {
      resolveRemotePairingTarget({
        pairingUrl: "ftp://remote.example.com/pair#token=pairing-token",
      });
    } catch (cause) {
      pairingUrlError = cause;
    }

    expect(pairingUrlError).toBeInstanceOf(RemotePairingUrlInvalidError);
    expect(pairingUrlError).toMatchObject({ protocol: "ftp:" });
    expect((pairingUrlError as RemotePairingUrlInvalidError).cause).toBeUndefined();
  });

  it("rejects unsupported hosted pairing backend protocols", () => {
    let hostError: unknown;
    try {
      resolveRemotePairingTarget({
        pairingUrl:
          "https://app.supaterm.com/pair?host=ftp%3A%2F%2Fremote.example.com#token=pairing-token",
      });
    } catch (cause) {
      hostError = cause;
    }

    expect(hostError).toBeInstanceOf(RemoteBackendUrlInvalidError);
    expect(hostError).toMatchObject({ source: "hosted-pairing-host", protocol: "ftp:" });
    expect((hostError as RemoteBackendUrlInvalidError).cause).toBeUndefined();
  });

  it("rejects unsupported direct host protocols", () => {
    let hostError: unknown;
    try {
      resolveRemotePairingTarget({
        host: "ftp://remote.example.com",
        pairingCode: "pairing-token",
      });
    } catch (cause) {
      hostError = cause;
    }

    expect(hostError).toBeInstanceOf(RemoteBackendUrlInvalidError);
    expect(hostError).toMatchObject({ source: "direct-host", protocol: "ftp:" });
    expect((hostError as RemoteBackendUrlInvalidError).cause).toBeUndefined();
  });

  it("uses distinct structural errors for missing pairing inputs", () => {
    expect(() => resolveRemotePairingTarget({})).toThrowError(RemoteBackendUrlMissingError);
    expect(() =>
      resolveRemotePairingTarget({ pairingUrl: "https://remote.example.com/pair" }),
    ).toThrowError(RemotePairingTokenMissingError);
    expect(() =>
      resolveRemotePairingTarget({
        host: "https://user:secret@remote.example.com/path?token=sensitive#fragment",
      }),
    ).toThrowError(
      expect.objectContaining({
        _tag: "RemotePairingCodeMissingError",
        host: "remote.example.com",
      }),
    );
  });
});
