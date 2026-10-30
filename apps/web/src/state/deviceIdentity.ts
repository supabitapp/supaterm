import type { EnvironmentRegistry } from "@supaterm/client-runtime/connection";
import { createEnvironmentRpcCommand } from "@supaterm/client-runtime/state/runtime";
import {
  type DeviceSimlockIdentityInput,
  type EnvironmentId,
  WS_METHODS,
} from "@supaterm/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";

class DeviceIdentityKey extends Data.Class<
  DeviceSimlockIdentityInput & {
    readonly environmentId: EnvironmentId;
  }
> {}

export function createDeviceSimlockIdentityCheck<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const command = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:device:simlock-identity-check",
    tag: WS_METHODS.deviceSimlockIdentity,
  });
  const checks = Atom.family((key: DeviceIdentityKey) => {
    const { environmentId, ...input } = key;
    const target = { environmentId, input };
    return Atom.make((get) => {
      get(command.permissionAtom(environmentId, input));
      return Effect.promise(() => command.run(get.registry, target)).pipe(
        Effect.flatMap((result) =>
          AsyncResult.isSuccess(result)
            ? Effect.succeed(result.value)
            : Effect.failCause(result.cause),
        ),
      );
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`device-simlock-identity:${environmentId}`));
  });
  return (target: {
    readonly environmentId: EnvironmentId;
    readonly input: DeviceSimlockIdentityInput;
  }) => checks(new DeviceIdentityKey({ ...target.input, environmentId: target.environmentId }));
}
