import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import type { DesktopIpcInvokeEvent } from "./DesktopIpc.ts";

/**
 * Admits IPC calls only from the main window, and runs `release` when the renderer that last
 * called is destroyed or crashes, so hardware it drives never keeps a stale state.
 */
export const make = Effect.fn("desktop.ipc.MainWindowOwner.make")(function* (
  release: Effect.Effect<void>,
) {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  let owner: Electron.WebContents | undefined;
  let removeOwnerListeners = () => {};
  yield* Effect.addFinalizer(() => Effect.sync(() => removeOwnerListeners()));

  return Effect.fn("desktop.ipc.MainWindowOwner.admit")(function* (
    event: DesktopIpcInvokeEvent | undefined,
  ) {
    const main = yield* electronWindow.main;
    if (
      event === undefined ||
      Option.isNone(main) ||
      main.value.webContents.id !== event.sender.id
    ) {
      return false;
    }
    const contents = main.value.webContents;
    if (owner !== contents) {
      removeOwnerListeners();
      owner = contents;
      const onGone = () => {
        runFork(release);
      };
      contents.on("destroyed", onGone);
      contents.on("render-process-gone", onGone);
      removeOwnerListeners = () => {
        contents.removeListener("destroyed", onGone);
        contents.removeListener("render-process-gone", onGone);
      };
    }
    return true;
  });
});
