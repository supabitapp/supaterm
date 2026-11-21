import { useAtomValue } from "@effect/atom-react";
import {
  type LinkableMachine,
  linkableMachines,
  linkedEnvironmentNames,
  machineLinkInput,
  supportsPeerLinks,
} from "@supaterm/client-runtime/link-request";
import { createPeerLinkEnvironmentAtoms } from "@supaterm/client-runtime/state/peerLinks";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { AuthMcpClientAccess, EnvironmentId } from "@supaterm/contracts";
import * as Result from "effect/Result";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentIdentities, useEnvironments, usePrimaryEnvironmentId } from "./environments";
import { mintPairingCodeOn } from "./peerPairingCode";
import { environmentPresentations } from "./presentation";
import { useEnvironmentQuery } from "./query";

export const peerLinkEnvironment = createPeerLinkEnvironmentAtoms(connectionAtomRuntime);

/** Whether `environmentId` offers links, so its threads may name another machine. */
export const supportsPeerLinksAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    supportsPeerLinks(get(environmentPresentations.serverConfigsAtom).get(environmentId)),
  ).pipe(Atom.withLabel(`peer-links:offered:${environmentId}`)),
);

const noPeerLinksAtom = Atom.make(false).pipe(Atom.withLabel("peer-links:offered:none"));

/**
 * The machines `environmentId` links to, by name, while it offers links, and none otherwise.
 * Its agents can read threads there. Listing asks each linked machine whether it answers, so
 * every caller shares one briefly cached list.
 */
export function useLinkedEnvironments(
  environmentId: EnvironmentId | null,
): ReadonlyMap<EnvironmentId, string> {
  const offered = useAtomValue(
    environmentId === null ? noPeerLinksAtom : supportsPeerLinksAtom(environmentId),
  );
  const identities = useEnvironmentIdentities();
  const links = useEnvironmentQuery(
    offered && environmentId !== null
      ? peerLinkEnvironment.list({ environmentId, input: {} })
      : null,
  );
  return linkedEnvironmentNames({
    links: offered ? (links.data?.links ?? []) : [],
    environments: identities,
  });
}

export function usePeerLinkHosts() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isPrimary = (environment: (typeof environments)[number]) =>
    Number(environment.environmentId === primaryEnvironmentId);
  return environments
    .filter(
      (environment) =>
        environment.connection.phase === "connected" && supportsPeerLinks(environment.serverConfig),
    )
    .toSorted((left, right) => isPrimary(right) - isPrimary(left));
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

export type KnownMachineLinkResult =
  | { readonly _tag: "Linked"; readonly label: string }
  | { readonly _tag: "MintFailed"; readonly failure: unknown }
  | { readonly _tag: "LinkFailed"; readonly failure: unknown }
  | { readonly _tag: "Interrupted" };

/**
 * Links `sourceId` to a machine this app knows, with a pairing code this app mints there.
 * A failed mint stays apart from a failed link, so a dialog can ask for a pasted code instead.
 */
export async function linkKnownMachine(input: {
  readonly sourceId: EnvironmentId;
  readonly machine: LinkableMachine;
  readonly access: AuthMcpClientAccess;
}): Promise<KnownMachineLinkResult> {
  const minted = await mintPairingCodeOn(input.machine.environmentId, input.access);
  if (Result.isFailure(minted)) return { _tag: "MintFailed", failure: minted.failure };
  const linkInput = machineLinkInput(input.machine, minted.success, input.access);
  if (linkInput === null) {
    return {
      _tag: "LinkFailed",
      failure: new Error(
        `No other machine can reach ${input.machine.label} at an address this app knows.`,
      ),
    };
  }
  const result = await peerLinkEnvironment.link.run(appAtomRegistry, {
    environmentId: input.sourceId,
    input: linkInput,
  });
  if (result._tag === "Success") return { _tag: "Linked", label: result.value.label };
  return isAtomCommandInterrupted(result)
    ? { _tag: "Interrupted" }
    : { _tag: "LinkFailed", failure: squashAtomCommandFailure(result) };
}
