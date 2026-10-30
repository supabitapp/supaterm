import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../config.ts";
import { forkParked } from "../serverActivation.ts";
export const DPOP_REPLAY_MARKER_PREFIX = "dpop-proof-";

const REPLAY_MARKER_MAX_AGE = Duration.days(1);

export const pruneExpiredReplayMarkers = Effect.fn("replayMarkers.pruneExpired")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { secretsDir } = yield* ServerConfig.ServerConfig;
  const cutoff = (yield* Clock.currentTimeMillis) - Duration.toMillis(REPLAY_MARKER_MAX_AGE);
  const markers = (yield* fileSystem.readDirectory(secretsDir)).filter(
    (name) => name.endsWith(".bin") && name.startsWith(DPOP_REPLAY_MARKER_PREFIX),
  );
  const [removed, failures] = yield* Effect.partition(markers, (name) => {
    const markerPath = path.join(secretsDir, name);
    return fileSystem.stat(markerPath).pipe(
      Effect.flatMap((info) =>
        Option.exists(info.mtime, (mtime) => mtime.getTime() < cutoff)
          ? fileSystem.remove(markerPath).pipe(Effect.as(true))
          : Effect.succeed(false),
      ),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
    );
  });
  yield* Effect.annotateCurrentSpan({
    "replay_markers.matched": markers.length,
    "replay_markers.removed": removed.filter(Boolean).length,
    "replay_markers.failed": failures.length,
  });
  if (failures.length > 0) {
    yield* Effect.logWarning("Failed to prune some replay markers", {
      failed: failures.length,
      cause: failures[0],
    });
  }
});

export const layer = Layer.effectDiscard(
  forkParked(
    pruneExpiredReplayMarkers().pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to prune expired replay markers", { cause }),
      ),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
    ),
  ),
);
