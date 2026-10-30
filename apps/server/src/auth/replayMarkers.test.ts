import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { ServerActivation } from "../serverActivation.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import { pruneExpiredReplayMarkers } from "./replayMarkers.ts";

it.effect("prunes expired replay markers while preserving live proofs and unrelated secrets", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { secretsDir } = yield* ServerConfig.ServerConfig;
    yield* fs.makeDirectory(secretsDir, { recursive: true });
    const now = yield* DateTime.now;
    const old = DateTime.toDateUtc(DateTime.subtract(now, { days: 2 }));
    for (const name of [
      "dpop-proof-expired.bin",
      "dpop-proof-live.bin",
      "ordinary-secret.bin",
      "dpop-proof-temp.bin.tmp",
    ]) {
      const path = `${secretsDir}/${name}`;
      yield* fs.writeFileString(path, "opaque");
      const time = name === "dpop-proof-live.bin" ? DateTime.toDateUtc(now) : old;
      yield* fs.utimes(path, time, time);
    }
    yield* pruneExpiredReplayMarkers();
    expect((yield* fs.readDirectory(secretsDir)).toSorted()).toEqual(
      ["dpop-proof-live.bin", "dpop-proof-temp.bin.tmp", "ordinary-secret.bin"].toSorted(),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-replay-marker-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);

it.effect("runs replay cleanup with the auth lifecycle after activation and stops on close", () =>
  Effect.gen(function* () {
    const dependencies = yield* Layer.build(
      ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-replay-lifecycle-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const fs = Context.get(dependencies, FileSystem.FileSystem);
    const { secretsDir } = Context.get(dependencies, ServerConfig.ServerConfig);
    const removed = yield* Queue.unbounded<string>();
    const activation = yield* Deferred.make<void>();
    const parked = yield* Deferred.make<void>();
    const activated = yield* Deferred.make<void>();
    const old = DateTime.toDateUtc(DateTime.subtract(yield* DateTime.now, { days: 2 }));
    const addExpired = (name: string) =>
      fs
        .writeFileString(`${secretsDir}/${name}`, "opaque")
        .pipe(Effect.andThen(fs.utimes(`${secretsDir}/${name}`, old, old)));
    yield* fs.makeDirectory(secretsDir, { recursive: true });
    yield* addExpired("dpop-proof-first.bin");
    yield* addExpired("ordinary-secret.bin");
    const observed = Context.add(dependencies, FileSystem.FileSystem, {
      ...fs,
      remove: (path, options) =>
        fs
          .remove(path, options)
          .pipe(
            Effect.tap(() =>
              path.startsWith(`${secretsDir}/dpop-proof-`) && path.endsWith(".bin")
                ? Queue.offer(removed, path)
                : Effect.void,
            ),
          ),
    });
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    yield* Layer.buildWithScope(
      EnvironmentAuth.layer.pipe(
        Layer.provide(SqlitePersistence.layerMemory),
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ServerEnvironment.layerIdentity),
        Layer.provide(Layer.succeedContext(observed)),
      ),
      scope,
    ).pipe(
      Effect.provideService(
        ServerActivation,
        Deferred.succeed(parked, undefined).pipe(
          Effect.andThen(Deferred.await(activation)),
          Effect.andThen(Deferred.succeed(activated, undefined)),
        ),
      ),
    );
    expect(yield* Deferred.isDone(parked)).toBe(true);
    expect(yield* fs.exists(`${secretsDir}/dpop-proof-first.bin`)).toBe(true);
    yield* Deferred.succeed(activation, undefined);
    yield* Deferred.await(activated);
    expect(yield* Queue.take(removed)).toBe(`${secretsDir}/dpop-proof-first.bin`);
    yield* addExpired("dpop-proof-second.bin");
    yield* TestClock.adjust(Duration.hours(1));
    expect(yield* Queue.take(removed)).toBe(`${secretsDir}/dpop-proof-second.bin`);
    expect(yield* fs.exists(`${secretsDir}/ordinary-secret.bin`)).toBe(true);
    yield* Scope.close(scope, Exit.void);
    yield* addExpired("dpop-proof-after-close.bin");
    yield* TestClock.adjust(Duration.hours(1));
    expect(yield* fs.exists(`${secretsDir}/dpop-proof-after-close.bin`)).toBe(true);
  }),
);
