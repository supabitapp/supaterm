import type { ClientConnectionMethod, EnvironmentId } from "@supaterm/contracts";
import type { RemoteEnvironmentAuthError } from "../authorization/remote.ts";
import type { RelayTunnelFailure } from "@supaterm/shared/relay/protocol";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
} from "./model.ts";

export function profileMissingError(connectionId: string) {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connection profile ${connectionId} is unavailable.`,
    hop: "device",
  });
}

export function credentialMissingError(connectionId: string) {
  return new ConnectionBlockedError({
    reason: "authentication",
    detail: `Connection credential ${connectionId} is unavailable.`,
    hop: "device",
  });
}

/** The host itself answered and refused this device's credential, which pairing again fixes. */
export function isHostCredentialRefusal(error: ConnectionAttemptError) {
  return (
    error._tag === "ConnectionBlockedError" &&
    error.hop === "server" &&
    (error.reason === "authentication" || error.reason === "permission")
  );
}

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError;
export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}) {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  }) satisfies ConnectionBlockedError;
}

export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentAuthError,
  connectionMethod?: ClientConnectionMethod,
): ConnectionAttemptError;
export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentAuthError,
  connectionMethod?: ClientConnectionMethod,
) {
  const unreachableHop = connectionMethod === "relay" ? "tunnel" : "server";
  const via = connectionMethod === "relay" ? "relay" : "direct";
  switch (error._tag) {
    case "EnvironmentAuthInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
        traceId: error.traceId,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
    case "EnvironmentScopeRequiredError":
    case "EnvironmentOperationForbiddenError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential does not grant the required access.",
        traceId: error.traceId,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment rejected the authentication request.",
        traceId: error.traceId,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
    case "EnvironmentResourceNotFoundError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment endpoint could not be found.",
        traceId: error.traceId,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
    case "RemoteEnvironmentAuthTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message,
        hop: unreachableHop,
        via,
      }) satisfies ConnectionAttemptError;
    case "RemoteEnvironmentAuthFetchError":
      return new ConnectionTransientError({
        reason: "network",
        detail: error.message,
        hop: unreachableHop,
        via,
      }) satisfies ConnectionAttemptError;
    case "EnvironmentInternalError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The environment could not authorize the connection.",
        traceId: error.traceId,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      if (error.relayFailure !== undefined)
        return relayTunnelError(error.relayFailure) satisfies ConnectionAttemptError;
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
    case "RemoteEnvironmentAuthInvalidJsonError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      }) satisfies ConnectionAttemptError;
  }
}

const relayTunnelFailures = {
  "host-offline": {
    reason: "endpoint-unavailable",
    detail: "The environment is offline. Make sure Supaterm is running on that computer.",
    hop: "tunnel",
  },
  "relay-busy": {
    reason: "remote-unavailable",
    detail: "The relay is busy right now.",
    hop: "relay",
  },
  "relay-timeout": {
    reason: "timeout",
    detail: "The relay did not respond in time.",
    hop: "relay",
  },
  "relay-unreachable": {
    reason: "network",
    detail: "The relay could not be reached.",
    hop: "relay",
  },
} satisfies Record<RelayTunnelFailure, Pick<ConnectionTransientError, "reason" | "detail" | "hop">>;

function relayTunnelError(failure: RelayTunnelFailure) {
  return new ConnectionTransientError({
    ...relayTunnelFailures[failure],
    via: "relay",
    failureCause: failure,
  });
}
