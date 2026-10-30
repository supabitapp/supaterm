import {
  type AuthMcpClientAccess,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type OrchestrationV2TurnItem,
  type PeerLinkRequestAnswerInput,
  type PeerLinkSummary,
  resolveEnvironmentMachineKind,
  type ServerConfig,
  type RelayConnectionInfo,
  relayAdvertisementFrom,
} from "@supaterm/contracts";

import * as Option from "effect/Option";
import { isLocalLoopbackHost } from "@supaterm/shared/hostClassification";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";
import type { EnvironmentPresentation } from "./connection/presentation.ts";
import { connectionRoutes, routeHttpBaseUrl } from "./connection/routes.ts";

export type LinkRequestItem = Extract<OrchestrationV2TurnItem, { readonly type: "link_request" }>;

export const offersLinkedEnvironments = (
  config: Pick<ServerConfig, "environment" | "settings"> | null | undefined,
): boolean =>
  config?.environment.capabilities.peerLinks === true && config.settings.linkedEnvironmentsEnabled;

export function linkedEnvironmentNames(input: {
  readonly links: ReadonlyArray<Pick<PeerLinkSummary, "environmentId" | "label" | "status">>;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
}): ReadonlyMap<EnvironmentId, string> {
  const names = new Map(
    input.environments.map((environment) => [environment.environmentId, environment.label]),
  );
  return new Map(
    input.links.flatMap((link) =>
      link.status === "expired"
        ? []
        : [[link.environmentId, names.get(link.environmentId) ?? link.label] as const],
    ),
  );
}

export const linkRequestDefaultAccess = (
  item: Pick<LinkRequestItem, "requestedAccess">,
): AuthMcpClientAccess => item.requestedAccess ?? "approval-required";

export const linkRequestTargetName = (item: Pick<LinkRequestItem, "label" | "url">): string =>
  item.label?.trim() || item.url || "a machine";

export interface LinkableMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
  readonly connected: boolean;

  readonly connectOnly: false;

  readonly linked: boolean;

  readonly urls: ReadonlyArray<string>;
  readonly relay?: RelayConnectionInfo;
}

function directPeerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !isLocalLoopbackHost(url.hostname) &&
      canonicalRelayAddress(value) === null
    );
  } catch {
    return false;
  }
}

export function linkableMachines(input: {
  readonly environments: ReadonlyArray<
    EnvironmentPresentation & { readonly environmentId: EnvironmentId }
  >;
  readonly threadEnvironmentId: EnvironmentId;
  readonly links: ReadonlyArray<Pick<PeerLinkSummary, "environmentId" | "status">>;
}): ReadonlyArray<LinkableMachine> {
  const linkedIds = new Set(
    input.links.flatMap((link) => (link.status === "expired" ? [] : [link.environmentId])),
  );
  const saved = input.environments
    .filter((environment) => environment.environmentId !== input.threadEnvironmentId)
    .map((environment) => {
      const reported = (environment.serverConfig?.directEndpoints ?? []).map(
        (endpoint) => endpoint.httpBaseUrl,
      );
      const knownRoutes = connectionRoutes(environment.entry);
      let relay =
        environment.serverConfig === null
          ? null
          : relayAdvertisementFrom(environment.serverConfig.environment);
      const routes = knownRoutes.flatMap((route) => {
        const profile = Option.getOrNull(route.profile);
        if (
          relay === null &&
          profile?._tag === "BearerConnectionProfile" &&
          profile.relayUrl !== undefined
        ) {
          const relayEndpoint = canonicalRelayAddress(profile.httpBaseUrl);
          if (relayEndpoint !== null) relay = { relayEndpoint, relayUrl: profile.relayUrl };
        }
        const url = routeHttpBaseUrl(route);
        return url === null ? [] : [url];
      });
      return {
        environmentId: environment.environmentId,
        label: environment.entry.target.label,
        machine: resolveEnvironmentMachineKind(environment.serverConfig),
        connected: environment.connection.phase === "connected",
        connectOnly: false as const,
        linked: linkedIds.has(environment.environmentId),
        urls: [...new Set([...reported, ...routes])].filter(directPeerUrl),
        ...(relay === null ? {} : { relay }),
      };
    });
  return saved;
}

const words = (text: string) =>
  ` ${text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .join(" ")
    .trim()} `;
const NO_MATCH = 4;

const hintRank = (label: string, hint: string) => {
  const name = label.trim().toLowerCase();
  const wanted = hint
    .trim()
    .toLowerCase()
    .replace(/^(?:my|our|the)\s+/, "");
  if (name === wanted) return 0;
  if (name.startsWith(wanted)) return 1;
  if (name.includes(wanted)) return 2;
  if (words(wanted).includes(words(name))) return 3;
  return NO_MATCH;
};

export function rankMachinesByHint<T extends { readonly label: string }>(
  machines: ReadonlyArray<T>,
  hint: string | undefined,
): ReadonlyArray<T> {
  if (hint === undefined || hint.trim().length === 0) return machines;
  return machines
    .map((machine, index) => ({ machine, index, rank: hintRank(machine.label, hint) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ machine }) => machine);
}

export function linkRequestInitialMachine(
  item: Pick<LinkRequestItem, "environmentId" | "hint">,
  machines: ReadonlyArray<LinkableMachine>,
): EnvironmentId | null {
  if (item.environmentId !== undefined) return item.environmentId;
  if (item.hint === undefined) return null;
  const [best] = rankMachinesByHint(machines, item.hint);
  return best !== undefined && hintRank(best.label, item.hint) < NO_MATCH
    ? best.environmentId
    : null;
}

export type LinkRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | {
      readonly kind: "answered";
      readonly outcome: "linked" | "declined" | "ended" | "failed";
      readonly label: string;
    };

export function linkRequestDisplay(
  item: Pick<
    LinkRequestItem,
    "linkStatus" | "label" | "url" | "linkedLabel" | "linkedAccess" | "failure"
  >,
  visibility: "local" | "inherited" | "synthetic",
  accessLabel: (access: AuthMcpClientAccess) => string,
): LinkRequestDisplay {
  switch (item.linkStatus) {
    case "pending":
      return visibility === "local"
        ? { kind: "pending" }
        : { kind: "pending-elsewhere", label: "Waiting for an answer in the original thread" };
    case "linked":
      return {
        kind: "answered",
        outcome: "linked",
        label: `Linked ${item.linkedLabel ?? linkRequestTargetName(item)}${
          item.linkedAccess === undefined ? "" : ` · ${accessLabel(item.linkedAccess)}`
        }`,
      };
    case "declined":
      return { kind: "answered", outcome: "declined", label: "Declined" };
    case "failed":
      return {
        kind: "answered",
        outcome: "failed",
        label: `Could not link: ${item.failure ?? "the other environment refused"}`,
      };
    case "cancelled":
      return { kind: "answered", outcome: "ended", label: "Request ended" };
  }
}

export function linkRequestAnswerInput(
  item: Pick<LinkRequestItem, "id" | "threadId">,
  answer:
    | {
        readonly type: "link";

        readonly target:
          | Pick<LinkableMachine, "environmentId" | "label" | "urls" | "relay">
          | { readonly url: string };
        readonly access: AuthMcpClientAccess;
        readonly pairingCode: string;
      }
    | { readonly type: "use-existing"; readonly environmentId: EnvironmentId }
    | { readonly type: "decline" },
): PeerLinkRequestAnswerInput | null {
  const base = { threadId: item.threadId, turnItemId: item.id };
  if (answer.type !== "link") return { ...base, answer };
  const pairingCode = answer.pairingCode.trim();
  if (pairingCode.length === 0) return null;
  const { target } = answer;
  if ("url" in target) {
    const url = target.url.trim();
    if (url.length === 0) return null;
    return { ...base, answer: { type: "link", urls: [url], access: answer.access, pairingCode } };
  }
  const [first, ...rest] = target.urls;
  if (first === undefined && target.relay === undefined) return null;
  return {
    ...base,
    answer: {
      type: "link",
      environmentId: target.environmentId,
      label: target.label,
      urls: first === undefined ? [] : [first, ...rest],
      ...(target.relay === undefined ? {} : { relay: target.relay }),
      access: answer.access,
      pairingCode,
    },
  };
}

const USER_FACING_FAILURE_TAGS = new Set([
  "PeerLinkRequestError",
  "EnvironmentAuthorizationError",
  "PeerPairingCodeError",
]);

export function linkRequestFailureMessage(failure: unknown): string {
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
  return "Could not answer the request. Try again.";
}
