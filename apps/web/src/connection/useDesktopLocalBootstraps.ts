import { useAtomValue } from "@effect/atom-react";
import type { DesktopEnvironmentBootstrap } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { readDesktopSecondaryBootstraps } from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 2_000;

const desktopLocalBootstrapsAtom = Atom.make((get) => {
  const interval = setInterval(
    () => get.setSelf(readDesktopSecondaryBootstraps()),
    DESKTOP_LOCAL_BOOTSTRAP_POLL_MS,
  );
  get.addFinalizer(() => clearInterval(interval));
  return readDesktopSecondaryBootstraps();
}).pipe(Atom.withLabel("desktop-local-bootstraps"));

export function useDesktopLocalBootstraps() {
  return useAtomValue(
    desktopLocalBootstrapsAtom,
  ) satisfies ReadonlyArray<DesktopEnvironmentBootstrap>;
}
