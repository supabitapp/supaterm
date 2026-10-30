import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command, Flag } from "effect/cli";

import { runServicePreflight } from "../service/servicePreflight.ts";

export const servicePreflightCommand = Command.make("__service-preflight", {
  launcherProtocol: Flag.Int("launcher-protocol"),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ launcherProtocol }) =>
    Console.log(JSON.stringify(runServicePreflight({ launcherProtocol }))).pipe(Effect.asVoid),
  ),
);
