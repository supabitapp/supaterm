import * as DateTime from "effect/DateTime";

import { resolveDesktopPairingUrl, resolveHostedPairingUrl } from "./pairingUrls";
import { setPairingTokenOnUrl } from "@supaterm/shared/remote";
import {
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
} from "~/environments/primary";
import {
  type AdvertisedEndpoint,
  type AuthClientSession,
  type AuthGrantScope,
  type AuthPairingLink,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type DesktopBridge,
  type DesktopUpdateState,
  type DesktopWslState,
  type EnvironmentId,
  type RelayConnectionInfo,
  type ServerAuthPolicy,
  type ServerDirectEndpoint,
  type ServerSettings,
  normalizeRelayServerUrl,
} from "@supaterm/contracts";
import { createAdvertisedEndpoint } from "@supaterm/shared/advertisedEndpoint";
import type { PairingRouteHints } from "@supaterm/shared/remote";

export function createRelayPairingEndpoint(relayEndpoint: string) {
  return createAdvertisedEndpoint({
    id: "public-relay",
    label: "Encrypted Relay",
    provider: { id: "public-relay", label: "Encrypted Relay", kind: "tunnel", isAddon: false },
    httpBaseUrl: relayEndpoint,
    reachability: "public",
    hostedHttpsCompatibility: "compatible",
    source: "server",
    description: "End-to-end encrypted access through the Encrypted Relay.",
  });
}

export function resolvePairingLinkRoutes(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
  pairingHints: PairingRouteHints,
  relay: RelayConnectionInfo | undefined,
  settings: Pick<ServerSettings, "publicRelayEnabled" | "publicRelayUrl"> | undefined,
) {
  if (
    relay === undefined ||
    endpoints.some((endpoint) => endpoint.id === "public-relay") ||
    !settings?.publicRelayEnabled ||
    normalizeRelayServerUrl(settings.publicRelayUrl) !== relay.relayUrl
  )
    return { endpoints, pairingHints };
  return {
    endpoints: [...endpoints, createRelayPairingEndpoint(relay.relayEndpoint)],
    pairingHints: { ...pairingHints, relayUrl: relay.relayUrl },
  };
}
import {
  getDesktopUpdateDownloadedVersion,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";

/**
 * Operating terminals without being able to list them leaves a client
 * allocating a fresh shell for every script run it cannot see, so the pairing
 * form keeps `terminal:read` alongside `terminal:operate`.
 */
export function togglePairingScopeSelection(
  current: ReadonlyArray<AuthGrantScope>,
  scope: AuthGrantScope,
  checked: boolean,
) {
  const without = (scopes: ReadonlyArray<AuthGrantScope>) =>
    scopes.filter((currentScope) => currentScope !== scope);
  if (!checked) {
    return scope === AuthTerminalReadScope
      ? without(current).filter((currentScope) => currentScope !== AuthTerminalOperateScope)
      : without(current);
  }
  const next = [...without(current), scope];
  return scope === AuthTerminalOperateScope && !next.includes(AuthTerminalReadScope)
    ? [...next, AuthTerminalReadScope]
    : next;
}

export function canRevokeOtherClients(
  clientSessions: ReadonlyArray<{ readonly current: boolean }> | null,
) {
  return clientSessions === null || clientSessions.some((session) => !session.current);
}

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

/**
 * A QR code encoding a loopback URL makes the scanning device dial itself, so
 * loopback endpoints stay copyable from the endpoint menu but are never
 * offered as QR targets.
 */
export function isQrShareableEndpoint(endpoint: AdvertisedEndpoint) {
  return endpoint.status !== "unavailable" && endpoint.reachability !== "loopback";
}

/**
 * The row follows the saved Serve flag rather than probe health so a failed
 * probe or a stopped Tailscale never hides the way to turn Serve off.
 */
export function resolveTailscaleHttpsRow(input: {
  readonly endpoint: AdvertisedEndpoint | null;
  readonly serveEnabled: boolean;
  readonly error?: string | null;
}) {
  const { endpoint, serveEnabled, error } = input;
  return {
    description:
      serveEnabled && endpoint
        ? endpoint.httpBaseUrl
        : "Use Tailscale Serve to expose this backend through a MagicDNS HTTPS URL.",
    status:
      serveEnabled && (error || endpoint?.status !== "available")
        ? (error ??
          "Tailscale HTTPS is unavailable. Check that Tailscale is running and its command works, then restart Supaterm.")
        : null,
  };
}

export function resolveTailscaleServeBaseUrl(
  endpoint: Pick<AdvertisedEndpoint, "httpBaseUrl"> | null,
  port: number,
  isPortValid: boolean,
) {
  if (!endpoint) return null;
  if (!isPortValid) return endpoint.httpBaseUrl;
  try {
    const url = new URL(endpoint.httpBaseUrl);
    url.port = String(port);
    return url.toString().replace(/\/$/u, "");
  } catch {
    return endpoint.httpBaseUrl;
  }
}

export function isWslSettingsRowVisible(input: {
  readonly state: DesktopWslState | null;
  readonly error: string | null;
}) {
  const { state, error } = input;
  return state ? state.available || state.enabled || state.wslOnly : error !== null;
}

/**
 * The desktop bundles its server, so a pending app update is the only way it falls behind.
 * Pending states follow the sidebar update control's action so the two never disagree, and a
 * recheck keeps a downloaded update's label. `state` is null outside the desktop app.
 */
export function resolveLocalVersionStatusLabel(state: DesktopUpdateState | null) {
  if (!state) return "Up to date";
  if (state.status === "downloading") {
    return state.availableVersion
      ? `Downloading update ${state.availableVersion}`
      : "Downloading update";
  }
  const action = resolveDesktopUpdateButtonAction(state);
  if (
    action === "install" ||
    state.status === "downloaded" ||
    (state.status === "checking" && state.downloadedVersion !== null)
  ) {
    const version = getDesktopUpdateDownloadedVersion(state);
    return version ? `Update ${version} downloaded` : "Update downloaded";
  }
  if (action === "download") {
    return state.availableVersion
      ? `Update ${state.availableVersion} available`
      : "Update available";
  }
  return "Up to date";
}

export type QrEndpointOption = {
  readonly id: string;
  /**
   * Stable per endpoint *type* (endpointDefaultPreferenceKey). Multiple
   * endpoints can share one, so it is only used to match the saved default.
   */
  readonly preferenceKey: string;
  readonly qrShareable: boolean;
};

export function selectQrEndpointOption<T extends QrEndpointOption>(
  options: ReadonlyArray<T>,
  selectedId: string | null,
  defaultPreferenceKey: string | null,
) {
  return (
    (selectedId !== null ? options.find((option) => option.id === selectedId) : undefined) ??
    (defaultPreferenceKey !== null
      ? options.find((option) => option.preferenceKey === defaultPreferenceKey)
      : undefined) ??
    options.find((option) => option.qrShareable) ??
    options[0] ??
    null
  );
}

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}) {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}

const accessTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAccessTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return accessTimestampFormatter.format(parsed);
}

export function parseManualDesktopSshTarget(input: {
  readonly host: string;
  readonly username: string;
  readonly port: string;
}) {
  const rawHost = input.host.trim();
  if (rawHost.length === 0) {
    throw new Error("SSH host or alias is required.");
  }

  let hostname = rawHost;
  let username = input.username.trim() || null;
  let port: number | null = null;

  const atIndex = hostname.lastIndexOf("@");
  if (atIndex > 0) {
    const inlineUsername = hostname.slice(0, atIndex).trim();
    hostname = hostname.slice(atIndex + 1).trim();
    if (!username && inlineUsername.length > 0) {
      username = inlineUsername;
    }
  }

  const bracketedHostMatch = /^\[([^\]]+)\](?::(\d+))?$/u.exec(hostname);
  if (bracketedHostMatch) {
    hostname = bracketedHostMatch[1]!.trim();
    if (bracketedHostMatch[2]) {
      port = Number.parseInt(bracketedHostMatch[2], 10);
    }
  } else {
    const colonSegments = hostname.split(":");
    if (colonSegments.length === 2 && /^\d+$/u.test(colonSegments[1] ?? "")) {
      hostname = colonSegments[0]!.trim();
      port = Number.parseInt(colonSegments[1]!, 10);
    }
  }

  const rawPort = input.port.trim();
  if (rawPort.length > 0) {
    port = /^\d+$/u.test(rawPort) ? Number.parseInt(rawPort, 10) : Number.NaN;
  }

  if (hostname.length === 0) {
    throw new Error("SSH host or alias is required.");
  }

  if (port !== null && (!Number.isInteger(port) || port <= 0 || port > 65_535)) {
    throw new Error("SSH port must be between 1 and 65535.");
  }

  return {
    alias: hostname,
    hostname,
    username,
    port,
  };
}

export function formatDesktopSshConnectionError(error: unknown) {
  const fallback = "Failed to connect SSH host.";
  const rawMessage = error instanceof Error ? error.message : fallback;
  const withoutIpcPrefix = rawMessage.replace(
    /^Error invoking remote method 'desktop:ensure-ssh-environment':\s*/u,
    "",
  );
  const withoutTaggedErrorPrefix = withoutIpcPrefix.replace(/^Ssh[A-Za-z]+Error:\s*/u, "");
  return withoutTaggedErrorPrefix.trim() || fallback;
}

export function sortDesktopPairingLinks(links: ReadonlyArray<ServerPairingLinkRecord>) {
  return [...links].toSorted(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function summarizeAuthorizedClients(
  sessions: ReadonlyArray<ServerClientSessionRecord>,
  links: ReadonlyArray<ServerPairingLinkRecord>,
) {
  const parts = [
    `${sessions.length} ${sessions.length === 1 ? "client" : "clients"}`,
    links.length > 0
      ? `${links.length} ${links.length === 1 ? "pairing link" : "pairing links"}`
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

export function sortDesktopClientSessions(sessions: ReadonlyArray<ServerClientSessionRecord>) {
  return [...sessions].toSorted((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    if (left.connected !== right.connected) {
      return left.connected ? -1 : 1;
    }
    return new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime();
  });
}

export function toDesktopPairingLinkRecord(pairingLink: AuthPairingLink) {
  return {
    ...pairingLink,
    scopes: pairingLink.scopes,
    createdAt: DateTime.formatIso(pairingLink.createdAt),
    expiresAt: DateTime.formatIso(pairingLink.expiresAt),
  };
}

export function toDesktopClientSessionRecord(clientSession: AuthClientSession) {
  return {
    ...clientSession,
    scopes: clientSession.scopes,
    issuedAt: DateTime.formatIso(clientSession.issuedAt),
    expiresAt: DateTime.formatIso(clientSession.expiresAt),
    lastConnectedAt:
      clientSession.lastConnectedAt === null
        ? null
        : DateTime.formatIso(clientSession.lastConnectedAt),
  };
}

export function selectPairingEndpoint(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
  defaultEndpointKey?: string | null,
) {
  const availableEndpoints = endpoints.filter((endpoint) => endpoint.status !== "unavailable");
  if (defaultEndpointKey) {
    const selectedEndpoint = availableEndpoints.find(
      (endpoint) => endpointDefaultPreferenceKey(endpoint) === defaultEndpointKey,
    );
    if (selectedEndpoint) {
      return selectedEndpoint;
    }
  }
  return (
    availableEndpoints.find((endpoint) => endpoint.isDefault) ??
    availableEndpoints.find((endpoint) => endpoint.reachability !== "loopback") ??
    availableEndpoints.find((endpoint) => endpoint.compatibility.hostedHttpsApp === "compatible") ??
    null
  );
}

/** A loopback server advertises a direct endpoint only once its Tailscale Serve URL answers. */
export function isServerNetworkAccessible(input: {
  readonly authPolicy: ServerAuthPolicy | null;
  readonly directEndpoints: ReadonlyArray<ServerDirectEndpoint> | undefined;
}) {
  if (input.authPolicy === "remote-reachable") return true;
  return input.authPolicy === "loopback-browser" && (input.directEndpoints?.length ?? 0) > 0;
}

export function isTailscaleHttpsEndpoint(endpoint: AdvertisedEndpoint) {
  return endpoint.id.startsWith("tailscale-magicdns:");
}

export function endpointDefaultPreferenceKey(endpoint: AdvertisedEndpoint) {
  if (endpoint.id.startsWith("desktop-loopback:")) {
    return "desktop-core:loopback:http";
  }
  if (endpoint.id.startsWith("desktop-lan:")) {
    return "desktop-core:lan:http";
  }
  if (endpoint.id.startsWith("tailscale-ip:")) {
    return "tailscale:ip:http";
  }
  if (isTailscaleHttpsEndpoint(endpoint)) {
    return "tailscale:magicdns:https";
  }

  let scheme = "unknown";
  try {
    scheme = new URL(endpoint.httpBaseUrl).protocol.replace(/:$/u, "");
  } catch {}

  return `${endpoint.provider.id}:${endpoint.reachability}:${scheme}:${endpoint.label}`;
}

export function resolveAdvertisedEndpointPairingUrl(
  endpoint: AdvertisedEndpoint,
  credential: string,
  hints: PairingRouteHints,
) {
  if (endpoint.compatibility.hostedHttpsApp === "compatible") {
    return (
      resolveHostedPairingUrl(endpoint.httpBaseUrl, credential, hints) ??
      resolveDesktopPairingUrl(endpoint.httpBaseUrl, credential, hints)
    );
  }
  return resolveDesktopPairingUrl(endpoint.httpBaseUrl, credential, hints);
}

export function resolveCurrentOriginPairingUrl(credential: string, hints: PairingRouteHints) {
  const url = new URL("/pair", window.location.href);
  return setPairingTokenOnUrl(url, credential, hints).toString();
}

export function isHostedAppPairingUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname === "/pair" && url.searchParams.has("host");
  } catch {
    return false;
  }
}

export function endpointShareHint(endpoint: AdvertisedEndpoint, url: string) {
  if (isHostedAppPairingUrl(url)) {
    return "Opens the hosted app, no install needed";
  }
  switch (endpoint.reachability) {
    case "lan":
      return "Devices on the same network";
    case "private-network":
      return "Devices on your private network";
    case "public":
      return "Reachable from anywhere";
    case "loopback":
      return "Clients on this machine";
  }
}

/** An explicit choice while it is listed, else the primary, else a connected environment. */
export function resolveAccessEnvironmentId(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly connected: boolean;
  }>;
  readonly selected: EnvironmentId | null;
}) {
  const isListed = (environmentId: EnvironmentId | null) =>
    input.environments.some((environment) => environment.environmentId === environmentId);
  if (isListed(input.selected)) return input.selected;
  if (isListed(input.primaryEnvironmentId)) return input.primaryEnvironmentId;
  return (
    (input.environments.find((environment) => environment.connected) ?? input.environments[0])
      ?.environmentId ?? null
  );
}
