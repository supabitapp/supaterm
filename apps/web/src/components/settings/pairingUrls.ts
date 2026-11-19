import { buildHostedPairingUrl } from "../../hostedPairing";
import { buildPairingUrl, type PairingRouteHints } from "@supaterm/shared/remote";
import { isLoopbackHostname } from "../../environments/primary/target";

export function resolvePairingShareValue(
  credential: string,
  endpointUrl: string | null | undefined,
  hints: PairingRouteHints = {},
  hostedPairingAllowed = true,
) {
  if (!endpointUrl) return { value: credential, kind: "code" as const, qrShareable: false };
  const endpoint = new URL(endpointUrl);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    return { value: credential, kind: "code" as const, qrShareable: false };
  return {
    value:
      (hostedPairingAllowed ? resolveHostedPairingUrl(endpointUrl, credential, hints) : null) ??
      resolveDesktopPairingUrl(endpointUrl, credential, hints),
    kind: "link" as const,
    qrShareable: !isLoopbackHostname(endpoint.hostname),
  };
}

export function resolveDesktopPairingUrl(
  endpointUrl: string,
  credential: string,
  hints: PairingRouteHints = {},
): string {
  return buildPairingUrl(endpointUrl, credential, hints);
}

export function resolveHostedPairingUrl(
  endpointUrl: string,
  credential: string,
  hints: PairingRouteHints = {},
): string | null {
  const url = new URL(endpointUrl);
  if (url.protocol !== "https:") {
    return null;
  }

  return buildHostedPairingUrl({
    host: endpointUrl,
    token: credential,
    ...hints,
  });
}
