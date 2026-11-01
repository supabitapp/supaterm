import type {
  BrowserNavigationTarget,
  EnvironmentId,
  PreviewUrlResolution,
} from "@supaterm/contracts";
import { isLoopbackHost, normalizePreviewUrl } from "@supaterm/shared/preview";
import { isLocalLoopbackHost, isPrivateNetworkHost } from "@supaterm/shared/hostClassification";

import type { ConnectionTarget } from "@supaterm/client-runtime/connection";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { isElectron } from "~/env";
import { readEnvironmentSupportsServerBrowser } from "~/state/entities";

import { readPreparedConnection } from "~/state/session";

export { normalizeHostname, isLocalLoopbackHost } from "@supaterm/shared/hostClassification";

export class RelayHostBrowserUnavailableError extends Error {
  constructor() {
    super("Relay port previews require browser support on the host.");
  }
}

const readEnvironmentUrl = (environmentId: EnvironmentId): URL => {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error(`Environment ${environmentId} is not connected.`);
  if (connection.connectionMethod === "relay") {
    if (!readEnvironmentSupportsServerBrowser(environmentId))
      throw new RelayHostBrowserUnavailableError();
    return new URL("http://127.0.0.1");
  }
  return new URL(connection.httpBaseUrl);
};

const resolveEnvironmentPortTarget = (
  environmentId: EnvironmentId,
  target: Extract<BrowserNavigationTarget, { readonly kind: "environment-port" }>,
  environmentUrl: URL,
  requestedUrl?: string,
  sourceUrl?: URL,
): PreviewUrlResolution => {
  if (!isPrivateNetworkHost(environmentUrl.hostname)) {
    throw new Error(
      "This environment port needs the planned authenticated preview gateway; its server address is not directly private-network reachable.",
    );
  }
  const protocol = target.protocol ?? "http";
  const path = target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`;
  const normalizedEnvironmentHost = environmentUrl.hostname.replace(/^\[|\]$/g, "");
  // Local loopback environments should advertise `localhost` so Chromium
  // dual-stack lookup can reach a Vite server bound only to ::1 or 127.0.0.1.
  const resolvedHost = isLocalLoopbackHost(normalizedEnvironmentHost)
    ? "localhost"
    : normalizedEnvironmentHost.includes(":")
      ? `[${normalizedEnvironmentHost}]`
      : normalizedEnvironmentHost;
  const resolved = sourceUrl
    ? new URL(sourceUrl)
    : new URL(path, `${protocol}://${resolvedHost}:${target.port}`);
  if (sourceUrl) {
    resolved.hostname = resolvedHost;
    resolved.port = String(target.port);
  }
  return {
    requestedUrl: requestedUrl ?? `${protocol}://localhost:${target.port}${path}`,
    resolvedUrl: resolved.toString(),
    resolutionKind: isLocalLoopbackHost(normalizedEnvironmentHost)
      ? "direct"
      : "direct-private-network",
    environmentId,
  };
};

// Desktop renders primary and WSL tabs locally; loopback servers require localhost even for LAN backends.
const reachesEnvironmentLoopback = (target: ConnectionTarget): boolean =>
  isElectron &&
  (target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target));

export function resolveDiscoveredServerUrl(
  environmentId: EnvironmentId,
  rawUrl: string,
  options?: { readonly requireReachable: boolean },
): string {
  try {
    const normalizedUrl = normalizePreviewUrl(rawUrl);
    const parsed = new URL(normalizedUrl);
    if (!isLoopbackHost(parsed.hostname)) return normalizedUrl;
    const target = readPreparedConnection(environmentId)?.target;
    if (target && reachesEnvironmentLoopback(target)) return normalizedUrl;
    return resolveEnvironmentPortTarget(
      environmentId,
      {
        kind: "environment-port",
        port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
        protocol: parsed.protocol === "https:" ? "https" : "http",
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      },
      readEnvironmentUrl(environmentId),
      rawUrl,
      parsed,
    ).resolvedUrl;
  } catch (error) {
    if (options?.requireReachable && error instanceof RelayHostBrowserUnavailableError) throw error;
    return rawUrl;
  }
}
