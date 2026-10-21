import { expect, it } from "@effect/vitest";
import { EnvironmentAuthInvalidError } from "@supaterm/contracts";
import type { RelayTunnelFailure } from "@supaterm/shared/relay/protocol";

import { connectionDiagnosisText, presentConnectionDiagnosis } from "./diagnosis.ts";
import { credentialMissingError, mapRemoteEnvironmentError } from "./errors.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  type ConnectionAttemptError,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
} from "../rpc/http.ts";

const backoff = (lastFailure: ConnectionAttemptError): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "backoff",
  attempt: 3,
  lastFailure,
  retryAt: Date.UTC(2026, 9, 19, 12, 0, 30),
});

const relayFailure = (failure: RelayTunnelFailure) =>
  mapRemoteEnvironmentError(
    new RemoteEnvironmentAuthUndeclaredStatusError("https://relay.example.test", 503, failure),
    "relay",
  );
const diagnose = (state: SupervisorConnectionState, via: "relay" | "direct" = "relay") =>
  presentConnectionDiagnosis({ hostLabel: "Mac mini", state, via });

it("locates an offline host beyond the reachable relay", () => {
  const diagnosis = diagnose(backoff(relayFailure("host-offline")));
  expect(diagnosis?.headline).toBe("Mac mini is offline");
  expect(diagnosis?.hops.map(({ hop, result }) => `${hop}:${result}`)).toEqual([
    "device:ok",
    "relay:ok",
    "tunnel:failed",
    "server:unchecked",
  ]);
  expect(diagnosis?.steps.join(" ")).toContain("Mac mini is awake");
});

it.each([
  ["relay-busy", "The relay is busy"],
  ["relay-timeout", "The relay did not answer in time"],
  ["relay-unreachable", "This device can't reach the relay"],
] as const)("reports %s at the relay", (failure, headline) => {
  const diagnosis = diagnose(backoff(relayFailure(failure)), "direct");
  expect(diagnosis?.headline).toBe(headline);
  expect(diagnosis?.hops[1]).toMatchObject({ hop: "relay", result: "failed" });
  expect(diagnosis?.hops[2]?.result).toBe("unchecked");
});

it("does not claim that the relay answered a request that timed out", () => {
  const failure = mapRemoteEnvironmentError(
    new RemoteEnvironmentAuthTimeoutError("https://relay.example.test", 15000),
    "relay",
  );
  const diagnosis = diagnose(backoff(failure), "direct");
  expect(diagnosis?.headline).toBe("The relay connection to Mac mini was interrupted");
  expect(diagnosis?.hops[1]).toMatchObject({ hop: "relay", result: "unchecked" });
  expect(diagnosis?.facts).toContainEqual(["Route", "Relay"]);
});

it("locates a host authentication rejection after the working relay path", () => {
  const failure = mapRemoteEnvironmentError(
    new EnvironmentAuthInvalidError({
      code: "auth_invalid",
      reason: "invalid_credential",
      traceId: "trace-1",
    }),
    "relay",
  );
  const diagnosis = diagnose(backoff(failure));
  expect(diagnosis?.headline).toBe("Supaterm on Mac mini did not accept this device");
  expect(diagnosis?.hops.map((hop) => hop.result)).toEqual(["ok", "ok", "ok", "failed"]);
  expect(diagnosis?.facts).toContainEqual(["Trace ID", "trace-1"]);
});

it("locates missing saved credentials on this device", () => {
  const diagnosis = diagnose(backoff(credentialMissingError("connection-1")), "direct");
  expect(diagnosis?.hops[0]).toMatchObject({ hop: "device", result: "failed" });
});

it("reports this device offline before an earlier host failure", () => {
  const state = { ...backoff(relayFailure("host-offline")), network: "offline" as const };
  expect(diagnose(state)?.headline).toBe("This device is offline");
});

it("directs protocol incompatibility to a host update", () => {
  const diagnosis = diagnose(
    backoff(
      new ConnectionBlockedError({
        reason: "unsupported",
        detail: "Update required",
        serverUpdateRequired: true,
      }),
    ),
    "direct",
  );
  expect(diagnosis?.headline).toBe("Mac mini runs an older Supaterm");
  expect(diagnosis?.steps).toEqual(["Update Supaterm on Mac mini."]);
});

it("has nothing to say before a failure", () => {
  expect(diagnose(AVAILABLE_CONNECTION_STATE)).toBeNull();
});

it("includes every hop and fact in copied diagnostics", () => {
  const diagnosis = diagnose(backoff(relayFailure("host-offline")));
  if (diagnosis === null) throw new Error("Expected a diagnosis");
  const text = connectionDiagnosisText("Mac mini", diagnosis);
  expect(text).toContain("Mac mini connection: FAILED");
  expect(text).toContain("Supaterm on Mac mini: not checked");
  expect(text).toContain("Cause: host-offline");
  expect(text).toContain("Attempts: 3");
});
