import { AuthDiagnosticsReadScope } from "@supaterm/contracts";
import { AuthEnvironmentMaintainScope } from "@supaterm/contracts";
import type {
  EnvironmentId,
  ResourceTelemetryHistoryInput,
  ResourceTelemetrySnapshot,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";

import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { msg, useMessages } from "gt-react";
import { m } from "../i18n/messages";

export interface ResourceTelemetryState {
  readonly data: ResourceTelemetrySnapshot | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
  readonly retry: () => Promise<ResourceTelemetrySnapshot>;
}

export function useResourceTelemetry(
  targetEnvironmentId?: EnvironmentId | null,
): ResourceTelemetryState {
  const resolve = useMessages();
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId =
    targetEnvironmentId === undefined
      ? (primaryEnvironment?.environmentId ?? null)
      : targetEnvironmentId;
  const canReadDiagnostics = useEnvironmentScope(environmentId, AuthDiagnosticsReadScope);
  const query = useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics
      ? null
      : serverEnvironment.resourceTelemetry({ environmentId, input: {} }),
    resolve,
  );
  const retryCommand = useAtomCommand(serverEnvironment.retryResourceTelemetry, {
    reportFailure: false,
  });
  const retry = async () => {
    if (environmentId === null) {
      throw new Error(m(msg("No environment is selected.")));
    }
    if (
      !readEnvironmentScope(environmentId, AuthEnvironmentMaintainScope) ||
      !readEnvironmentScope(environmentId, AuthDiagnosticsReadScope)
    ) {
      throw new Error(m(msg("This connection cannot restart the resource monitor.")));
    }
    const result = await retryCommand({ environmentId, input: {} });
    if (result._tag === "Failure") {
      throw Cause.squash(result.cause);
    }
    query.refresh();
    return result.value.snapshot;
  };

  // The live subscription keeps waiting for updates after its first snapshot.
  const isPending = query.isPending && query.data === null && query.error === null;
  return { ...query, isPending, retry };
}

export function useResourceTelemetryHistory(
  input: ResourceTelemetryHistoryInput,
  targetEnvironmentId?: EnvironmentId | null,
) {
  const resolve = useMessages();
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId =
    targetEnvironmentId === undefined
      ? (primaryEnvironment?.environmentId ?? null)
      : targetEnvironmentId;
  const canReadDiagnostics = useEnvironmentScope(environmentId, AuthDiagnosticsReadScope);
  return useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics
      ? null
      : serverEnvironment.resourceTelemetryHistory({ environmentId, input }),
    resolve,
  );
}
