import type { AdvertisedEndpoint, DesktopWslState } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { buildPairingUrl } from "@supaterm/shared/remote";
import {
  applyWslEnableSelection,
  selectQrEndpointOption,
  togglePairingScopeSelection,
  resolvePairingLinkRoutes,
  resolveTailscaleHttpsRow,
  createRelayPairingEndpoint,
} from "./ConnectionsSettings.logic";

it("shares the confirmed relay route before its status subscription arrives", () => {
  const relay = {
    relayEndpoint: `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`,
    relayUrl: "wss://custom-relay.invalid",
  };
  const settings = { publicRelayEnabled: true, publicRelayUrl: relay.relayUrl };
  const { endpoints, pairingHints } = resolvePairingLinkRoutes([], {}, relay, settings);
  const endpoint = endpoints[0];
  if (!endpoint) throw new Error("The prepared relay must be shareable.");
  const url = new URL(buildPairingUrl(endpoint.httpBaseUrl, "test-credential", pairingHints));
  expect(url.origin).toBe(new URL(relay.relayEndpoint).origin);
  expect(new URLSearchParams(url.hash.slice(1)).get("relay")).toBe(relay.relayUrl);
  expect(resolvePairingLinkRoutes(endpoints, {}, relay, settings).endpoints).toHaveLength(1);
  expect(resolvePairingLinkRoutes([], {}, undefined, settings).endpoints).toEqual([]);
});

describe("togglePairingScopeSelection", () => {
  it.each([
    {
      label: "adds terminal:read when terminal:operate is selected",
      current: ["orchestration:read"],
      scope: "terminal:operate",
      checked: true,
      expected: ["orchestration:read", "terminal:operate", "terminal:read"],
    },
    {
      label: "drops terminal:operate when terminal:read is cleared",
      current: ["terminal:read", "terminal:operate", "preview:operate"],
      scope: "terminal:read",
      checked: false,
      expected: ["preview:operate"],
    },
    {
      label: "keeps terminal:read when terminal:operate is cleared",
      current: ["terminal:read", "terminal:operate"],
      scope: "terminal:operate",
      checked: false,
      expected: ["terminal:read"],
    },
    {
      label: "toggles unrelated scopes on their own",
      current: ["terminal:read"],
      scope: "filesystem:read",
      checked: true,
      expected: ["terminal:read", "filesystem:read"],
    },
  ] as const)("$label", ({ current, scope, checked, expected }) => {
    expect(togglePairingScopeSelection(current, scope, checked)).toEqual(expected);
  });
});

const baseWslState: DesktopWslState = {
  enabled: false,
  distro: null,
  available: true,
  wslOnly: true,
  distros: [],
  preflightError: null,
};

describe("applyWslEnableSelection", () => {
  it("clears WSL-only and updates the distro before enabling both backends", async () => {
    const calls: Array<string> = [];
    let persistedWslOnly = true;
    let persistedDistro: string | null = "Ubuntu";
    const setWslDistro = vi.fn(async (distro: string | null) => {
      calls.push(`setWslDistro:${distro ?? "default"}`);
      persistedDistro = distro;
      return { ...baseWslState, distro, wslOnly: persistedWslOnly };
    });
    const setWslBackendEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslBackendEnabled:${enabled}`);
      return {
        ...baseWslState,
        enabled,
        distro: persistedDistro,
        wslOnly: persistedWslOnly,
      };
    });
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslOnly:${enabled}`);
      persistedWslOnly = enabled;
      return { ...baseWslState, distro: persistedDistro, wslOnly: enabled };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "both",
      nextDistro: "Debian",
      persistedDistro: "Ubuntu",
    });

    expect(calls).toEqual(["setWslOnly:false", "setWslDistro:Debian", "setWslBackendEnabled:true"]);
    expect(state).toMatchObject({ enabled: true, distro: "Debian", wslOnly: false });
  });
});

function makeEndpoint(overrides: Partial<AdvertisedEndpoint>): AdvertisedEndpoint {
  return {
    id: "desktop-lan:http://192.168.1.42:4780",
    label: "Local network",
    provider: { id: "desktop-core", label: "Desktop", kind: "core", isAddon: false },
    httpBaseUrl: "http://192.168.1.42:4780",
    wsBaseUrl: "ws://192.168.1.42:4780",
    reachability: "lan",
    compatibility: { hostedHttpsApp: "unknown", desktopApp: "compatible" },
    source: "desktop-core",
    status: "available",
    ...overrides,
  };
}

describe("selectQrEndpointOption", () => {
  const options = [
    {
      id: "desktop-loopback:4780",
      preferenceKey: "desktop-core:loopback:http",
      qrShareable: false,
    },
    {
      id: "tailscale-ip:http://100.84.12.7:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "tailscale-ip:http://100.84.12.8:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "desktop-lan:http://192.168.1.42:4780",
      preferenceKey: "desktop-core:lan:http",
      qrShareable: true,
    },
  ];

  it("resolves an explicit selection by unique endpoint id, not the shared preference key", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:http://100.84.12.8:4780", null)?.id).toBe(
      "tailscale-ip:http://100.84.12.8:4780",
    );
  });

  it("skips non-QR-shareable options in the fallback so the panel never opens on loopback", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:gone", "nope")?.id).toBe(
      "tailscale-ip:http://100.84.12.7:4780",
    );
  });
});

it("uses current routing when the relay server changes after link creation", () => {
  const prepared = {
    relayEndpoint: "https://relay.supaterm.alt/",
    relayUrl: "wss://old-relay.invalid",
  };
  const settings = { publicRelayEnabled: true, publicRelayUrl: "wss://new-relay.invalid" };
  const currentHints = { relayUrl: settings.publicRelayUrl };
  const live = [createRelayPairingEndpoint(prepared.relayEndpoint)];
  expect(
    resolvePairingLinkRoutes(live, currentHints, prepared, settings).pairingHints.relayUrl,
  ).toBe(settings.publicRelayUrl);
  expect(resolvePairingLinkRoutes([], currentHints, prepared, settings).endpoints).toEqual([]);
  expect(
    resolvePairingLinkRoutes([], {}, prepared, { ...settings, publicRelayEnabled: false })
      .endpoints,
  ).toEqual([]);
});

describe("resolveTailscaleHttpsRow", () => {
  const endpoint = makeEndpoint({
    id: "tailscale-magicdns:https://machine.tailnet.ts.net",
    label: "Tailscale HTTPS",
    httpBaseUrl: "https://machine.tailnet.ts.net",
    reachability: "private-network",
  });

  it("offers setup before Tailscale has reported a MagicDNS name", () => {
    expect(resolveTailscaleHttpsRow({ endpoint: null, serveEnabled: false })).toEqual({
      description: "Use Tailscale Serve to expose this backend through a MagicDNS HTTPS URL.",
      unreachable: false,
    });
  });

  it("asks to start Tailscale when Serve is on but no MagicDNS name is reported", () => {
    expect(resolveTailscaleHttpsRow({ endpoint: null, serveEnabled: true })).toEqual({
      description: "Start Tailscale to set up HTTPS access through MagicDNS.",
      unreachable: false,
    });
  });

  it("shows the URL and flags it when this machine cannot reach it", () => {
    expect(
      resolveTailscaleHttpsRow({
        endpoint: { ...endpoint, status: "unavailable" },
        serveEnabled: true,
      }),
    ).toEqual({ description: endpoint.httpBaseUrl, unreachable: true });
  });
});
