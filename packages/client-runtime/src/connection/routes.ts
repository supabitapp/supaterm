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
  type ServerTunnelEndpoints,
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

export function connectionRouteId(target: ConnectionTarget): string;
export function connectionRouteId(target: ConnectionTarget) {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return "primary" satisfies string;
    case "BearerConnectionTarget":
    case "SshConnectionTarget":
      return target.connectionId satisfies string;
  }
}

export function connectionRoutes(entry: ConnectionCatalogEntry): ReadonlyArray<ConnectionRoute>;
export function connectionRoutes(entry: ConnectionCatalogEntry) {
  return [
    { target: entry.target, profile: entry.profile },
    ...(entry.alternateRoutes ?? []),
  ] satisfies ReadonlyArray<ConnectionRoute>;
}

export function entryWithRoutes(
  entry: ConnectionCatalogEntry,
  routes: ReadonlyArray<ConnectionRoute>,
): ConnectionCatalogEntry;
export function entryWithRoutes(
  entry: ConnectionCatalogEntry,
  routes: ReadonlyArray<ConnectionRoute>,
) {
  const [first, ...rest] = routes;
  if (first === undefined) throw new Error("A saved environment needs at least one route.");
  const { alternateRoutes: _previous, ...base } = entry;
  return {
    ...base,
    target: first.target,
    profile: first.profile,
    ...(rest.length === 0 ? {} : { alternateRoutes: rest }),
  } satisfies ConnectionCatalogEntry;
}

export function routeEntry(
  entry: ConnectionCatalogEntry,
  route: ConnectionRoute,
): ConnectionCatalogEntry;
export function routeEntry(entry: ConnectionCatalogEntry, route: ConnectionRoute) {
  return entryWithRoutes(entry, [route]) satisfies ConnectionCatalogEntry;
}

export function routeHttpBaseUrl(route: ConnectionRoute): string | null;
export function routeHttpBaseUrl(route: ConnectionRoute) {
  if (route.target._tag === "PrimaryConnectionTarget")
    return route.target.httpBaseUrl satisfies string | null;
  const profile = Option.getOrNull(route.profile);
  return (profile?._tag === "BearerConnectionProfile" ? profile.httpBaseUrl : null) satisfies
    | string
    | null;
}

function routeUrl(route: ConnectionRoute) {
  const httpBaseUrl = routeHttpBaseUrl(route);
  if (httpBaseUrl === null) return null;
  try {
    return new URL(httpBaseUrl);
  } catch {
    return null;
  }
}

function routeHostname(route: ConnectionRoute) {
  return routeUrl(route)?.hostname ?? null;
}

/** The saved routes that reach `httpBaseUrl`'s origin. */
export function routesAt(entry: ConnectionCatalogEntry, httpBaseUrl: string) {
  const origin = new URL(httpBaseUrl).origin;
  return connectionRoutes(entry).filter((route) => routeUrl(route)?.origin === origin);
}

export interface PairingFallback {
  readonly environmentId: EnvironmentId;
  readonly routes: ReadonlyArray<{
    readonly httpBaseUrl: string;
    readonly relayUrl?: string;
    readonly directTunnelUrls?: ReadonlyArray<string>;
  }>;
}

/**
 * Saved addresses to pair through when the link's own is out of reach (a LAN
 * address from cellular); a token is accepted on every address of its server.
 * Without a named environment, the link's address must route to exactly one
 * saved environment, since a private address can be a different machine per network.
 */
export function pairingFallbackRoutes(
  entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>,
  httpBaseUrl: string,
  expectedEnvironmentId: EnvironmentId | undefined,
) {
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
      ...(profile?._tag === "BearerConnectionProfile"
        ? {
            ...(profile.relayUrl === undefined ? {} : { relayUrl: profile.relayUrl }),
            ...(profile.directTunnelUrls === undefined
              ? {}
              : { directTunnelUrls: profile.directTunnelUrls }),
          }
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
) {
  const [owner, ...others] = [...entries.values()].filter(
    (entry) => routesAt(entry, httpBaseUrl).length > 0,
  );
  return others.length === 0 ? owner : undefined;
}

const isTailnetAddress = (hostname: string) =>
  isTailnetHost(hostname) || isSharedAddressSpaceHost(hostname);

function labelledTailscale(route: ConnectionRoute) {
  const profile = Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" && profile.network === "tailscale";
}

function directAddressKind(hostname: string, tailscale = false) {
  if (isLocalLoopbackHost(hostname)) return "loopback";
  if (isTailnetHost(hostname) || (tailscale && isTailnetAddress(hostname))) return "tailnet";
  if (isSharedAddressSpaceHost(hostname)) return "vpn";
  return isPrivateNetworkHost(hostname) ? "lan" : "public";
}

export function connectionRouteKind(route: ConnectionRoute): ConnectionRouteKind;
export function connectionRouteKind(route: ConnectionRoute) {
  switch (route.target._tag) {
    case "SshConnectionTarget":
      return "ssh" satisfies ConnectionRouteKind;
    case "PrimaryConnectionTarget":
    case "BearerConnectionTarget": {
      const url = routeUrl(route);
      if (url === null) return "public" satisfies ConnectionRouteKind;
      try {
        if (canonicalRelayAddress(url.href) !== null) return "relay" satisfies ConnectionRouteKind;
      } catch {
        return "public" satisfies ConnectionRouteKind;
      }
      return directAddressKind(
        url.hostname,
        labelledTailscale(route),
      ) satisfies ConnectionRouteKind;
    }
  }
}

/**
 * Whether the route's address reaches the same machine on every network: TLS
 * proves who answers, and loopback cannot move. Any other plain http address,
 * a tailnet one too once Tailscale is down, can belong to another machine after
 * a network change, so an answer from it is not kept.
 */
export function routeKeepsItsHost(route: ConnectionRoute): boolean;
export function routeKeepsItsHost(route: ConnectionRoute) {
  if (routeHttpBaseUrl(route)?.startsWith("https:") === true) return true satisfies boolean;
  return (connectionRouteKind(route) === "loopback") satisfies boolean;
}

/** A loopback or LAN host answers within a few seconds or is not there. */
export function isNearbyAddress(httpBaseUrl: string) {
  try {
    const kind = directAddressKind(new URL(httpBaseUrl).hostname);
    return kind === "loopback" || kind === "lan";
  } catch {
    return false;
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
  { aheadOfSameKind = false }: { readonly aheadOfSameKind?: boolean } = {},
) {
  const kind = connectionRouteKind(route);
  const rank = ROUTE_KIND_RANK[kind];
  const index = routes.findIndex((existing) => {
    const existingKind = connectionRouteKind(existing);
    return ROUTE_KIND_RANK[existingKind] > rank || (aheadOfSameKind && existingKind === kind);
  });
  return index === -1
    ? [...routes, route]
    : [...routes.slice(0, index), route, ...routes.slice(index)];
}

export function upsertRoute(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ReadonlyArray<ConnectionRoute>;
export function upsertRoute(routes: ReadonlyArray<ConnectionRoute>, route: ConnectionRoute) {
  const id = connectionRouteId(route.target);
  return (
    routes.some((existing) => connectionRouteId(existing.target) === id)
      ? routes.map((existing) => (connectionRouteId(existing.target) === id ? route : existing))
      : insertRoute(routes, route, { aheadOfSameKind: true })
  ) satisfies ReadonlyArray<ConnectionRoute>;
}

export function findRouteToSameAddress(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ConnectionRoute | undefined;
export function findRouteToSameAddress(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
) {
  const key = routeAddressKey(route);
  return (
    key === null ? undefined : routes.find((existing) => routeAddressKey(existing) === key)
  ) satisfies ConnectionRoute | undefined;
}

function routeAddressKey(route: ConnectionRoute) {
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

export function connectionRouteLabel(route: ConnectionRoute) {
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

export function connectionRouteAddress(route: ConnectionRoute) {
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

export const hasSavedBearerRoute = (entry: ConnectionCatalogEntry) =>
  connectionRoutes(entry).some((r) => !isLearned(r) && r.target._tag === "BearerConnectionTarget");

export function advertisedConnectionRoutes(
  config: Pick<ServerConfig, "environment" | "directEndpoints" | "tunnelEndpoints">,
) {
  const { relayEndpoint, relayUrl } = config.environment;
  let relayAdvertisement: RelayConnectionInfo | null | undefined;
  if (relayEndpoint !== undefined && relayUrl !== undefined) {
    relayAdvertisement = { relayEndpoint, relayUrl };
  } else if (relayEndpoint === undefined && relayUrl === undefined) {
    relayAdvertisement = null;
  }
  return {
    reported: config.directEndpoints,
    relayAdvertisement,
    tunnelEndpoints: config.tunnelEndpoints ?? null,
  };
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

function relayIdentity(address: string) {
  try {
    return canonicalRelayAddress(address);
  } catch {
    return null;
  }
}

export function mergeLearnedRoutes(input: {
  readonly entry: ConnectionCatalogEntry;
  readonly activeRoute: ConnectionRoute;
  readonly reported?: ReadonlyArray<ReportedEndpoint> | undefined;
  readonly relayAdvertisement?: RelayConnectionInfo | null | undefined;
  /** `null` when the host advertises none, which clears the saved candidates. */
  readonly tunnelEndpoints?: ServerTunnelEndpoints | null | undefined;
  readonly allowRelay?: boolean;
  readonly allowInsecure: boolean;
}) {
  const saved = connectionRoutes(input.entry);
  const learned = learnAdvertisedRoutes(input, saved);
  const { tunnelEndpoints } = input;
  const next =
    learned === null || tunnelEndpoints === undefined
      ? learned
      : learned.map((route) => withDirectTunnelUrls(route, tunnelEndpoints));
  return next === null || Equal.equals(saved, next) ? null : next;
}

function learnAdvertisedRoutes(
  input: Parameters<typeof mergeLearnedRoutes>[0],
  saved: ReadonlyArray<ConnectionRoute>,
) {
  const { entry } = input;
  const active = input.activeRoute.target;
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
    if (endpoint.kind === "tailnet" && isTailnetAddress(url.hostname))
      tailscaleOrigins.add(url.origin);
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
      !plainHttpAllowed(saved, sharedCredential, tailscaleOrigins.has(url.origin))
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
  return next;
}

function withDirectTunnelUrls(
  route: ConnectionRoute,
  tunnelEndpoints: ServerTunnelEndpoints | null,
) {
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile") return route;
  const identity = relayIdentity(profile.httpBaseUrl);
  if (identity === null) return route;
  const urls =
    tunnelEndpoints !== null && relayIdentity(tunnelEndpoints.address) === identity
      ? tunnelEndpoints.urls
      : [];
  const saved = profile.directTunnelUrls ?? [];
  if (saved.length === urls.length && saved.every((url, index) => url === urls[index])) {
    return route;
  }
  const { directTunnelUrls: _previous, ...fields } = profile;
  return {
    target: route.target,
    profile: Option.some(
      new BearerConnectionProfile({
        ...fields,
        ...(urls.length === 0 ? {} : { directTunnelUrls: urls }),
      }),
    ),
  };
}

function credentialRoute(routes: ReadonlyArray<ConnectionRoute>, credentialId: string) {
  return routes.find((route) => connectionRouteId(route.target) === credentialId);
}

function plainHttpAllowed(
  routes: ReadonlyArray<ConnectionRoute>,
  credentialId: string,
  tailnet: boolean,
) {
  const paired = credentialRoute(routes, credentialId);
  if (paired === undefined) return false;
  const kind = connectionRouteKind(paired);
  if (kind === "relay") return false;
  return (
    tailnet ||
    (routeHttpBaseUrl(paired)?.startsWith("http:") === true &&
      (kind === "lan" || kind === "public"))
  );
}

/**
 * Whether connecting over `route` would send a paired token unencrypted where
 * it wasn't paired that way. Checked against the token the route borrows, so a
 * route learned before this rule existed is refused too.
 */
export function sendsTokenInClear(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
  tailscale?: boolean,
): boolean;
export function sendsTokenInClear(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
  tailscale?: boolean,
) {
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile") return false satisfies boolean;
  if (profile.httpBaseUrl.startsWith("https:"))
    return profile.wsBaseUrl.startsWith("ws:") satisfies boolean;
  if (!profile.httpBaseUrl.startsWith("http:")) return false satisfies boolean;
  const routeId = connectionRouteId(route.target);
  const credentialId = credentialConnectionId(routeId);
  if (credentialId === routeId) return false satisfies boolean;
  const tailnet = tailscale ?? (labelledTailscale(route) && isTailnetUrl(profile.httpBaseUrl));
  return !plainHttpAllowed(routes, credentialId, tailnet) satisfies boolean;
}

function isTailnetUrl(httpBaseUrl: string) {
  try {
    return isTailnetAddress(new URL(httpBaseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Loopback stays open for SSH forwards. A moved route owns its token and the
 * catalog forgets how it was paired, so a relay-paired route stays on relay
 * addresses: moving it to HTTPS first would let a later edit reach plain HTTP.
 */
export function credentialAllowsAddress(credential: ConnectionRoute, httpBaseUrl: string) {
  let url: URL;
  try {
    url = new URL(httpBaseUrl);
  } catch {
    return false;
  }
  if (isLocalLoopbackHost(url.hostname)) return true;
  if (connectionRouteKind(credential) === "relay") return relayIdentity(url.href) !== null;
  if (url.protocol !== "http:") return true;
  return plainHttpAllowed(
    [credential],
    connectionRouteId(credential.target),
    isTailnetAddress(url.hostname),
  );
}

/** Routes a connect may use: none sends a paired token unencrypted where it wasn't paired that way. */
export function usableRoutes(entry: ConnectionCatalogEntry) {
  const routes = connectionRoutes(entry);
  return routes.filter((route) => !sendsTokenInClear(routes, route));
}

/** The relay host a relay route's tunnel reaches, or null for any other route. */
export function relayRouteIdentity(route: ConnectionRoute) {
  const address = routeHttpBaseUrl(route);
  return address === null || connectionRouteKind(route) !== "relay" ? null : relayIdentity(address);
}

export interface ReportedEndpoint {
  readonly httpBaseUrl: string;
  readonly kind?: string;
}

function withNetwork(route: ConnectionRoute, tailscale: boolean) {
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

function learnedConnectionId(environmentId: string, origin: string, sharedCredential: string) {
  return `learned:${environmentId}:${origin}@${sharedCredential}`;
}

export function credentialConnectionId(connectionId: string) {
  const at = connectionId.indexOf("@");
  return connectionId.startsWith("learned:") && at !== -1
    ? connectionId.slice(at + 1)
    : connectionId;
}

export function isLearned(route: ConnectionRoute) {
  const profile = Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" && profile.learned === true;
}

export function routesAfterRemoving(
  routes: ReadonlyArray<ConnectionRoute>,
  removedId: string,
): ReadonlyArray<ConnectionRoute>;
export function routesAfterRemoving(routes: ReadonlyArray<ConnectionRoute>, removedId: string) {
  const removed = routes.find((route) => connectionRouteId(route.target) === removedId);
  if (removed === undefined) return routes satisfies ReadonlyArray<ConnectionRoute>;
  return routes.filter((route) => {
    if (route === removed) return false;
    if (!isLearned(route)) return true;
    return credentialConnectionId(connectionRouteId(route.target)) !== removedId;
  }) satisfies ReadonlyArray<ConnectionRoute>;
}

/**
 * A dragged route order shows until the saved routes catch up with it. It is
 * stale, and returns null, once the saved order matches it or the saved routes
 * are no longer the same set: kept any longer, it would hide a route added
 * later whenever the count happened to match again.
 */
export function pendingRouteOrder(
  pending: ReadonlyArray<string> | null,
  savedIds: ReadonlyArray<string>,
) {
  if (pending === null || pending.length !== savedIds.length) return null;
  const saved = new Set(savedIds);
  if (!pending.every((id) => saved.has(id))) return null;
  return pending.some((id, index) => id !== savedIds[index]) ? pending : null;
}

export function sshTargetKey(target: DesktopSshEnvironmentTarget) {
  return JSON.stringify([target.alias, target.hostname, target.username, target.port]);
}
