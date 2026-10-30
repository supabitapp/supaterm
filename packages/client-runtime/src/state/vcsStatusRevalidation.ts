// @effect-diagnostics globalTimers:off - The wake debounce runs in an atom subscription, outside an Effect runtime.
import type { EnvironmentId } from "@supaterm/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { type AtomCommand, type AtomCommandResult, runAtomCommand } from "./runtime.ts";

export interface VcsStatusRevalidationTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export function createVcsStatusRevalidationAtomFamily<R>(input: {
  readonly refreshStatus: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: { readonly cwd: string } },
    R,
    unknown
  >;
  readonly connected?: (environmentId: EnvironmentId) => Atom.Atom<boolean>;
  readonly subscribeWake?: (wake: () => void) => () => void;
  readonly wakeDebounceMs?: number;
  readonly onRefreshed?: (result: AtomCommandResult<R, unknown>) => void;
}) {
  const family = Atom.family((target: VcsStatusRevalidationTarget) => {
    const { environmentId, cwd } = target;
    const key = `${environmentId}:${cwd}`;

    const refresh = async (registry: AtomRegistry.AtomRegistry) => {
      const result = await runAtomCommand(
        registry,
        input.refreshStatus,
        { environmentId, input: { cwd } },
        { reportFailure: false },
      );
      input.onRefreshed?.(result);
    };

    const wakeAtom = Atom.make((get) => {
      const subscribeWake = input.subscribeWake;
      if (subscribeWake === undefined) return;
      const registry = get.registry;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeWake(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void refresh(registry);
        }, input.wakeDebounceMs ?? 0);
      });
      get.addFinalizer(() => {
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
      });
    }).pipe(Atom.withLabel(`vcs-status-revalidation:wake:${key}`));

    return Atom.make((get) => {
      get(wakeAtom);
      const connected = input.connected;
      if (connected !== undefined && get(connected(environmentId))) {
        void refresh(get.registry);
      }
    }).pipe(Atom.withLabel(`vcs-status-revalidation:${key}`));
  });
  const idle = Atom.make<void>(undefined).pipe(Atom.withLabel("vcs-status-revalidation:idle"));
  return (target: VcsStatusRevalidationTarget | null): Atom.Atom<void> =>
    target === null ? idle : family({ environmentId: target.environmentId, cwd: target.cwd });
}
