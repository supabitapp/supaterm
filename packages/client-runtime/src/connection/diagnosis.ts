import * as DateTime from "effect/DateTime";

import type {
  ConnectionAttemptError,
  ConnectionFailureCause,
  ConnectionHop,
  SupervisorConnectionState,
} from "./model.ts";

export type ConnectionHopResult = "ok" | "failed" | "unchecked";

export interface ConnectionDiagnosisHop {
  readonly hop: ConnectionHop;
  readonly label: string;
  readonly result: ConnectionHopResult;
}

export interface ConnectionDiagnosis {
  readonly headline: string;
  readonly hops: ReadonlyArray<ConnectionDiagnosisHop>;
  readonly steps: ReadonlyArray<string>;
  readonly facts: ReadonlyArray<readonly [label: string, value: string]>;
}

export interface ConnectionDiagnosisInput {
  readonly hostLabel: string;
  readonly state: SupervisorConnectionState;
  readonly via: "relay" | "direct";
  readonly clientVersion?: string | undefined;
  readonly serverVersion?: string | null | undefined;
}

interface Located {
  readonly hop: ConnectionHop;
  readonly cause: ConnectionFailureCause | "offline" | "outdated" | null;
}

function locate(input: ConnectionDiagnosisInput): Located | null {
  const failure = input.state.lastFailure;
  if (input.state.network === "offline" || input.state.phase === "offline") {
    return { hop: "device", cause: "offline" };
  }
  if (failure?._tag === "ConnectionBlockedError" && failure.serverUpdateRequired) {
    return { hop: "server", cause: "outdated" };
  }
  if (failure?.hop !== undefined) {
    return { hop: failure.hop, cause: failure.failureCause ?? null };
  }
  if (failure === null) return null;
  const unreachable =
    failure.reason === "network" || failure.reason === "timeout" || failure.reason === "transport";
  return {
    hop: unreachable && (failure.via ?? input.via) === "relay" ? "tunnel" : "server",
    cause: null,
  };
}

function headline(host: string, located: Located, failure: ConnectionAttemptError | null): string {
  switch (located.cause) {
    case "offline":
      return "This device is offline";
    case "outdated":
      return `${host} runs an older Supaterm`;
    case "host-offline":
      return `${host} is offline`;
    case "relay-busy":
      return "The relay is busy";
    case "relay-timeout":
      return "The relay did not answer in time";
    case "relay-unreachable":
      return "This device can't reach the relay";
    case null:
      break;
  }
  switch (located.hop) {
    case "device":
      return "This device could not prepare the connection";
    case "relay":
      return "This device can't reach the relay";
    case "tunnel":
      return `The relay connection to ${host} was interrupted`;
    case "server":
      return failure?.reason === "authentication" || failure?.reason === "permission"
        ? `Supaterm on ${host} did not accept this device`
        : `Supaterm on ${host} did not answer`;
  }
}

function steps(host: string, located: Located, failure: ConnectionAttemptError | null): string[] {
  const checkHost = `On ${host}, check Settings > Sharing & access.`;
  switch (located.cause) {
    case "offline":
      return ["Connect this device to the internet. Supaterm reconnects on its own."];
    case "outdated":
      return [`Update Supaterm on ${host}.`];
    case "host-offline":
      return [`Make sure ${host} is awake, online, and running Supaterm.`, checkHost];
    case "relay-busy":
    case "relay-timeout":
      return [
        "Wait a moment. Supaterm retries on its own.",
        "If it keeps failing, copy the diagnostics and report it.",
      ];
    case "relay-unreachable":
      return ["Check this device's internet connection, or try another network."];
    case null:
      break;
  }
  switch (located.hop) {
    case "device":
      return [
        "Restart Supaterm on this device.",
        `If it keeps failing, remove ${host} from this device and add it again.`,
      ];
    case "relay":
      return ["Check this device's internet connection, or try another network."];
    case "tunnel":
      return [
        `Make sure ${host} is awake, online, and running Supaterm.`,
        "Check this device's network connection, or try a direct route such as a Tailscale address.",
      ];
    case "server":
      return failure?.reason === "authentication" || failure?.reason === "permission"
        ? [checkHost, "Pair this device again or check its access grants."]
        : [
            `Make sure Supaterm is running on ${host}.`,
            "Retry. If it keeps failing, copy the diagnostics.",
          ];
  }
}

const HOP_ORDER = {
  relay: ["device", "relay", "tunnel", "server"],
  direct: ["device", "server"],
} as const;

function hopLabel(hop: ConnectionHop, host: string): string {
  switch (hop) {
    case "device":
      return "This device";
    case "relay":
      return "Relay";
    case "tunnel":
      return `${host} connection`;
    case "server":
      return `Supaterm on ${host}`;
  }
}

export function presentConnectionDiagnosis(
  input: ConnectionDiagnosisInput,
): ConnectionDiagnosis | null {
  const located = locate(input);
  if (located === null) return null;
  const host = input.hostLabel;
  const failure = input.state.lastFailure;
  const relayPath =
    located.hop === "relay" || located.hop === "tunnel" || (failure?.via ?? input.via) === "relay";
  const order: ReadonlyArray<ConnectionHop> = HOP_ORDER[relayPath ? "relay" : "direct"];
  const failedIndex = order.indexOf(located.hop);
  const unlocatedRelayFailure = relayPath && located.hop === "tunnel" && located.cause === null;
  const hops = order.map((hop, index): ConnectionDiagnosisHop => ({
    hop,
    label: hopLabel(hop, host),
    result:
      index === failedIndex
        ? "failed"
        : index < failedIndex && !(unlocatedRelayFailure && hop === "relay")
          ? "ok"
          : "unchecked",
  }));
  const facts: Array<readonly [string, string]> = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") facts.push([label, String(value)]);
  };
  add("Cause", located.cause ?? failure?.reason);
  add("HTTP status", failure?.httpStatus);
  add("Attempts", input.state.attempt > 0 ? input.state.attempt : null);
  add(
    "Next retry",
    input.state.retryAt === null
      ? null
      : DateTime.formatIso(DateTime.makeUnsafe(input.state.retryAt)),
  );
  add("Route", relayPath ? "Relay" : "Direct");
  add("App version", input.clientVersion);
  add("Host version", input.serverVersion);
  add("Error", failure?.detail);
  add("Trace ID", failure?.traceId);
  return {
    headline: headline(host, located, failure),
    hops,
    steps: steps(host, located, failure),
    facts,
  };
}

const HOP_MARK = { ok: "ok", failed: "FAILED", unchecked: "not checked" } as const;

export function connectionDiagnosisText(hostLabel: string, diagnosis: ConnectionDiagnosis): string {
  return [
    `Supaterm connection to ${hostLabel}: ${diagnosis.headline}`,
    "",
    ...diagnosis.hops.map((hop) => `${hop.label}: ${HOP_MARK[hop.result]}`),
    "",
    ...diagnosis.facts.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}
