import type { EnvironmentId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentShellState } from "./shell.ts";

export function createEnvironmentSnapshotAtom<E>(
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
) {
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.match(AsyncResult.value(get(shellStateAtom(environmentId))), {
        onNone: () => null,
        onSome: (state) => Option.getOrNull(state.snapshot),
      }),
    ).pipe(Atom.withLabel(`environment-snapshot:${environmentId}`)),
  );
}
