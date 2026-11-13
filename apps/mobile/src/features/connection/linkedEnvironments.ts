import type { PeerLinkHealth } from "@supaterm/client-runtime/state/peerLinks";

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

export function linkHealthText(health: PeerLinkHealth): string {
  if (health.kind === "expired") return "Expired. Link it again with a new pairing code.";
  if (health.kind === "unreachable") return health.detail ?? "Not answering right now.";
  if (health.kind === "failing") return health.detail;
  if (health.expiresInDays === null) return "Reachable";
  const unit = health.expiresInDays === 1 ? "day" : "days";
  return `Expires in ${health.expiresInDays} ${unit}`;
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
