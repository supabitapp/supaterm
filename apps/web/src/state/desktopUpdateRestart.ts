import type { DesktopBridge } from "@supaterm/contracts";
import { flushSync } from "react-dom";
import { createStore } from "zustand/vanilla";

import { getDesktopUpdateActionError } from "../components/desktopUpdate.logic";

export function createDesktopUpdateRestartController() {
  const store = createStore(() => ({ isRestarting: false }));
  let pendingInstall: Promise<void> | null = null;

  function install(
    bridge: Pick<DesktopBridge, "installUpdate">,
    expectedVersion?: string,
  ): Promise<void> {
    if (pendingInstall) return pendingInstall;

    flushSync(() => store.setState({ isRestarting: true }));
    pendingInstall = Promise.resolve()
      .then(() => bridge.installUpdate(expectedVersion))
      .then((result) => {
        const actionError = getDesktopUpdateActionError(result);
        if (!result.accepted || actionError || result.state.status === "error") {
          throw new Error(
            actionError ?? result.state.message ?? "The update could not start. Try again.",
          );
        }
        // Install acceptance precedes app shutdown, so keep the screen until the window closes.
      })
      .catch((error: unknown) => {
        pendingInstall = null;
        store.setState({ isRestarting: false });
        throw error;
      });

    return pendingInstall;
  }

  return { store, install };
}

export const desktopUpdateRestart = createDesktopUpdateRestartController();
