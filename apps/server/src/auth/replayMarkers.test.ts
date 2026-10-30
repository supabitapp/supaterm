import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
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
