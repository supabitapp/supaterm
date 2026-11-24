import { RegistryContext } from "@effect/atom-react";
import {
  linkableMachines,
  linkedEnvironmentNames,
  supportsLinkedThreadReads,
  supportsPeerLinks,
} from "@supaterm/client-runtime/link-request";
import { createPeerLinkEnvironmentAtoms } from "@supaterm/client-runtime/state/peerLinks";
import type { EnvironmentId } from "@supaterm/contracts";
import { hasThreadLinks, threadLinkRefs } from "@supaterm/shared/threadLinks";
import { useContext, useEffect, useEffectEvent, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments } from "./environments";
import { useEnvironmentQuery } from "./query";

export const peerLinkEnvironment = createPeerLinkEnvironmentAtoms(connectionAtomRuntime);

/**
 * The machines `environmentId` links to, by name, while it offers links, and none otherwise.
 * Its agents can read threads there, and so can a client allowed to read threads on it.
 * A `wanted` machine this app is not connected to and the names lack makes them reread.
 */
export function useLinkedEnvironments(
  environmentId: EnvironmentId | null,
  wanted: ReadonlyArray<EnvironmentId> = [],
): ReadonlyMap<EnvironmentId, string> {
  const { environments } = useEnvironments();
  const config = environments.find(
    (environment) => environment.environmentId === environmentId,
  )?.serverConfig;
  const offered = supportsPeerLinks(config);
  const namesLinks = supportsLinkedThreadReads(config);
  const queried = offered && environmentId !== null;
  const names = useEnvironmentQuery(
    queried && namesLinks ? peerLinkEnvironment.names({ environmentId, input: {} }) : null,
  );
  // An older server only lists its links, which takes access to read them.
  const listed = useEnvironmentQuery(
    queried && !namesLinks ? peerLinkEnvironment.list({ environmentId, input: {} }) : null,
  );
  const links = names.data?.links ?? listed.data?.links;
  const connected = new Set(
    environments
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => environment.environmentId),
  );
  const namesSource = queried && namesLinks ? environmentId : null;
  const missing = [...new Set(wanted)].filter((id) => id !== environmentId && !connected.has(id));
  const refreshKey =
    namesSource === null || missing.length === 0
      ? ""
      : [namesSource, ...[...missing].sort()].join(" ");
  const registry = useContext(RegistryContext);
  const refreshLacking = useEffectEvent(() => {
    if (namesSource !== null)
      peerLinkEnvironment.refreshNamesLacking(registry, namesSource, missing);
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- links made outside this app are not pushed, so meeting an unknown machine asks the server again
  useEffect(() => {
    if (refreshKey !== "") refreshLacking();
  }, [refreshKey]);
  return useMemo(
    () => linkedEnvironmentNames({ links: offered ? (links ?? []) : [], environments }),
    [environments, links, offered],
  );
}

/** Rereads `environmentId`'s link names when a message links a thread on a machine they lack. */
export function useLinkedThreadLinkNames(markdown: string, environmentId: EnvironmentId) {
  const linksThreads = hasThreadLinks(markdown);
  useLinkedEnvironments(
    linksThreads ? environmentId : null,
    linksThreads ? threadLinkRefs(markdown, environmentId).map((ref) => ref.environmentId) : [],
  );
}

/** Whether this app can read threads on the machines `environmentId` links to, through it. */
export function useSupportsLinkedThreadReads(environmentId: EnvironmentId | null): boolean {
  const { presentationById } = useEnvironments();
  return (
    environmentId !== null &&
    supportsLinkedThreadReads(presentationById.get(environmentId)?.serverConfig)
  );
}

/**
 * The user's other machines, for picking one to link `environmentId` to. Reads that
 * environment's links only while `enabled`, since listing them asks every linked machine
 * whether it answers.
 */
export function useLinkableMachines(environmentId: EnvironmentId, enabled: boolean) {
  const { environments } = useEnvironments();
  const links = useEnvironmentQuery(
    enabled ? peerLinkEnvironment.list({ environmentId, input: {} }) : null,
  );
  return linkableMachines({
    environments,
    threadEnvironmentId: environmentId,
    links: links.data?.links ?? [],
  });
}
