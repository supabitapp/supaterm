import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";

import { runServicePreflight } from "../service/servicePreflight.ts";

export const servicePreflightCommand = Command.make("__service-preflight", {
  launcherProtocol: Flag.Int("launcher-protocol"),
  databasePath: Flag.String("database-path").pipe(Flag.optional),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ launcherProtocol, databasePath }) =>
    Console.log(
      JSON.stringify(
        runServicePreflight({
          launcherProtocol,
          ...Option.match(databasePath, {
            onNone: () => ({}),
            onSome: (databasePath) => ({ databasePath }),
          }),
        }),
      ),
    ).pipe(Effect.asVoid),
  ),
);
