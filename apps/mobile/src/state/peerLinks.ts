import {
  linkableMachines,
  linkedEnvironmentNames,
  supportsLinkedThreadReads,
  supportsPeerLinks,
} from "@supaterm/client-runtime/link-request";
import { createPeerLinkEnvironmentAtoms } from "@supaterm/client-runtime/state/peerLinks";
import type { EnvironmentId } from "@supaterm/contracts";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments } from "./environments";
import { useEnvironmentQuery } from "./query";

export const peerLinkEnvironment = createPeerLinkEnvironmentAtoms(connectionAtomRuntime);

/**
 * The machines `environmentId` links to, by name, while it offers links, and none otherwise.
 * Its agents can read threads there, and so can a client allowed to read threads on it.
 */
export function useLinkedEnvironments(
  environmentId: EnvironmentId | null,
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
  return useMemo(
    () => linkedEnvironmentNames({ links: offered ? (links ?? []) : [], environments }),
    [environments, links, offered],
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
