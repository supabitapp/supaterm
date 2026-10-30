import {
  linkableMachines,
  linkedEnvironmentNames,
  offersLinkedEnvironments,
} from "@supaterm/client-runtime/link-request";
import { createPeerLinkEnvironmentAtoms } from "@supaterm/client-runtime/state/peerLinks";
import { AuthAccessReadScope, type EnvironmentId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { useAtomValue } from "@effect/atom-react";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentIdentities, useEnvironments } from "./environments";
import { environmentPresentations } from "./presentation";
import { useEnvironmentQuery } from "./query";
import { useEnvironmentScope, useEnvironmentsWithScope } from "./session";

export const peerLinkEnvironment = createPeerLinkEnvironmentAtoms(connectionAtomRuntime);

/** Whether `environmentId` offers links, so its threads may name another machine. */
export const offersLinkedEnvironmentsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    offersLinkedEnvironments(get(environmentPresentations.serverConfigsAtom).get(environmentId)),
  ).pipe(Atom.withLabel(`peer-links:offered:${environmentId}`)),
);

const offersNoLinksAtom = Atom.make(false);

export function useLinkedEnvironments(
  environmentId: EnvironmentId | null,
): ReadonlyMap<EnvironmentId, string> {
  const offered = useAtomValue(
    environmentId === null ? offersNoLinksAtom : offersLinkedEnvironmentsAtom(environmentId),
  );
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const identities = useEnvironmentIdentities();
  const links = useEnvironmentQuery(
    offered && canRead && environmentId !== null
      ? peerLinkEnvironment.list({ environmentId, input: {} })
      : null,
  );
  return linkedEnvironmentNames({
    links: offered && canRead ? (links.data?.links ?? []) : [],
    environments: identities,
  });
}

export function usePeerLinkHosts() {
  const { environments } = useEnvironments();
  const supported = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      offersLinkedEnvironments(environment.serverConfig),
  );
  const readable = useEnvironmentsWithScope(supported, AuthAccessReadScope);
  return supported.filter((environment) => readable.has(environment.environmentId));
}

/**
 * The user's other machines, for picking one to link `environmentId` to,
 * from configured local, direct and encrypted relay connections. Reads that environment's
 * links only while `enabled`, since listing them asks every linked machine
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
