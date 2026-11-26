import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { agentSessionScan } from "../state/agentSessions";
import { environmentAtomList, environmentIdsKey } from "../state/environmentAtomList";
import { formatEnvironmentQueryError } from "../state/query";
import { useMessages } from "gt-react";

const scanAtom = (environmentId: EnvironmentId) => agentSessionScan({ environmentId, input: {} });
const projectScansAtom = environmentAtomList("web-project-scans", scanAtom);

export function useProjectScans(environmentIds: readonly EnvironmentId[]) {
  const resolve = useMessages();
  const registry = useContext(RegistryContext);
  const results = useAtomValue(projectScansAtom(environmentIdsKey(environmentIds)));
  return environmentIds.map((environmentId, index) => {
    const result = results[index]!;
    return {
      environmentId,
      data: AsyncResult.getOrElse(result, () => null),
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause, resolve) : null,
      isPending: result.waiting || result._tag === "Initial",
      refresh: () => registry.refresh(scanAtom(environmentId)),
    };
  });
}
