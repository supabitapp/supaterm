import type { ManagedPolicyDocument } from "@supaterm/contracts";
import {
  layerWindowsRegistry,
  ManagedPolicyFileError,
  readManagedPolicy,
  WindowsRegistry,
} from "@supaterm/shared/managedPolicyFile";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

type FoundPolicy = Effect.Success<ReturnType<typeof readManagedPolicy>>;
const isManagedPolicyFileError = Schema.is(ManagedPolicyFileError);

export class DesktopManagedPolicy extends Context.Service<
  DesktopManagedPolicy,
  {
    /** The policy on this machine, read once; undefined without one, fails when it cannot be used. */
    readonly read: Effect.Effect<FoundPolicy, ManagedPolicyFileError>;
  }
>()("@supaterm/desktop/app/DesktopManagedPolicy") {}

export const layer = Layer.effect(
  DesktopManagedPolicy,
  Effect.gen(function* () {
    const { platform } = yield* DesktopEnvironment.DesktopEnvironment;
    const read = yield* Effect.cached(
      readManagedPolicy(platform).pipe(
        Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem),
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          yield* ChildProcessSpawner.ChildProcessSpawner,
        ),
        Effect.provideService(WindowsRegistry, yield* WindowsRegistry),
      ),
    );
    return DesktopManagedPolicy.of({ read });
  }),
).pipe(Layer.provide(layerWindowsRegistry(() => import("ffi-rs"))));

/** A machine with `policy` deployed, one whose policy cannot be used, or none. */
export const layerTest = (policy?: ManagedPolicyDocument | ManagedPolicyFileError) =>
  Layer.succeed(
    DesktopManagedPolicy,
    DesktopManagedPolicy.of({
      read:
        policy === undefined
          ? Effect.undefined
          : isManagedPolicyFileError(policy)
            ? Effect.fail(policy)
            : Effect.succeed({ source: "/test/policy.json", document: policy }),
    }),
  );
