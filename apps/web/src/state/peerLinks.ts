import { useAtomValue } from "@effect/atom-react";
import {
  type LinkableMachine,
  linkableMachines,
  linkedEnvironmentNames,
  machineLinkInput,
  supportsLinkedThreadReads,
  supportsLinkPairingForLink,
  supportsPeerLinks,
} from "@supaterm/client-runtime/link-request";
import {
  createPeerLinkEnvironmentAtoms,
  type LinkIntermediary,
  linkIntermediaries,
  type LinkPairingRoute,
} from "@supaterm/client-runtime/state/peerLinks";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  type AuthMcpClientAccess,
  type EnvironmentId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { useEnvironmentIdentities, useEnvironments, usePrimaryEnvironmentId } from "./environments";
import { mintPairingCodeOn } from "./peerPairingCode";
import { environmentPresentations } from "./presentation";
import { useEnvironmentQuery } from "./query";
import { useEnvironmentsWithScope } from "./session";

export const peerLinkEnvironment = createPeerLinkEnvironmentAtoms(connectionAtomRuntime);

/** Whether `environmentId` offers links, so its threads may name another machine. */
export const supportsPeerLinksAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    supportsPeerLinks(get(environmentPresentations.serverConfigsAtom).get(environmentId)),
  ).pipe(Atom.withLabel(`peer-links:offered:${environmentId}`)),
);

/** Whether a client of `environmentId` can read the threads on the machines it links to. */
const supportsLinkedThreadReadsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    supportsLinkedThreadReads(get(environmentPresentations.serverConfigsAtom).get(environmentId)),
  ).pipe(Atom.withLabel(`peer-links:linked-thread-reads:${environmentId}`)),
);

const noPeerLinksAtom = Atom.make(false).pipe(Atom.withLabel("peer-links:offered:none"));

/**
 * The machines `environmentId` links to, by name, while it offers links, and none otherwise.
 * Its agents can read threads there, and so can a client allowed to read threads on it.
 */
export function useLinkedEnvironments(
  environmentId: EnvironmentId | null,
): ReadonlyMap<EnvironmentId, string> {
  const offered = useAtomValue(
    environmentId === null ? noPeerLinksAtom : supportsPeerLinksAtom(environmentId),
  );
  const namesLinks = useSupportsLinkedThreadReads(environmentId);
  const identities = useEnvironmentIdentities();
  const queried = offered && environmentId !== null;
  const names = useEnvironmentQuery(
    queried && namesLinks ? peerLinkEnvironment.names({ environmentId, input: {} }) : null,
  );
  // An older server only lists its links, which takes access to read them.
  const listed = useEnvironmentQuery(
    queried && !namesLinks ? peerLinkEnvironment.list({ environmentId, input: {} }) : null,
  );
  return linkedEnvironmentNames({
    links: offered ? (names.data?.links ?? listed.data?.links ?? []) : [],
    environments: identities,
  });
}

/** Whether a client can read threads on the machines `environmentId` links to, through it. */
export function useSupportsLinkedThreadReads(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(
    environmentId === null ? noPeerLinksAtom : supportsLinkedThreadReadsAtom(environmentId),
  );
}

/**
 * What `viaEnvironmentId` calls the machine `environmentId` it links to, while a client can read
 * that machine's threads through it; undefined otherwise.
 */
export function useLinkedThreadLabel(
  viaEnvironmentId: EnvironmentId | null,
  environmentId: EnvironmentId | null,
): string | undefined {
  const reads = useSupportsLinkedThreadReads(viaEnvironmentId);
  const links = useLinkedEnvironments(reads ? viaEnvironmentId : null);
  return environmentId === null ? undefined : links.get(environmentId);
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

const pairLinkPermissionsAtom = environmentAtomList(
  "peer-links:pair-link-permissions",
  peerLinkEnvironment.pairLink.permissionAtom,
);

/**
 * The connected environments that can get a pairing code from `targetId` for this app: they
 * link to it at full access, and this app may read their links and ask them for one. Reads
 * those links only while `enabled`: listing them asks every linked machine whether it answers.
 */
export function useLinkIntermediaries(
  targetId: EnvironmentId,
  enabled: boolean,
  now: DateTime.Utc,
): ReadonlyArray<LinkIntermediary> {
  const { environments } = useEnvironments();
  const candidates = enabled
    ? environments.filter(
        (environment) =>
          environment.environmentId !== targetId &&
          environment.connection.phase === "connected" &&
          supportsLinkPairingForLink(environment.serverConfig),
      )
    : [];
  const listable = useEnvironmentsWithScope(candidates, AuthAccessReadScope);
  const pairable = useAtomValue(
    pairLinkPermissionsAtom(environmentIdsKey(candidates.map((host) => host.environmentId))),
  );
  const hosts = candidates.filter(
    (host, index) => listable.has(host.environmentId) && pairable[index] === true,
  );
  const lists = useAtomValue(peerLinkEnvironment.lists(hosts.map((host) => host.environmentId)));
  return linkIntermediaries({
    targetId,
    hosts: hosts.map(({ environmentId, label }, index) => {
      const list = lists[index];
      return { environmentId, label, links: list?._tag === "Success" ? list.value.links : [] };
    }),
    now,
  });
}

/** A pairing code for a link to `machine`, which `intermediary` gets from it over its own link. */
async function mintPairingCodeThrough(
  intermediary: LinkIntermediary,
  machine: LinkableMachine,
  access: AuthMcpClientAccess,
): Promise<Result.Result<string, unknown>> {
  const result = await runAtomCommand(
    appAtomRegistry,
    peerLinkEnvironment.pairLink,
    {
      environmentId: intermediary.environmentId,
      input: { environmentId: machine.environmentId, access },
    },
    // The answer is a credential; keep it out of the console.
    { reportFailure: false, reportDefect: false },
  );
  if (result._tag === "Success" && result.value.type === "credential") {
    return Result.succeed(result.value.credential);
  }
  return Result.fail(
    result._tag === "Success"
      ? new Error(`Could not get a pairing code from ${machine.label} through another machine.`)
      : squashAtomCommandFailure(result),
  );
}

export type KnownMachineLinkResult =
  | { readonly _tag: "Linked"; readonly label: string }
  | { readonly _tag: "MintFailed"; readonly failure: unknown }
  | { readonly _tag: "LinkFailed"; readonly failure: unknown }
  | { readonly _tag: "Interrupted" };

/**
 * Links `sourceId` to a machine this app knows, with a pairing code `route` gets from it. A failed
 * mint stays apart from a failed link, so a dialog can ask for a pasted code instead.
 */
export async function linkKnownMachine(input: {
  readonly sourceId: EnvironmentId;
  readonly machine: LinkableMachine;
  readonly access: AuthMcpClientAccess;
  readonly route: LinkPairingRoute;
}): Promise<KnownMachineLinkResult> {
  const minted =
    input.route._tag === "Direct"
      ? await mintPairingCodeOn(input.machine.environmentId, input.access)
      : await mintPairingCodeThrough(input.route.intermediary, input.machine, input.access);
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
  const result = await runAtomCommand(appAtomRegistry, peerLinkEnvironment.link, {
    environmentId: input.sourceId,
    input: linkInput,
  });
  if (result._tag === "Success") return { _tag: "Linked", label: result.value.label };
  return isAtomCommandInterrupted(result)
    ? { _tag: "Interrupted" }
    : { _tag: "LinkFailed", failure: squashAtomCommandFailure(result) };
}
