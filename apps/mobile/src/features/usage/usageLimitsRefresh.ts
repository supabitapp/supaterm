import { EnvironmentId } from "@supaterm/contracts";
import { runAtomCommand } from "@supaterm/client-runtime/state/runtime";
import { refreshUsageLimits } from "@supaterm/client-runtime/state/usage";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { serverEnvironment } from "../../state/server";

const limitsRefreshFailedAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(false).pipe(Atom.withLabel(`mobile:limits-refresh-failed:${environmentId}`)),
);

export async function refreshEnvironmentLimits(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  options: { readonly automatic?: boolean; readonly afterPending?: boolean } = {},
): Promise<void> {
  const result = await refreshUsageLimits(
    environmentId,
    () =>
      runAtomCommand(
        registry,
        serverEnvironment.refreshProviders,
        { environmentId, input: {} },
        { reportFailure: false },
      ),
    options.automatic,
    options.afterPending,
  );
  if (result === undefined) return;
  registry.set(limitsRefreshFailedAtom(environmentId), result._tag === "Failure");
}

const limitsAutoRefreshAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    void refreshEnvironmentLimits(get.registry, environmentId, { automatic: true });
  }).pipe(Atom.withLabel(`mobile:limits-auto-refresh:${environmentId}`)),
);

export function environmentIdsKey(environmentIds: Iterable<EnvironmentId>): string {
  return [...environmentIds].sort().join(",");
}

function splitEnvironmentIds(key: string): EnvironmentId[] {
  return key === "" ? [] : key.split(",").map((id) => EnvironmentId.make(id));
}

export const limitsAutoRefreshSetAtom = Atom.family((environmentIds: string) =>
  Atom.make((get) => {
    for (const environmentId of splitEnvironmentIds(environmentIds)) {
      get(limitsAutoRefreshAtom(environmentId));
    }
  }),
);

export const limitsRefreshFailuresAtom = Atom.family((environmentIds: string) =>
  Atom.make((get) =>
    splitEnvironmentIds(environmentIds).filter((environmentId) =>
      get(limitsRefreshFailedAtom(environmentId)),
    ),
  ),
);
