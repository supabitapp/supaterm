import { Atom } from "effect/reactivity";

import { subscribeAppActive } from "./appState";

export function makePermissionStatusAtom<S>(options: {
  readonly label: string;
  readonly initial: S;
  readonly read: () => Promise<S>;
}): Atom.Writable<S, S> {
  return Atom.writable(
    (get) => {
      const refresh = () => {
        void options.read().then((status) => get.setSelf(status));
      };
      refresh();
      get.addFinalizer(subscribeAppActive(refresh));
      return options.initial;
    },
    (ctx, status: S) => ctx.setSelf(status),
  ).pipe(Atom.withLabel(options.label));
}
