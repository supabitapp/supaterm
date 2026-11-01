import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";

import { runServicePreflight } from "../service/servicePreflight.ts";

export const servicePreflightCommand = Command.make("__service-preflight", {
  databasePath: Flag.String("database-path").pipe(Flag.optional),
  launcherProtocol: Flag.Int("launcher-protocol"),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ databasePath, launcherProtocol }) =>
    Console.log(
      JSON.stringify(
        runServicePreflight({
          databasePath: Option.getOrUndefined(databasePath),
          launcherProtocol,
        }),
      ),
    ).pipe(Effect.asVoid),
  ),
);
