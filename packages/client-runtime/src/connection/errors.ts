import type { ClientConnectionMethod, EnvironmentId } from "@supaterm/contracts";
import type { RemoteEnvironmentAuthError } from "../authorization/remote.ts";
import type { RelayTunnelFailure } from "@supaterm/shared/relay/protocol";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
} from "./model.ts";

export function profileMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connection profile ${connectionId} is unavailable.`,
    hop: "device",
  });
}

export function credentialMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "authentication",
    detail: `Connection credential ${connectionId} is unavailable.`,
    hop: "device",
  });
}

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  });
}

export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentAuthError,
  connectionMethod?: ClientConnectionMethod,
): ConnectionAttemptError {
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
      });
    case "EnvironmentScopeRequiredError":
    case "EnvironmentOperationForbiddenError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential does not grant the required access.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment rejected the authentication request.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "EnvironmentResourceNotFoundError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment endpoint could not be found.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "RemoteEnvironmentAuthTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message,
        hop: unreachableHop,
        via,
      });
    case "RemoteEnvironmentAuthFetchError":
      return new ConnectionTransientError({
        reason: "network",
        detail: error.message,
        hop: unreachableHop,
        via,
      });
    case "EnvironmentInternalError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The environment could not authorize the connection.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      if (error.relayFailure !== undefined) return relayTunnelError(error.relayFailure);
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      });
    case "RemoteEnvironmentAuthInvalidJsonError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      });
  }
}

function relayTunnelError(failure: RelayTunnelFailure): ConnectionTransientError {
  switch (failure) {
    case "host-offline":
      return new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail: "The environment is offline. Make sure Supaterm is running on that computer.",
        hop: "tunnel",
        via: "relay",
        failureCause: failure,
      });
    case "relay-busy":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The relay is busy right now.",
        hop: "relay",
        via: "relay",
        failureCause: failure,
      });
    case "relay-timeout":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: "The relay did not respond in time.",
        hop: "relay",
        via: "relay",
        failureCause: failure,
      });
    case "relay-unreachable":
      return new ConnectionTransientError({
        reason: "network",
        detail: "The relay could not be reached.",
        hop: "relay",
        via: "relay",
        failureCause: failure,
      });
  }
}
