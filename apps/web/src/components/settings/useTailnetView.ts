import { AuthAccessReadScope, type EnvironmentId } from "@supaterm/contracts";
import { tailnetView } from "@supaterm/client-runtime/tailnet/view";
import { useMessages } from "gt-react";

import { useNowMinuteMs } from "~/hooks/useNowMinute";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { tailnetEnvironment } from "~/state/tailnet";

/** Null until the config arrives, on servers without built-in Tailscale, or without access:read. */
export function useTailnetView(environmentId: EnvironmentId | null) {
  const config = useEnvironment(environmentId)?.serverConfig ?? null;
  const serverConfig = config?.environment.capabilities.tailnet === true ? config : null;
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const settings = serverConfig?.settings.tailnet ?? null;
  const status = useEnvironmentQuery(
    environmentId !== null && canRead && settings !== null
      ? tailnetEnvironment.status({ environmentId, input: {} })
      : null,
  );
  const now = useNowMinuteMs();
  const m = useMessages();
  if (environmentId === null || serverConfig === null || settings === null || !canRead) return null;
  return {
    environmentId,
    settings,
    statusError: status.data === null ? status.error : null,
    view: tailnetView({
      status: status.data,
      settings,
      machineHostname: serverConfig.hostname ?? "",
      now,
      managedPolicy: serverConfig.managedPolicy,
      resolve: m,
    }),
  };
}
