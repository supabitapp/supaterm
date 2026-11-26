// @effect-diagnostics nodeBuiltinImport:off - the barrier must use the same native watch as the watches it settles.
import * as NodeFS from "node:fs";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const SENTINEL = "sentinel";

/**
 * Waits until every watch registered so far is live and every earlier change is delivered. macOS
 * starts watches on another thread, so a change right after `fs.watch` can be lost and one just
 * before can still arrive; a close waits for that thread. The sentinel watch stays open for the
 * scope, since closing it restarts every other watch.
 */
export const settleFileWatches = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-watch-settle-" });
  const delivered = yield* Deferred.make<void>();
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      NodeFS.watch(directory, (_, filename) => {
        if (filename === SENTINEL) Deferred.doneUnsafe(delivered, Exit.void);
      }),
    ),
    (watcher) => Effect.sync(() => watcher.close()),
  );
  yield* Effect.sync(() => NodeFS.watch(directory).close());
  yield* fs.writeFileString(path.join(directory, SENTINEL), "");
  yield* Deferred.await(delivered);
});
