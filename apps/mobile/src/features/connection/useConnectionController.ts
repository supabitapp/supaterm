import type { EnvironmentId } from "@supaterm/contracts";
import { useCallback } from "react";

import { environmentCatalog } from "../../connection/catalog";
import {
  connectPairingUrl as connectPairingUrlAtom,
  updateBearerConnection,
} from "../../connection/onboarding";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useAtomCommand } from "../../state/use-atom-command";
import { forgetPushEnvironment } from "../notifications/pushRuntime";

export function useConnectionController() {
  const connectedEnvironments = useWorkspaceEnvironments();
  const connectPairingUrlMutation = useAtomCommand(connectPairingUrlAtom, {
    reportFailure: false,
  });
  const updateBearer = useAtomCommand(updateBearerConnection, { reportFailure: false });
  const removeEnvironmentMutation = useAtomCommand(environmentCatalog.remove, "environment remove");
  const retryEnvironmentMutation = useAtomCommand(environmentCatalog.retryNow, "environment retry");
  const setEnvironmentEnabledMutation = useAtomCommand(
    environmentCatalog.setEnabled,
    "environment toggle",
  );

  const connectPairingUrl = useCallback(
    (pairingUrl: string, expectedEnvironmentId?: EnvironmentId) =>
      connectPairingUrlMutation({
        pairingUrl,
        ...(expectedEnvironmentId === undefined ? {} : { expectedEnvironmentId }),
      }),
    [connectPairingUrlMutation],
  );
  const removeEnvironment = useCallback(
    async (environmentId: EnvironmentId) => {
      await forgetPushEnvironment(environmentId);
      return removeEnvironmentMutation(environmentId);
    },
    [removeEnvironmentMutation],
  );
  const retryEnvironment = useCallback(
    (environmentId: EnvironmentId) => retryEnvironmentMutation(environmentId),
    [retryEnvironmentMutation],
  );
  const setEnvironmentEnabled = useCallback(
    (environmentId: EnvironmentId, enabled: boolean) =>
      setEnvironmentEnabledMutation({ environmentId, enabled }),
    [setEnvironmentEnabledMutation],
  );
  const updateEnvironment = useCallback(
    (
      environmentId: EnvironmentId,
      updates: { readonly label: string; readonly displayUrl: string },
    ) =>
      updateBearer({
        environmentId,
        label: updates.label,
        httpBaseUrl: updates.displayUrl,
      }),
    [updateBearer],
  );

  return {
    connectedEnvironments,
    connectPairingUrl,
    removeEnvironment,
    retryEnvironment,
    setEnvironmentEnabled,
    updateEnvironment,
  };
}
