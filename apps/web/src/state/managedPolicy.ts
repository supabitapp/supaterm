import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ManagedPolicySummary } from "@supaterm/contracts";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";

const managedPolicyAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get): ManagedPolicySummary | undefined =>
      get(environmentPresentations.serverConfigsAtom).get(environmentId)?.managedPolicy,
  ).pipe(Atom.withEquality(Equal.equals), Atom.withLabel(`managed-policy:${environmentId}`)),
);
const UNMANAGED_ATOM = Atom.make<ManagedPolicySummary | undefined>(undefined);

/** The policy an environment's administrator applies, or undefined when it is unmanaged. */
export function useManagedPolicy(
  environmentId: EnvironmentId | null | undefined,
): ManagedPolicySummary | undefined {
  return useAtomValue(environmentId == null ? UNMANAGED_ATOM : managedPolicyAtom(environmentId));
}

export function readManagedPolicy(environmentId: EnvironmentId): ManagedPolicySummary | undefined {
  return appAtomRegistry.get(managedPolicyAtom(environmentId));
}

export function usePrimaryManagedPolicy(): ManagedPolicySummary | undefined {
  return useManagedPolicy(useAtomValue(primaryEnvironmentIdAtom));
}
