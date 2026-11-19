import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@supaterm/client-runtime/connection";
import { EnvironmentId } from "@supaterm/contracts";
import { isPrivateNetworkHost, isPublicFaviconHost } from "@supaterm/shared/hostClassification";
import { describe, expect, it } from "vite-plus/test";

import { resolveDiscoveredServerUrl, type BrowserTargetEnvironment } from "./browserTargetResolver";

type PreparedConnection = ReturnType<BrowserTargetEnvironment["readPreparedConnection"]>;

function hostEnvironment(
  connection: PreparedConnection,
  options: { readonly isElectron?: boolean; readonly serverBrowser?: boolean } = {},
) {
  return {
    isElectron: options.isElectron ?? false,
    readPreparedConnection: () => connection,
    readEnvironmentSupportsServerBrowser: () => options.serverBrowser ?? false,
  } satisfies BrowserTargetEnvironment;
}

describe("browser target resolver", () => {
  it("resolves relay ports on the host browser and refuses a host without browser support", () => {
    const relay = { httpBaseUrl: "http://127.0.0.1:5774", connectionMethod: "relay" } as const;
    const environmentId = EnvironmentId.make("relay-host");
    expect(() =>
      resolveDiscoveredServerUrl(environmentId, "localhost:5173/app", {
        requireReachable: true,
        environment: hostEnvironment(relay),
      }),
    ).toThrow("browser support on the host");
    expect(
      resolveDiscoveredServerUrl(environmentId, "localhost:5173/app", {
        environment: hostEnvironment(relay),
      }),
    ).toBe("localhost:5173/app");
    expect(
      resolveDiscoveredServerUrl(environmentId, "localhost:5173/app", {
        requireReachable: true,
        environment: hostEnvironment(relay, { serverBrowser: true }),
      }),
    ).toBe("http://localhost:5173/app");
  });

  it("refuses Encrypted Relay hosts until the authenticated gateway exists", () => {
    expect(
      resolveDiscoveredServerUrl(EnvironmentId.make("environment-1"), "http://localhost:5173", {
        environment: hostEnvironment({ httpBaseUrl: "https://relay.example.com" }),
      }),
    ).toBe("http://localhost:5173");
  });

  it("normalizes schemeless localhost server-picker values", () => {
    const environment = hostEnvironment({ httpBaseUrl: "http://localhost:3773" });
    expect(
      resolveDiscoveredServerUrl(EnvironmentId.make("environment-1"), "localhost:5173", {
        environment,
      }),
    ).toBe("http://localhost:5173/");
    expect(
      resolveDiscoveredServerUrl(EnvironmentId.make("environment-1"), "0.0.0.0:3000/app", {
        environment,
      }),
    ).toBe("http://localhost:3000/app");
  });

  it("maps discovered loopback servers onto a remote environment host", () => {
    expect(
      resolveDiscoveredServerUrl(EnvironmentId.make("environment-1"), "localhost:3000/app", {
        environment: hostEnvironment({ httpBaseUrl: "http://192.168.1.25:3773" }),
      }),
    ).toBe("http://192.168.1.25:3000/app");
  });

  it("keeps localhost for servers on the desktop's own WSL or primary backend", () => {
    const environmentId = EnvironmentId.make("environment-1");
    for (const target of [
      new BearerConnectionTarget({ environmentId, label: "WSL", connectionId: "local:wsl:Ubuntu" }),
      new PrimaryConnectionTarget({
        environmentId,
        label: "Primary",
        httpBaseUrl: "http://172.24.66.27:3773",
        wsBaseUrl: "ws://172.24.66.27:3773",
      }),
    ]) {
      expect(
        resolveDiscoveredServerUrl(environmentId, "localhost:3001/", {
          environment: hostEnvironment(
            { httpBaseUrl: "http://172.24.66.27:3773", target },
            { isElectron: true },
          ),
        }),
      ).toBe("http://localhost:3001/");
    }
    expect(
      resolveDiscoveredServerUrl(environmentId, "localhost:3001/", {
        environment: hostEnvironment(
          {
            httpBaseUrl: "http://192.168.1.25:3773",
            target: new BearerConnectionTarget({
              environmentId,
              label: "Remote",
              connectionId: "saved:remote",
            }),
          },
          { isElectron: true },
        ),
      }),
    ).toBe("http://192.168.1.25:3001/");
  });

  it("classifies exact private IPv4 and IPv6 boundaries", async () => {
    const privateHosts = [
      "0.0.0.0",
      "10.0.0.0",
      "10.255.255.255",
      "100.64.0.0",
      "100.127.255.255",
      "127.0.0.0",
      "127.255.255.255",
      "169.254.0.0",
      "169.254.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.0",
      "192.168.255.255",
      "198.18.0.0",
      "198.19.255.255",
      "fc00::",
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::",
      "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "::ffff:192.168.1.1",
      "localhost.",
      "localhost..",
      "devbox.",
      "devbox..",
      "printer.local.",
      "printer.local..",
      "printer.home.arpa.",
      "printer.home.arpa..",
      "devbox.example.ts.net.",
      "devbox.example.ts.net..",
    ];
    const publicHosts = [
      "1.0.0.0",
      "100.63.255.255",
      "100.128.0.0",
      "169.253.255.255",
      "169.255.0.0",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.169.0.0",
      "198.17.255.255",
      "198.20.0.0",
      "fbff:ffff::",
      "fec0::",
      "2001:4860:4860::8888",
      "::ffff:8.8.8.8",
      "example.com.",
    ];
    expect(privateHosts.filter((host) => !isPrivateNetworkHost(host))).toEqual([]);
    expect(publicHosts.filter(isPrivateNetworkHost)).toEqual([]);
  });

  it("allows only globally routable hosts to reach a public favicon provider", async () => {
    const nonPublic = [
      "192.0.0.0",
      "192.0.0.255",
      "192.0.2.0",
      "192.0.2.255",
      "192.88.99.0",
      "192.88.99.255",
      "198.51.100.0",
      "198.51.100.255",
      "203.0.113.0",
      "203.0.113.255",
      "224.0.0.0",
      "255.255.255.255",
      "::2",
      "100::",
      "100::ffff:ffff:ffff:ffff",
      "100:0:0:1::",
      "100:0:0:1:ffff:ffff:ffff:ffff",
      "64:ff9b:1::1",
      "64:ff9b::a00:1",
      "64:ff9b::7f00:1",
      "64:ff9b::c0a8:101",
      "64:ff9b::c000:201",
      "2001:5::1",
      "2001:2::",
      "2001:2:0:ffff:ffff:ffff:ffff:ffff",
      "2001:db8::",
      "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
      "3fff::",
      "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
      "5f00::1",
      "fec0::",
      "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "::ffff:192.0.2.1",
      "app.test",
      "app.test..",
      "printer.local..",
      "printer.home.arpa..",
      "devbox.example.ts.net..",
      "127.0.0.1..",
      "127.1..",
      "10.1..",
      "172.16.1..",
      "192.168.1..",
      "service.internal",
      "hidden.onion",
    ];
    const publicHosts = [
      "191.255.255.255",
      "192.0.1.255",
      "192.0.3.0",
      "198.51.99.255",
      "198.51.101.0",
      "203.0.112.255",
      "203.0.114.0",
      "223.255.255.255",
      "1.1.1.1",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
      "64:ff9b::808:808",
      "2001:1::1",
      "2001:3::1",
      "2001:4:112::1",
      "2001:20::1",
      "2001:30::1",
      "::ffff:8.8.8.8",
      "example.com",
      "example.com.",
    ];
    expect(nonPublic.filter(isPublicFaviconHost)).toEqual([]);
    expect(publicHosts.filter((host) => !isPublicFaviconHost(host))).toEqual([]);
  });
});
