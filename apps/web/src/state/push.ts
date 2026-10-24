import { type EnvironmentId, WS_METHODS } from "@supaterm/contracts";
import {
  createEnvironmentGuardedRpcQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@supaterm/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

const registrations = createEnvironmentGuardedRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:push:list",
  tag: WS_METHODS.pushList,
  staleTimeMs: 30_000,
});

const refreshRegistrations = (
  { environmentId }: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) => Effect.sync(() => registry.refresh(registrations({ environmentId, input: {} })));

export const pushEnvironment = {
  registrations,
  test: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:push:test",
    tag: WS_METHODS.pushTest,
    onSettled: refreshRegistrations,
  }),
  revoke: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:push:revoke",
    tag: WS_METHODS.pushRevoke,
    onSettled: refreshRegistrations,
  }),
};
