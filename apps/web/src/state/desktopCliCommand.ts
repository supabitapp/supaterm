import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

class DesktopCliCommandUnavailableError extends Schema.TaggedError<DesktopCliCommandUnavailableError>()(
  "DesktopCliCommandUnavailableError",
  {},
) {
  override get message() {
    return "The supaterm command is unavailable.";
  }
}

class DesktopCliCommandLoadError extends Schema.TaggedError<DesktopCliCommandLoadError>()(
  "DesktopCliCommandLoadError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Failed to load the supaterm command state.";
  }
}

export function getDesktopCliCommandBridge() {
  return typeof window === "undefined" ? undefined : window.desktopBridge?.cliCommand;
}

const loadDesktopCliCommandState = Effect.fn("loadDesktopCliCommandState")(function* () {
  const bridge = getDesktopCliCommandBridge();
  if (!bridge) {
    return yield* new DesktopCliCommandUnavailableError();
  }
  return yield* Effect.tryPromise({
    try: () => bridge.getState(),
    catch: (cause) => new DesktopCliCommandLoadError({ cause }),
  });
});

export const desktopCliCommandStateAtom = Atom.make(loadDesktopCliCommandState()).pipe(
  Atom.keepAlive,
  Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
  Atom.withLabel("desktop:cli-command:load"),
);

export function refreshDesktopCliCommandState() {
  appAtomRegistry.refresh(desktopCliCommandStateAtom);
}
