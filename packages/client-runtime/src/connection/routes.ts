import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isSharedAddressSpaceHost,
  isTailnetHost,
} from "@supaterm/shared/hostClassification";
import {
  DEFAULT_PUBLIC_RELAY_URL,
  normalizeRelayServerUrl,
  type DesktopSshEnvironmentTarget,
  type EnvironmentId,
  type RelayConnectionInfo,
  type ServerConfig,
} from "@supaterm/contracts";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { BearerConnectionTarget, type ConnectionTarget } from "./model.ts";

export type ConnectionRouteKind =
  | "loopback"
  | "lan"
  | "tailnet"
  | "vpn"
  | "public"
  | "relay"
  | "ssh";

export function connectionRouteId(target: ConnectionTarget): string {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return "primary";
    case "BearerConnectionTarget":
    case "SshConnectionTarget":
      return target.connectionId;
  }
}

export function connectionRoutes(entry: ConnectionCatalogEntry): ReadonlyArray<ConnectionRoute> {
  return [{ target: entry.target, profile: entry.profile }, ...(entry.alternateRoutes ?? [])];
}

export function entryWithRoutes(
  entry: ConnectionCatalogEntry,
  routes: ReadonlyArray<ConnectionRoute>,
): ConnectionCatalogEntry {
  const [first, ...rest] = routes;
  if (first === undefined) throw new Error("A saved environment needs at least one route.");
  const { alternateRoutes: _previous, ...base } = entry;
  return {
    ...base,
    target: first.target,
    profile: first.profile,
    ...(rest.length === 0 ? {} : { alternateRoutes: rest }),
  };
}

export function routeEntry(
  entry: ConnectionCatalogEntry,
  route: ConnectionRoute,
): ConnectionCatalogEntry {
  return entryWithRoutes(entry, [route]);
}

export function routeHttpBaseUrl(route: ConnectionRoute): string | null {
  if (route.target._tag === "PrimaryConnectionTarget") return route.target.httpBaseUrl;
  const profile = Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" ? profile.httpBaseUrl : null;
}

function routeUrl(route: ConnectionRoute): URL | null {
  const httpBaseUrl = routeHttpBaseUrl(route);
  if (httpBaseUrl === null) return null;
  try {
    return new URL(httpBaseUrl);
  } catch {
    return null;
  }
}

function routeHostname(route: ConnectionRoute): string | null {
  return routeUrl(route)?.hostname ?? null;
}

/** The saved routes that reach `httpBaseUrl`'s origin. */
export function routesAt(
  entry: ConnectionCatalogEntry,
  httpBaseUrl: string,
): ReadonlyArray<ConnectionRoute> {
  const origin = new URL(httpBaseUrl).origin;
  return connectionRoutes(entry).filter((route) => routeUrl(route)?.origin === origin);
}

export interface PairingFallback {
  readonly environmentId: EnvironmentId;
  readonly routes: ReadonlyArray<{ readonly httpBaseUrl: string; readonly relayUrl?: string }>;
}

/**
 * The saved addresses to pair through when a pairing link's own address is out
 * of reach, such as a LAN address from cellular. A pairing token is accepted on
 * every address of its server. The link is for the expected environment when
 * the user named one; otherwise its address must already be a route of exactly
 * one saved environment, since a private address can belong to a different
 * machine on each network.
 */
export function pairingFallbackRoutes(
  entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>,
  httpBaseUrl: string,
  expectedEnvironmentId: EnvironmentId | undefined,
): PairingFallback | null {
  const owner =
    expectedEnvironmentId === undefined
      ? onlyEnvironmentAt(entries, httpBaseUrl)
      : entries.get(expectedEnvironmentId);
  if (owner === undefined) return null;
  const linkOrigin = new URL(httpBaseUrl).origin;
  const fallbacks = new Map<string, PairingFallback["routes"][number]>();
  for (const route of connectionRoutes(owner)) {
    const url = routeUrl(route);
    if (url === null || url.origin === linkOrigin || fallbacks.has(url.origin)) continue;
    const profile = Option.getOrNull(route.profile);
    fallbacks.set(url.origin, {
      httpBaseUrl: url.href,
      ...(profile?._tag === "BearerConnectionProfile" && profile.relayUrl !== undefined
        ? { relayUrl: profile.relayUrl }
        : {}),
    });
  }
  return fallbacks.size === 0
    ? null
    : { environmentId: owner.target.environmentId, routes: [...fallbacks.values()] };
}

function onlyEnvironmentAt(
  entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>,
  httpBaseUrl: string,
): ConnectionCatalogEntry | undefined {
  const [owner, ...others] = [...entries.values()].filter(
    (entry) => routesAt(entry, httpBaseUrl).length > 0,
  );
  return others.length === 0 ? owner : undefined;
}

export function connectionRouteKind(route: ConnectionRoute): ConnectionRouteKind {
  switch (route.target._tag) {
    case "SshConnectionTarget":
      return "ssh";
    case "PrimaryConnectionTarget":
    case "BearerConnectionTarget": {
      const url = routeUrl(route);
      if (url === null) return "public";
      try {
        if (canonicalRelayAddress(url.href) !== null) return "relay";
      } catch {
        return "public";
      }
      const hostname = url.hostname;
      if (isLocalLoopbackHost(hostname)) return "loopback";
      const profile = Option.getOrNull(route.profile);
      const tailscale =
        profile?._tag === "BearerConnectionProfile" && profile.network === "tailscale";
      if (tailscale || isTailnetHost(hostname)) return "tailnet";
      if (isSharedAddressSpaceHost(hostname)) return "vpn";
      return isPrivateNetworkHost(hostname) ? "lan" : "public";
    }
  }
}

const ROUTE_KIND_RANK: Record<ConnectionRouteKind, number> = {
  loopback: 0,
  lan: 1,
  tailnet: 2,
  vpn: 2,
  public: 3,
  ssh: 4,
  relay: 5,
};

export function insertRoute(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ReadonlyArray<ConnectionRoute> {
  const rank = ROUTE_KIND_RANK[connectionRouteKind(route)];
  const index = routes.findIndex(
    (existing) => ROUTE_KIND_RANK[connectionRouteKind(existing)] > rank,
  );
  return index === -1
    ? [...routes, route]
    : [...routes.slice(0, index), route, ...routes.slice(index)];
}

export function upsertRoute(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ReadonlyArray<ConnectionRoute> {
  const id = connectionRouteId(route.target);
  return routes.some((existing) => connectionRouteId(existing.target) === id)
    ? routes.map((existing) => (connectionRouteId(existing.target) === id ? route : existing))
    : insertRoute(routes, route);
}

export function findRouteToSameAddress(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ConnectionRoute | undefined {
  const key = routeAddressKey(route);
  return key === null ? undefined : routes.find((existing) => routeAddressKey(existing) === key);
}

function routeAddressKey(route: ConnectionRoute): string | null {
  const profile = Option.getOrNull(route.profile);
  switch (profile?._tag) {
    case "BearerConnectionProfile":
      return `bearer:${profile.httpBaseUrl.replace(/\/+$/, "")}`;
    case "SshConnectionProfile":
      return `ssh:${sshTargetKey(profile.target)}`;
    default:
      return null;
  }
}

export function connectionRouteLabel(route: ConnectionRoute): string {
  switch (connectionRouteKind(route)) {
    case "loopback":
      return "This device";
    case "lan":
      return "LAN";
    case "tailnet":
      return "Tailscale";
    case "vpn":
      return "VPN";
    case "relay":
      return "Encrypted Relay";
    case "ssh": {
      const profile = Option.getOrNull(route.profile);
      return profile?._tag === "SshConnectionProfile"
        ? `SSH ${profile.target.username ? `${profile.target.username}@` : ""}${profile.target.hostname}`
        : "SSH";
    }
    case "public":
      return routeHostname(route) ?? "Remote link";
  }
}

export function connectionRouteAddress(route: ConnectionRoute): string | null {
  if (route.target._tag === "SshConnectionTarget") {
    const profile = Option.getOrNull(route.profile);
    return profile?._tag === "SshConnectionProfile" ? profile.target.alias : null;
  }
  if (connectionRouteKind(route) === "relay") {
    const profile = Option.getOrNull(route.profile);
    const relayUrl = profile?._tag === "BearerConnectionProfile" ? profile.relayUrl : undefined;
    return relayUrl ?? DEFAULT_PUBLIC_RELAY_URL;
  }
  return routeHttpBaseUrl(route);
}

export function advertisedConnectionRoutes(
  config: Pick<ServerConfig, "environment" | "directEndpoints">,
) {
  const { relayEndpoint, relayUrl } = config.environment;
  let relayAdvertisement: RelayConnectionInfo | null | undefined;
  if (relayEndpoint !== undefined && relayUrl !== undefined) {
    relayAdvertisement = { relayEndpoint, relayUrl };
  } else if (relayEndpoint === undefined && relayUrl === undefined) {
    relayAdvertisement = null;
  }
  return { reported: config.directEndpoints, relayAdvertisement };
}

export type ConnectionRouteAdvertisements = ReturnType<typeof advertisedConnectionRoutes>;

function validatedRelayAdvertisement(value: RelayConnectionInfo | null | undefined) {
  if (value === undefined || value === null) return value;
  try {
    const relayEndpoint = canonicalRelayAddress(value.relayEndpoint);
    const relayUrl = normalizeRelayServerUrl(value.relayUrl);
    return relayEndpoint === null || relayUrl === null ? undefined : { relayEndpoint, relayUrl };
  } catch {
    return undefined;
  }
}

const advertisedRouteKey = (url: string) => canonicalRelayAddress(url) ?? url.replace(/\/+$/, "");

export function mergeLearnedRoutes(input: {
  readonly entry: ConnectionCatalogEntry;
  readonly activeRoute: ConnectionRoute;
  readonly reported?: ReadonlyArray<ReportedEndpoint> | undefined;
  readonly relayAdvertisement?: RelayConnectionInfo | null | undefined;
  readonly allowRelay?: boolean;
  readonly allowInsecure: boolean;
}): ReadonlyArray<ConnectionRoute> | null {
  const { entry } = input;
  const active = input.activeRoute.target;
  const saved = connectionRoutes(entry);
  if (active._tag !== "BearerConnectionTarget") return null;
  const sharedCredential = credentialConnectionId(active.connectionId);

  const relay = input.allowRelay
    ? validatedRelayAdvertisement(input.relayAdvertisement)
    : undefined;
  const reported = new Map<string, { readonly url: URL; readonly relayUrl?: string }>();
  const tailscaleOrigins = new Set<string>();
  for (const endpoint of input.reported ?? []) {
    let url: URL;
    try {
      url = new URL(endpoint.httpBaseUrl);
      if (canonicalRelayAddress(url.href) !== null) continue;
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.protocol === "http:" && !input.allowInsecure) continue;
    if (isLocalLoopbackHost(url.hostname)) continue;
    reported.set(url.origin, { url });
    if (endpoint.kind === "tailnet") tailscaleOrigins.add(url.origin);
  }
  if (relay !== undefined && relay !== null) {
    reported.set(relay.relayEndpoint, {
      url: new URL(relay.relayEndpoint),
      relayUrl: relay.relayUrl,
    });
  }
  const known = new Set(
    saved.flatMap((route) => {
      const url = routeHttpBaseUrl(route);
      return url === null || isLearned(route) ? [] : [advertisedRouteKey(url)];
    }),
  );
  const kept = saved.flatMap((route) => {
    const url = routeHttpBaseUrl(route);
    if (!isLearned(route)) {
      return [
        url === null || !reported.has(advertisedRouteKey(url))
          ? route
          : withNetwork(route, tailscaleOrigins.has(advertisedRouteKey(url))),
      ];
    }
    if (url === null) return [];
    const key = advertisedRouteKey(url);
    const isRelay = canonicalRelayAddress(url) !== null;
    if (isRelay ? relay === undefined : input.reported === undefined) {
      known.add(key);
      return [route];
    }
    const advertised = reported.get(key);
    if (advertised === undefined || known.has(key)) return [];
    if (sendsTokenInClear(saved, route, tailscaleOrigins.has(key))) return [];
    known.add(key);
    const profile = Option.getOrNull(route.profile);
    if (
      advertised.relayUrl !== undefined &&
      profile?._tag === "BearerConnectionProfile" &&
      (profile.relayUrl ?? DEFAULT_PUBLIC_RELAY_URL) !== advertised.relayUrl
    ) {
      return [
        {
          ...route,
          profile: Option.some(
            new BearerConnectionProfile({ ...profile, relayUrl: advertised.relayUrl }),
          ),
        },
      ];
    }
    return [withNetwork(route, tailscaleOrigins.has(key))];
  });
  let next: ReadonlyArray<ConnectionRoute> = kept;
  for (const { url, relayUrl } of reported.values()) {
    if (known.has(url.origin)) continue;
    if (
      url.protocol === "http:" &&
      !tailscaleOrigins.has(url.origin) &&
      !tokenAllowsPlainHttp(saved, sharedCredential)
    ) {
      continue;
    }
    const httpBaseUrl = `${url.origin}/`;
    const connectionId = learnedConnectionId(
      entry.target.environmentId,
      url.origin,
      sharedCredential,
    );
    next = insertRoute(next, {
      target: new BearerConnectionTarget({
        environmentId: entry.target.environmentId,
        label: entry.target.label,
        connectionId,
      }),
      profile: Option.some(
        new BearerConnectionProfile({
          connectionId,
          environmentId: entry.target.environmentId,
          label: entry.target.label,
          httpBaseUrl,
          wsBaseUrl: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/`,
          learned: true,
          ...(relayUrl === undefined ? {} : { relayUrl }),
          ...(tailscaleOrigins.has(url.origin) ? { network: "tailscale" as const } : {}),
        }),
      ),
    });
  }
  return Equal.equals(saved, next) ? null : next;
}

// A paired token goes to a plain HTTP address outside the tailnet only when
// it was paired that way, so a token paired over HTTPS, loopback, or the
// tailnet keeps to the transports it was issued for. A token paired over the
// relay is exempt: it is the only credential a relay-paired phone holds, and
// its direct LAN path reuses it.
function tokenAllowsPlainHttp(
  routes: ReadonlyArray<ConnectionRoute>,
  credentialId: string,
): boolean {
  const credentialRoute = routes.find((route) => connectionRouteId(route.target) === credentialId);
  if (credentialRoute === undefined) return false;
  const kind = connectionRouteKind(credentialRoute);
  return (
    kind === "relay" ||
    (routeHttpBaseUrl(credentialRoute)?.startsWith("http:") === true &&
      (kind === "lan" || kind === "public"))
  );
}

/**
 * Whether connecting over `route` would send a paired token over plain HTTP
 * that it wasn't paired over. Checked against the token the route borrows,
 * so a route learned before this rule existed is refused too.
 */
export function sendsTokenInClear(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
  tailscale?: boolean,
): boolean {
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile") return false;
  if ((tailscale ?? profile.network === "tailscale") || !profile.httpBaseUrl.startsWith("http:")) {
    return false;
  }
  const credentialId = credentialConnectionId(connectionRouteId(route.target));
  return (
    credentialId !== connectionRouteId(route.target) && !tokenAllowsPlainHttp(routes, credentialId)
  );
}

/** Routes a connect may use: none sends a paired token over plain HTTP it wasn't paired over. */
export function usableRoutes(entry: ConnectionCatalogEntry): ReadonlyArray<ConnectionRoute> {
  const routes = connectionRoutes(entry);
  return routes.filter((route) => !sendsTokenInClear(routes, route));
}

export interface ReportedEndpoint {
  readonly httpBaseUrl: string;
  readonly kind?: string;
}

function withNetwork(route: ConnectionRoute, tailscale: boolean): ConnectionRoute {
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile") return route;
  if ((profile.network === "tailscale") === tailscale) return route;
  const { network: _network, ...fields } = profile;
  return {
    target: route.target,
    profile: Option.some(
      new BearerConnectionProfile({
        ...fields,
        ...(tailscale ? { network: "tailscale" as const } : {}),
      }),
    ),
  };
}

function learnedConnectionId(
  environmentId: string,
  origin: string,
  sharedCredential: string,
): string {
  return `learned:${environmentId}:${origin}@${sharedCredential}`;
}

export function credentialConnectionId(connectionId: string): string {
  const at = connectionId.indexOf("@");
  return connectionId.startsWith("learned:") && at !== -1
    ? connectionId.slice(at + 1)
    : connectionId;
}

export function isLearned(route: ConnectionRoute): boolean {
  const profile = Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" && profile.learned === true;
}

export function routesAfterRemoving(
  routes: ReadonlyArray<ConnectionRoute>,
  removedId: string,
): ReadonlyArray<ConnectionRoute> {
  const removed = routes.find((route) => connectionRouteId(route.target) === removedId);
  if (removed === undefined) return routes;
  return routes.filter((route) => {
    if (route === removed) return false;
    if (!isLearned(route)) return true;
    return credentialConnectionId(connectionRouteId(route.target)) !== removedId;
  });
}

export function sshTargetKey(target: DesktopSshEnvironmentTarget): string {
  return JSON.stringify([target.alias, target.hostname, target.username, target.port]);
}
