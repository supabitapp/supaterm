import {
  DEFAULT_PUBLIC_RELAY_URL,
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  type ConnectionRoute,
  SshConnectionTarget,
} from "./index.ts";
import {
  advertisedConnectionRoutes,
  credentialConnectionId,
  connectionRouteAddress,
  connectionRouteId,
  connectionRouteKind,
  connectionRouteLabel,
  entryWithRoutes,
  insertRoute,
  isLearned,
  mergeLearnedRoutes,
  pairingFallbackRoutes,
  routesAfterRemoving,
  routeHttpBaseUrl,
  sendsTokenInClear,
  usableRoutes,
} from "./routes.ts";

const environmentId = EnvironmentId.make("environment-routes");
const credential = "bearer:environment-routes";

function route(
  httpBaseUrl: string,
  connectionId = credential,
  environment = environmentId,
): ConnectionRoute {
  const target = new BearerConnectionTarget({
    environmentId: environment,
    label: "Remote",
    connectionId,
  });
  return {
    target,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId,
        environmentId: environment,
        label: "Remote",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}

describe("connection routes", () => {
  it("orders LAN ahead of VPN and public routes", () => {
    const publicRoute = route("https://remote.example.test", "public");
    const vpnRoute = route("http://100.100.10.2:4389", "vpn");
    const lanRoute = route("http://192.168.1.20:4389", "lan");
    expect(connectionRouteKind(lanRoute)).toBe("lan");
    expect(connectionRouteKind(vpnRoute)).toBe("vpn");
    expect(
      insertRoute(insertRoute([publicRoute], vpnRoute), lanRoute).map((item) =>
        connectionRouteKind(item),
      ),
    ).toEqual(["lan", "vpn", "public"]);
  });

  it("learns both direct endpoint kinds while reusing the paired credential", () => {
    const active = route("http://192.168.1.30:4389");
    const entry = entryWithRoutes(
      { target: active.target, profile: active.profile, enabled: true },
      [active],
    );
    const learned = mergeLearnedRoutes({
      entry,
      activeRoute: active,
      reported: [
        { httpBaseUrl: "http://192.168.1.20:4389/" },
        { httpBaseUrl: "http://100.100.10.2:4389/" },
      ],
      allowInsecure: true,
    });
    expect(learned).not.toBeNull();
    expect(learned).toHaveLength(3);
    const learnedRoutes = learned?.filter(isLearned) ?? [];
    expect(learnedRoutes).toHaveLength(2);
    expect(
      learnedRoutes.map((item) =>
        item.target._tag === "BearerConnectionTarget" ? item.target.connectionId : "",
      ),
    ).toEqual([
      "learned:environment-routes:http://192.168.1.20:4389@bearer:environment-routes",
      "learned:environment-routes:http://100.100.10.2:4389@bearer:environment-routes",
    ]);
  });

  it.each([true, false])(
    "preserves custom relay configuration when tailnet provenance becomes %s",
    (tailscale) => {
      const paired = route("http://100.100.10.2:4389");
      const profile = Option.getOrThrow(paired.profile);
      if (profile._tag !== "BearerConnectionProfile") throw new Error("Expected bearer profile");
      const active: ConnectionRoute = {
        target: paired.target,
        profile: Option.some(
          new BearerConnectionProfile({
            ...profile,
            relayUrl: "https://custom-relay.example.test",
            ...(tailscale ? {} : { network: "tailscale" as const }),
          }),
        ),
      };
      const updated = mergeLearnedRoutes({
        entry: { target: active.target, profile: active.profile, enabled: true },
        activeRoute: active,
        reported: [
          { httpBaseUrl: "http://100.100.10.2:4389", kind: tailscale ? "tailnet" : "vpn" },
        ],
        allowInsecure: true,
      });
      expect(updated).not.toBeNull();
      const next = Option.getOrThrow(updated![0]!.profile);
      expect(next._tag).toBe("BearerConnectionProfile");
      if (next._tag !== "BearerConnectionProfile") throw new Error("Expected bearer profile");
      expect(next.relayUrl).toBe("https://custom-relay.example.test");
      expect(next.network).toBe(tailscale ? "tailscale" : undefined);
    },
  );

  it("drops learned routes when the paired route is removed", () => {
    const active = route("http://192.168.1.30:4389");
    const learned = mergeLearnedRoutes({
      entry: { target: active.target, profile: active.profile, enabled: true },
      activeRoute: active,
      reported: [{ httpBaseUrl: "http://192.168.1.20:4389/" }],
      allowInsecure: true,
    })!;
    const learnedRoute = learned.find(isLearned)!;
    expect(
      routesAfterRemoving(
        learned,
        learnedRoute.target._tag === "BearerConnectionTarget"
          ? learnedRoute.target.connectionId
          : "",
      ),
    ).toHaveLength(1);
    expect(routesAfterRemoving(learned, credential)).toHaveLength(0);
  });

  it("offers the other addresses of the saved environment a pairing link points at", () => {
    const tailnet = route("https://minim5.tail.ts.net/", "tailnet");
    const lan = route("http://192.168.1.20:4389/", "learned-lan");
    const ssh: ConnectionRoute = {
      target: new SshConnectionTarget({ environmentId, label: "Remote", connectionId: "ssh" }),
      profile: Option.none(),
    };
    const entry = entryWithRoutes(
      { target: tailnet.target, profile: tailnet.profile, enabled: true },
      [lan, tailnet, route("https://minim5.tail.ts.net/other-path/", "tailnet-duplicate"), ssh],
    );
    const entries = new Map([[environmentId, entry]]);

    expect(pairingFallbackRoutes(entries, "http://192.168.1.20:4389/", undefined)).toEqual({
      environmentId,
      routes: [{ httpBaseUrl: "https://minim5.tail.ts.net/" }],
    });
    expect(pairingFallbackRoutes(entries, "http://192.168.1.30:4389/", undefined)).toBeNull();
  });

  it("offers no fallback when two saved environments share the address", () => {
    const lan = route("http://192.168.1.20:4389/", "lan");
    const home = entryWithRoutes({ target: lan.target, profile: lan.profile, enabled: true }, [
      lan,
      route("https://minim5.tail.ts.net/", "tailnet"),
    ]);
    const officeId = EnvironmentId.make("environment-office");
    const officeLan = route("http://192.168.1.20:4389/", "office-lan", officeId);
    const office = { target: officeLan.target, profile: officeLan.profile, enabled: true };

    expect(
      pairingFallbackRoutes(
        new Map([[environmentId, home]]),
        "http://192.168.1.20:4389/",
        undefined,
      ),
    ).not.toBeNull();
    expect(
      pairingFallbackRoutes(
        new Map([
          [environmentId, home],
          [officeId, office],
        ]),
        "http://192.168.1.20:4389/",
        undefined,
      ),
    ).toBeNull();
  });

  it("pairs a route added to a named environment through its saved addresses", () => {
    const tailnet = route("https://minim5.tail.ts.net/", "tailnet");
    const entry = { target: tailnet.target, profile: tailnet.profile, enabled: true };
    const entries = new Map([[environmentId, entry]]);

    expect(pairingFallbackRoutes(entries, "http://192.168.1.99:4389/", undefined)).toBeNull();
    expect(pairingFallbackRoutes(entries, "http://192.168.1.99:4389/", environmentId)).toEqual({
      environmentId,
      routes: [{ httpBaseUrl: "https://minim5.tail.ts.net/" }],
    });
  });
});

const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
const relayAdvertisement = { relayEndpoint, relayUrl: "wss://relay.example.test" };
const active = route("http://192.168.1.20:4389/");
const baseEntry = { ...active, enabled: true };
const learnRelay = (overrides: Partial<Parameters<typeof mergeLearnedRoutes>[0]> = {}) =>
  mergeLearnedRoutes({
    entry: baseEntry,
    activeRoute: active,
    allowInsecure: true,
    allowRelay: true,
    relayAdvertisement,
    ...overrides,
  });

describe("relay route advertisements", () => {
  it.each([undefined, "wss://custom-relay.example.test/relay"])(
    "displays the encrypted relay server while retaining the host identity: %s",
    (relayUrl) => {
      const relay = route(relayEndpoint);
      const profile = Option.getOrThrow(relay.profile);
      if (profile._tag !== "BearerConnectionProfile") throw new Error("Expected bearer profile");
      const saved = {
        ...relay,
        profile: Option.some(
          new BearerConnectionProfile({
            ...profile,
            ...(relayUrl === undefined ? {} : { relayUrl }),
          }),
        ),
      };

      expect(connectionRouteKind(saved)).toBe("relay");
      expect(connectionRouteLabel(saved)).toBe("Encrypted Relay");
      expect(connectionRouteAddress(saved)).toBe(relayUrl ?? DEFAULT_PUBLIC_RELAY_URL);
      expect(routeHttpBaseUrl(saved)).toBe(relayEndpoint);
    },
  );

  it("keeps relay after direct and SSH routes", () => {
    const relay = route(relayEndpoint);
    const direct = route("http://192.168.1.20:4389/", "lan");
    const publicRoute = route("https://remote.example.test", "public");
    const ssh = {
      target: new SshConnectionTarget({ environmentId, label: "SSH", connectionId: "ssh" }),
      profile: Option.none(),
    };

    expect(insertRoute([direct, publicRoute, ssh], relay)).toEqual([
      direct,
      publicRoute,
      ssh,
      relay,
    ]);
    expect(insertRoute(insertRoute([relay], ssh), publicRoute)).toEqual([publicRoute, ssh, relay]);
  });

  it("does not identify ordinary or malformed public addresses as encrypted relay", () => {
    const ordinary = route("https://remote.example.test");
    const malformed = route("https://bad.relay.supaterm.alt");

    expect(connectionRouteKind(ordinary)).toBe("public");
    expect(connectionRouteAddress(ordinary)).toBe("https://remote.example.test");
    expect(connectionRouteKind(malformed)).toBe("public");
  });

  it("learns relay after direct routes with the existing credential and custom server", () => {
    const routes = learnRelay({
      reported: [{ httpBaseUrl: "http://100.100.10.2:4389/", kind: "tailnet" }],
    })!;
    expect(routes.map(connectionRouteKind)).toEqual(["lan", "tailnet", "relay"]);
    expect(credentialConnectionId(connectionRouteId(routes[2]!.target))).toBe(credential);
    expect(Option.getOrThrow(routes[2]!.profile)).toMatchObject({
      httpBaseUrl: relayEndpoint,
      relayUrl: relayAdvertisement.relayUrl,
      learned: true,
    });
    expect(
      learnRelay({
        entry: entryWithRoutes(baseEntry, routes),
        reported: [{ httpBaseUrl: "http://100.100.10.2:4389/", kind: "tailnet" }],
      }),
    ).toBeNull();
  });

  it("updates a learned relay URL in place without resetting route preference or credential", () => {
    const learned = learnRelay()![1]!;
    const entry = entryWithRoutes(baseEntry, [learned, active]);
    const updated = learnRelay({
      entry,
      relayAdvertisement: { ...relayAdvertisement, relayUrl: "wss://next.example.test/relay/" },
    })!;
    expect(updated.map((route) => route.target)).toEqual([learned.target, active.target]);
    expect(Option.getOrThrow(updated[0]!.profile)).toMatchObject({
      relayUrl: "wss://next.example.test/relay",
    });
  });

  it.each([
    undefined,
    { relayEndpoint: "https://ordinary.example.test", relayUrl: "wss://relay.example.test" },
    { relayEndpoint: "https://bad.relay.supaterm.alt", relayUrl: "wss://relay.example.test" },
    { relayEndpoint, relayUrl: "https://relay.example.test" },
  ])("preserves learned relay for unknown or malformed advertisements: %j", (advertisement) => {
    const routes = learnRelay()!;
    expect(
      learnRelay({ entry: entryWithRoutes(baseEntry, routes), relayAdvertisement: advertisement }),
    ).toBeNull();
  });

  it("withdraws only learned relay while retaining direct routes and explicit relay routes", () => {
    const routes = learnRelay({
      reported: [{ httpBaseUrl: "http://100.100.10.2:4389/", kind: "tailnet" }],
    })!;
    const explicit = route(relayEndpoint, "explicit-relay");
    const next = learnRelay({
      entry: entryWithRoutes(baseEntry, [...routes, explicit]),
      relayAdvertisement: null,
    })!;
    expect(next).toEqual([routes[0], routes[1], explicit]);
    expect(routesAfterRemoving(routes, credential)).toEqual([]);
  });

  it("preserves explicit relay metadata and avoids duplicating the same relay identity", () => {
    const explicit = route(relayEndpoint, "explicit-relay");
    expect(learnRelay({ entry: entryWithRoutes(baseEntry, [active, explicit]) })).toBeNull();
  });

  it("does not learn relay on unsupported clients and preserves previously saved relay", () => {
    expect(learnRelay({ allowRelay: false })).toBeNull();
    expect(
      learnRelay({
        entry: entryWithRoutes(baseEntry, learnRelay()!),
        allowRelay: false,
        relayAdvertisement: null,
      }),
    ).toBeNull();
  });

  it("keeps direct and relay advertisements independent", () => {
    const routes = learnRelay({
      reported: [{ httpBaseUrl: "http://100.100.10.2:4389/", kind: "tailnet" }],
    })!;
    expect(
      learnRelay({
        entry: entryWithRoutes(baseEntry, routes),
        reported: [],
        relayAdvertisement: undefined,
      }),
    ).toEqual([routes[0], routes[2]]);
    expect(
      learnRelay({ reported: [{ httpBaseUrl: relayEndpoint }], relayAdvertisement: undefined }),
    ).toBeNull();
  });

  it("treats missing relay fields as withdrawn and partial fields as unknown", () => {
    const environment = {
      environmentId,
      label: "Test",
      platform: { os: "linux", arch: "x64" } as const,
      serverVersion: "test",
      orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      capabilities: {},
    };
    expect(advertisedConnectionRoutes({ environment }).relayAdvertisement).toBeNull();
    expect(
      advertisedConnectionRoutes({ environment: { ...environment, ...relayAdvertisement } })
        .relayAdvertisement,
    ).toEqual(relayAdvertisement);
    expect(
      advertisedConnectionRoutes({ environment: { ...environment, relayEndpoint } })
        .relayAdvertisement,
    ).toBeUndefined();
  });
});

describe("plain HTTP learned routes", () => {
  const LAN = route("http://192.168.1.10:3773/", "lan");
  const PUBLIC = route("https://desk.example.com/", "public");
  const RELAY = route(relayEndpoint, "relay");
  const base = { target: PUBLIC.target, profile: PUBLIC.profile, enabled: true };
  const ids = (routes: ReadonlyArray<ConnectionRoute> | null) =>
    routes?.map((item) => connectionRouteId(item.target)) ?? null;
  const learnedRoute = (connectionId: string, httpBaseUrl: string): ConnectionRoute => {
    const plain = route(httpBaseUrl, connectionId);
    const profile = Option.getOrThrow(plain.profile);
    if (profile._tag !== "BearerConnectionProfile") throw new Error("Expected bearer profile");
    return {
      target: plain.target,
      profile: Option.some(new BearerConnectionProfile({ ...profile, learned: true })),
    };
  };

  it("keeps a token paired over HTTPS off plain HTTP addresses outside the tailnet", () => {
    const routes = mergeLearnedRoutes({
      entry: entryWithRoutes(base, [PUBLIC]),
      activeRoute: PUBLIC,
      reported: [
        { kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" },
        { kind: "tailnet", httpBaseUrl: "http://100.101.102.103:3773/" },
        { kind: "tailnet", httpBaseUrl: "https://desk.tail1234.ts.net/" },
      ],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual([
      `learned:${environmentId}:http://100.101.102.103:3773@public`,
      `learned:${environmentId}:https://desk.tail1234.ts.net@public`,
      "public",
    ]);
  });

  it("keeps plain HTTP routes that don't borrow the active HTTPS-paired token", () => {
    const lanOrigin = "http://10.0.0.42:3773";
    const overLan = learnedRoute(`learned:${environmentId}:${lanOrigin}@lan`, `${lanOrigin}/`);
    const routes = mergeLearnedRoutes({
      entry: entryWithRoutes(base, [overLan, LAN, PUBLIC]),
      activeRoute: PUBLIC,
      reported: [{ kind: "lan", httpBaseUrl: `${lanOrigin}/` }],
      allowInsecure: true,
    });
    expect(routes).toBeNull();
  });

  it("learns plain HTTP LAN addresses over a token paired over plain HTTP", () => {
    const routes = mergeLearnedRoutes({
      entry: entryWithRoutes(base, [LAN, RELAY]),
      activeRoute: LAN,
      reported: [{ kind: "lan", httpBaseUrl: "http://10.0.0.42:3773/" }],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual([
      "lan",
      `learned:${environmentId}:http://10.0.0.42:3773@lan`,
      "relay",
    ]);
  });

  it("lets a token paired over the relay reach plain HTTP LAN addresses", () => {
    const lanOrigin = "http://10.0.0.42:3773";
    const stale = learnedRoute(`learned:${environmentId}:${lanOrigin}@public`, `${lanOrigin}/`);
    const overRelay = learnedRoute(`learned:${environmentId}:${lanOrigin}@relay`, `${lanOrigin}/`);
    const entry = entryWithRoutes(base, [stale, PUBLIC, RELAY]);
    expect(ids(usableRoutes(entry))).toEqual(["public", "relay"]);
    const routes = mergeLearnedRoutes({
      entry,
      activeRoute: RELAY,
      reported: [{ kind: "lan", httpBaseUrl: `${lanOrigin}/` }],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual([`learned:${environmentId}:${lanOrigin}@relay`, "public", "relay"]);
    expect(sendsTokenInClear([overRelay, RELAY], overRelay)).toBe(false);
    expect(ids(usableRoutes(entryWithRoutes(base, [overRelay, RELAY])))).toEqual([
      `learned:${environmentId}:${lanOrigin}@relay`,
      "relay",
    ]);
  });
});
