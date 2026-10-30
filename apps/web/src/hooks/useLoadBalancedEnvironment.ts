import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { chooseLoadBalancedEnvironment } from "@supaterm/client-runtime/load-balancing";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useEffect } from "react";

import { serverEnvironment } from "../state/server";

class LoadBalancingRequest extends Data.Class<{
  readonly candidatesKey: string;
  readonly scopeKey: string;
}> {}

const loadBalancingAtom = Atom.family((request: LoadBalancingRequest) => {
  const candidates = JSON.parse(request.candidatesKey) as readonly (readonly [
    EnvironmentId,
    number,
  ])[];
  if (candidates.length === 0) {
    return Atom.make(AsyncResult.success({ environmentId: null, failed: false }));
  }
  return Atom.make((get) => {
    const reads = candidates.map(([environmentId, weight]) => {
      const source = serverEnvironment.hostResources({ environmentId, input: {} });
      const snapshot = get(source);
      return get.result(source, { suspendOnWaiting: true }).pipe(
        Effect.matchCause({
          onFailure: () => ({
            environmentId,
            weight,
            resources: null,
            receivedAt: 0,
            failed: true,
          }),
          onSuccess: (resources) => ({
            environmentId,
            weight,
            resources,
            receivedAt: snapshot._tag === "Success" ? snapshot.timestamp : 0,
            failed: false,
          }),
        }),
      );
    });
    return Effect.promise(async (signal) => {
      const [resources, evaluatedAt] = await Effect.runPromise(
        Effect.all([Effect.all(reads), Clock.currentTimeMillis]),
        { signal },
      );
      if (signal.aborted) return { environmentId: null, failed: false };
      const environmentId = chooseLoadBalancedEnvironment(
        resources,
        evaluatedAt,
      ) as EnvironmentId | null;
      return {
        environmentId,
        failed: environmentId === null && resources.some((resource) => resource.failed),
      };
    });
  }).pipe(Atom.setIdleTTL(0));
});

export function useLoadBalancedEnvironment(
  environmentIds: readonly EnvironmentId[],
  weights: Readonly<Record<string, number>>,
  onResolved: (environmentId: EnvironmentId) => void,
  scopeKey = "",
) {
  const registry = useContext(RegistryContext);
  const result = useAtomValue(
    loadBalancingAtom(
      new LoadBalancingRequest({
        candidatesKey: JSON.stringify(environmentIds.map((id) => [id, weights[id] ?? 50])),
        scopeKey,
      }),
    ),
  );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Delivers a resolved host request only from its committed React owner, after queued scope changes can discard stale work.
  useEffect(() => {
    if (result._tag === "Success" && !result.waiting && result.value.environmentId !== null) {
      onResolved(result.value.environmentId);
    }
  }, [onResolved, result]);
  const refresh = (ids: readonly EnvironmentId[]) => {
    for (const environmentId of ids) {
      registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
    }
  };
  return {
    refresh,
    pending: result._tag === "Initial" || result.waiting,
    environmentId: result._tag === "Success" ? result.value.environmentId : null,
    failed: result._tag === "Success" && result.value.failed,
  };
}
