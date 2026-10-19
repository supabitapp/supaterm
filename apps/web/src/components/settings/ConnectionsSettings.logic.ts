import {
  type AdvertisedEndpoint,
  type AuthGrantScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type DesktopBridge,
  type DesktopServerExposureState,
  type DesktopWslState,
  type RelayConnectionInfo,
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

/**
 * Operating terminals without being able to list them leaves a client
 * allocating a fresh shell for every script run it cannot see, so the pairing
 * form keeps `terminal:read` alongside `terminal:operate`.
 */
export function togglePairingScopeSelection(
  current: ReadonlyArray<AuthGrantScope>,
  scope: AuthGrantScope,
  checked: boolean,
): ReadonlyArray<AuthGrantScope> {
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
): boolean {
  return clientSessions === null || clientSessions.some((session) => !session.current);
}

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

/**
 * A QR code encoding a loopback URL makes the scanning device dial itself, so
 * loopback endpoints stay copyable from the endpoint menu but are never
 * offered as QR targets.
 */
export function isQrShareableEndpoint(endpoint: AdvertisedEndpoint): boolean {
  return endpoint.status !== "unavailable" && endpoint.reachability !== "loopback";
}

/**
 * The desktop asks Tailscale for its MagicDNS name only once Serve or Network
 * access is on, so a missing endpoint means Tailscale isn't running only in
 * those modes. The switch follows the saved Serve flag so a failed probe or a
 * stopped Tailscale never hides the way to turn Serve off.
 */
export function resolveTailscaleHttpsRow(input: {
  readonly endpoint: AdvertisedEndpoint | null;
  readonly state: Pick<DesktopServerExposureState, "mode" | "tailscaleServeEnabled"> | null;
}) {
  const { endpoint, state } = input;
  const enabled = state?.tailscaleServeEnabled === true;
  const tailscaleQueried = enabled || state?.mode === "network-accessible";
  const describe = () => {
    if (endpoint && enabled) return endpoint.httpBaseUrl;
    if (!endpoint && tailscaleQueried) {
      return "Start Tailscale to set up HTTPS access through MagicDNS.";
    }
    return "Use Tailscale Serve to expose this backend through a MagicDNS HTTPS URL.";
  };
  return {
    enabled,
    description: describe(),
    unreachable: enabled && endpoint !== null && endpoint.status !== "available",
  };
}

export function isWslSettingsRowVisible(input: {
  readonly state: DesktopWslState | null;
  readonly error: string | null;
}): boolean {
  const { state, error } = input;
  return state ? state.available || state.enabled || state.wslOnly : error !== null;
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
): T | null {
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
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage every preference before enabling. The desktop only relaunches for
  // mode/distro changes while WSL is active, so the final enable observes the
  // complete selection and is the only call that may relaunch.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}
