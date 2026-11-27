import { WS_METHODS } from "@supaterm/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export function createTailnetEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tailnet:status",
      tag: WS_METHODS.subscribeTailnetStatus,
    }),
    login: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tailnet:login",
      tag: WS_METHODS.tailnetLogin,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    logout: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tailnet:logout",
      tag: WS_METHODS.tailnetLogout,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
  };
}
