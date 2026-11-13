import { ANOTHER_ADDRESS, type LinkableMachine } from "@supaterm/client-runtime/link-request";
import type { AuthMcpClientAccess, PeerLinkCreateInput } from "@supaterm/contracts";

import type { EnvironmentPresentation } from "../../state/environments";
import type { SettingsTarget } from "../settings/settings-environment-filter";

/** The connected machines that can link. Each has its own setting, shown even while it is off. */
export function linkCapableEnvironments(
  environments: ReadonlyArray<EnvironmentPresentation>,
): ReadonlyArray<SettingsTarget> {
  return environments.filter(
    (environment): environment is SettingsTarget =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.peerLinks === true,
  );
}

/**
 * What the link sheet links. A `machine` is linked by this app's own addresses for it, which is
 * the only case the app may mint a code for. An `address` is typed in, for a picked machine the
 * app has no direct address for or for no known machine, and always takes a pasted code.
 */
type LinkTarget =
  | { readonly kind: "none" }
  | { readonly kind: "machine"; readonly machine: LinkableMachine }
  | { readonly kind: "address"; readonly machine: LinkableMachine | null };

/** With no other machine known, only a typed address is left, so nothing needs picking. */
export function linkTarget(
  machines: ReadonlyArray<LinkableMachine>,
  choice: string | null,
): LinkTarget {
  const selected = choice ?? (machines.length === 0 ? ANOTHER_ADDRESS : null);
  if (selected === null) return { kind: "none" };
  const machine = machines.find((candidate) => candidate.environmentId === selected) ?? null;
  return machine !== null && machine.urls.length > 0
    ? { kind: "machine", machine }
    : { kind: "address", machine };
}

/**
 * The payload that links `target`, or null while it lacks an address or a code. A typed
 * address links alone: only this app's own addresses name a machine.
 */
export function peerLinkCreateInput(input: {
  readonly target: LinkTarget;
  readonly address: string;
  readonly access: AuthMcpClientAccess;
  readonly pairingCode: string;
}): PeerLinkCreateInput | null {
  const { target, access } = input;
  const pairingCode = input.pairingCode.trim();
  if (target.kind === "none" || pairingCode.length === 0) return null;
  if (target.kind === "address") {
    const url = input.address.trim();
    return url.length === 0 ? null : { url, pairingCode, access };
  }
  const [url, ...alternateUrls] = target.machine.urls;
  if (url === undefined) return null;
  return {
    url,
    ...(alternateUrls.length > 0 ? { alternateUrls } : {}),
    expectedEnvironmentId: target.machine.environmentId,
    expectedLabel: target.machine.label,
    pairingCode,
    access,
  };
}

const USER_FACING_FAILURE_TAGS = new Set([
  "PeerLinkError",
  "EnvironmentAuthorizationError",
  "PeerPairingCodeError",
]);

/** Only errors written for the user pass their message: any other could echo the pairing code. */
export function linkFailureMessage(failure: unknown): string {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string" &&
    USER_FACING_FAILURE_TAGS.has(failure._tag) &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  return "Could not link the environment. Try again.";
}
