import {
  linkableMachines,
  linkedEnvironmentNames,
  offersLinkedEnvironments,
} from "@supaterm/client-runtime/link-request";
import { createPeerLinkEnvironmentAtoms } from "@supaterm/client-runtime/state/peerLinks";
import type { EnvironmentId } from "@supaterm/contracts";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments } from "./environments";
import { useEnvironmentQuery } from "./query";

const NO_LINKED_ENVIRONMENTS: ReadonlyMap<EnvironmentId, string> = new Map();

export const peerLinkEnvironment = createPeerLinkEnvironmentAtoms(connectionAtomRuntime);

/**
 * The machines `environmentId` links to, by name, while it offers links, and none otherwise.
 * Its agents can read threads there. Listing asks each linked machine whether it answers, so
 * every caller shares one briefly cached list.
 */
export function useLinkedEnvironments(
  environmentId: EnvironmentId | null,
): ReadonlyMap<EnvironmentId, string> {
  const { environments } = useEnvironments();
  const offered = offersLinkedEnvironments(
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig,
  );
  const links = useEnvironmentQuery(
    offered && environmentId !== null
      ? peerLinkEnvironment.list({ environmentId, input: {} })
      : null,
  );
  return useMemo(
    () =>
      !offered || !links.data?.links.length
        ? NO_LINKED_ENVIRONMENTS
        : linkedEnvironmentNames({ links: links.data.links, environments }),
    [environments, links.data, offered],
  );
}

/**
 * The user's other machines, for picking one to link `environmentId` to,
 * including those only on their relay account. Reads that environment's
 * links only while `enabled`, since listing them asks every linked machine
 * whether it answers.
 */
export function useLinkableMachines(environmentId: EnvironmentId, enabled: boolean) {
  const { environments } = useEnvironments();
  const links = useEnvironmentQuery(
    enabled ? peerLinkEnvironment.list({ environmentId, input: {} }) : null,
  );
  return useMemo(
    () =>
      linkableMachines({
        environments,
        threadEnvironmentId: environmentId,
        links: links.data?.links ?? [],
      }),
    [environmentId, environments, links.data],
  );
}
