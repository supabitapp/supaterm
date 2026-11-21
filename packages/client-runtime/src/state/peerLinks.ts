import { type EnvironmentId, type PeerLinkSummary, WS_METHODS } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createPeerLinkEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:peer-links:list",
    tag: WS_METHODS.peerLinksList,
    // Listing probes every linked environment, so a list stays fresh briefly.
    staleTimeMs: 10_000,
  });
  // Several environments' lists in one subscription, keyed by their ids joined with newlines.
  const lists = Atom.family((key: string) =>
    Atom.make((get) =>
      key === ""
        ? []
        : (key.split("\n") as EnvironmentId[]).map((environmentId) =>
            get(list({ environmentId, input: {} })),
          ),
    ).pipe(Atom.withLabel(`environment-data:peer-links:lists:${key}`)),
  );
  return {
    list,
    lists: (environmentIds: ReadonlyArray<EnvironmentId>) => lists(environmentIds.join("\n")),
    link: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-links:link",
      tag: WS_METHODS.peerLinksLink,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(list({ environmentId, input: {} }))),
    }),
    unlink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-links:unlink",
      tag: WS_METHODS.peerLinksUnlink,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(list({ environmentId, input: {} }))),
    }),
    // An agent's link card. One answer per card at a time.
    answerRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-links:answer-request",
      tag: WS_METHODS.peerLinksAnswerRequest,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.threadId, input.turnItemId]),
      },
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(list({ environmentId, input: {} }))),
    }),
  };
}

const EXPIRY_WARNING_DAYS = 5;

export type PeerLinkHealth =
  | { readonly kind: "reachable"; readonly expiresInDays: number | null }
  | { readonly kind: "unreachable"; readonly detail: string | null }
  | { readonly kind: "failing"; readonly detail: string }
  | { readonly kind: "expired" };

/**
 * Listing only checks that the peer answers, so a link whose last call failed
 * (the peer revoked it, say) is `failing` with the recorded reason; the next
 * successful call clears it.
 */
export function peerLinkHealth(link: PeerLinkSummary, now: DateTime.Utc): PeerLinkHealth {
  if (link.status === "expired" || DateTime.isLessThanOrEqualTo(link.expiresAt, now)) {
    return { kind: "expired" };
  }
  if (link.status === "unreachable") return { kind: "unreachable", detail: link.lastError };
  if (link.lastError !== null) return { kind: "failing", detail: link.lastError };
  const days = Math.ceil(Duration.toDays(DateTime.distance(now, link.expiresAt)));
  return { kind: "reachable", expiresInDays: days <= EXPIRY_WARNING_DAYS ? days : null };
}

/** How a link's health reads in settings. */
export function peerLinkHealthText(health: PeerLinkHealth): string {
  switch (health.kind) {
    case "expired":
      return "Expired. Link it again.";
    case "unreachable":
      return health.detail ?? "Not answering right now.";
    case "failing":
      return health.detail;
    case "reachable":
      return health.expiresInDays === null
        ? "Reachable"
        : `Expires in ${health.expiresInDays} ${health.expiresInDays === 1 ? "day" : "days"}. Link it again to renew.`;
  }
}

/**
 * For each environment, the names of the given sources whose unexpired links reach it,
 * so a machine can show which others may work on it.
 */
export function incomingLinkNames(input: {
  readonly sources: ReadonlyArray<{
    readonly label: string;
    readonly links: ReadonlyArray<PeerLinkSummary>;
  }>;
  readonly now: DateTime.Utc;
}): ReadonlyMap<EnvironmentId, ReadonlyArray<string>> {
  const incoming = new Map<EnvironmentId, ReadonlyArray<string>>();
  for (const source of input.sources) {
    for (const link of source.links) {
      if (peerLinkHealth(link, input.now).kind === "expired") continue;
      incoming.set(link.environmentId, [...(incoming.get(link.environmentId) ?? []), source.label]);
    }
  }
  return incoming;
}
