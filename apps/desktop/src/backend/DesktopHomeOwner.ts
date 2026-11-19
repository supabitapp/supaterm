// @effect-diagnostics nodeBuiltinImport:off - Probes the server's native SQLite ownership lock.
import * as NodeSqlite from "node:sqlite";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { BACKEND_QUIT_STOP_TIMEOUT } from "./DesktopBackendManager.ts";

const HomeOwnerRuntimeState = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  serviceManaged: Schema.optional(Schema.Boolean),
  serverVersion: Schema.optional(Schema.String),
});
export type HomeOwner = typeof HomeOwnerRuntimeState.Type;

const decodeHomeOwner = Schema.decodeUnknownOption(Schema.fromJsonString(HomeOwnerRuntimeState));

const isProcessAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

const isHomeOwnershipLocked = Effect.fn("DesktopHomeOwner.isHomeOwnershipLocked")(function* () {
  const path = yield* Path.Path;
  const { stateDir } = yield* DesktopEnvironment.DesktopEnvironment;
  const lockPath = path.join(stateDir, "server-owner.sqlite");
  return yield* Effect.sync(() => {
    try {
      const db = new NodeSqlite.DatabaseSync(lockPath, { readOnly: true });
      try {
        db.exec("PRAGMA busy_timeout = 0");
        db.prepare("SELECT count(*) FROM sqlite_master").get();
        return false;
      } finally {
        db.close();
      }
    } catch (cause) {
      return cause instanceof Error && "errcode" in cause && cause.errcode === 5;
    }
  });
});

const HOME_OWNERSHIP_RELEASE_GRACE = Duration.sum(BACKEND_QUIT_STOP_TIMEOUT, Duration.seconds(3));
const HOME_OWNERSHIP_RELEASE_POLL_INTERVAL = Duration.millis(250);

/** Whether the ownership lock is free, or frees within the grace a shutting-down server needs. */
export const awaitHomeOwnershipRelease = Effect.fn("DesktopHomeOwner.awaitHomeOwnershipRelease")(
  function* () {
    while (yield* isHomeOwnershipLocked()) {
      yield* Effect.sleep(HOME_OWNERSHIP_RELEASE_POLL_INTERVAL);
    }
    return true;
  },
  Effect.timeoutOrElse({
    duration: HOME_OWNERSHIP_RELEASE_GRACE,
    orElse: () => Effect.succeed(false),
  }),
);

/** The live server recorded as owning the desktop's Supaterm home. Only call once the ownership lock is known held: a live PID alone may be reused. */
export const readLiveHomeOwner = Effect.fn("DesktopHomeOwner.readLiveHomeOwner")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* DesktopEnvironment.DesktopEnvironment;
  const raw = yield* fs
    .readFileString(path.join(stateDir, "server-runtime.json"))
    .pipe(Effect.option);
  return Option.flatMap(raw, decodeHomeOwner).pipe(
    Option.filter((owner) => isProcessAlive(owner.pid)),
  );
});

export const homeOwnedMessage = (owner: Option.Option<HomeOwner>) =>
  Option.match(owner, {
    onNone: () =>
      "Another Supaterm server, such as the background service, is using this data directory, or an older background service is set up for it. Stop that server or try `supaterm update`. If the older launcher cannot update, run `supaterm service uninstall` and optionally reinstall with `supaterm service install` from a current CLI. Use `npx supaterm@latest` if `supaterm` is missing or outdated, and pass `--base-dir` with the service's Supaterm home to each command. Then reopen Supaterm. You can also set a separate SUPATERM_HOME and pair with the running server.",
    onSome: (owner) => {
      const kind = owner.serviceManaged
        ? "The Supaterm background service"
        : "Another Supaterm server (for example `supaterm serve`, or one started over SSH)";
      const version = owner.serverVersion ? `, version ${owner.serverVersion}` : "";
      const stop = owner.serviceManaged
        ? "Stop it with `supaterm service uninstall`, passing `--base-dir` with this Supaterm home"
        : "If a Supaterm app on another machine started it over SSH, that app restarts it: remove or disconnect that SSH environment there, or quit that app. Then stop the server";
      return `${kind} is using this Supaterm home (PID ${owner.pid}, port ${owner.port}${version}). ${stop}, and reopen Supaterm. You can also set a separate SUPATERM_HOME and pair with the running server.`;
    },
  });
