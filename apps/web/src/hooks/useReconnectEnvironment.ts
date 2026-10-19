import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId } from "@supaterm/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { environmentCatalog } from "~/connection/catalog";
import { useAtomCommand } from "~/state/use-atom-command";
import { useStableCallback } from "./useStableCallback";

export function useReconnectEnvironment() {
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  return useStableCallback(async (environmentId: EnvironmentId) => {
    const result = await retryEnvironment(environmentId);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not reconnect environment",
          description: error instanceof Error ? error.message : "Failed to reconnect.",
        }),
      );
    }
  });
}
