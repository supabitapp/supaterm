import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, GlobalFlag } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import * as ServerConfig from "../config.ts";
import { awaitLauncherLoss } from "../launcherWatch.ts";
import * as DatabaseMaintenance from "../persistence/DatabaseMaintenance.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as AutomaticPort from "./automaticPort.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

const runServerCommand = Effect.fn("server.runServerCommand")(function* (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: ServerConfig.StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
    readonly rejectRunningServer?: boolean;
  },
) {
  const { runServer } = yield* Effect.promise(() => import("../server.ts"));
  const logLevel = yield* GlobalFlag.LogLevel;
  const selectAutomaticPort = yield* AutomaticPort.make.pipe(Effect.provide(ProcessRunner.layer));
  const config = yield* resolveServerConfig(flags, logLevel, { ...options, selectAutomaticPort });
  const run = runServer.pipe(
    Effect.provideService(ServerConfig.ServerConfig, config),
    Effect.ensuring(
      DatabaseMaintenance.runRequestedReclaim(config.dbPath).pipe(
        Effect.provide(DatabaseMaintenance.layer),
      ),
    ),
  );
  if (config.mode !== "desktop" || config.desktopBootstrapToken === undefined) return yield* run;
  return yield* Effect.raceFirst(run, awaitLauncherLoss().pipe(Effect.andThen(Effect.interrupt)));
});

const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

export const runDefaultServerCommand = Effect.fn("server.runDefaultServerCommand")(function* (
  flags: CliServerFlags,
) {
  if (Option.isSome(flags.cwd)) {
    const cwd = flags.cwd.value.trim();
    const fs = yield* FileSystem.FileSystem;
    const platform = yield* HostProcess.Platform;
    const explicitPath =
      cwd === "." ||
      cwd === ".." ||
      cwd === "~" ||
      /[/\\]/.test(cwd) ||
      (platform === "win32" && /^[a-z]:/i.test(cwd));
    if (!explicitPath && (!(yield* fs.exists(cwd)) || (yield* fs.stat(cwd)).type !== "Directory")) {
      return yield* new CliError.UserError({
        cause: cwd,
        userMessage: `Unknown command ${yield* encodeCommand(cwd)}. Use "supaterm --help" for commands or an explicit path such as "supaterm ./my-project" for a new directory.`,
      });
    }
  }
  return yield* runServerCommand(flags, { rejectRunningServer: true });
});

export const startCommand = Command.make("start", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the Supaterm server."),
  Command.withHandler((flags) => runServerCommand(flags, { rejectRunningServer: true })),
);

const { autoBootstrapProjectFromCwd: _, ...serveCommandFlags } = sharedServerCommandFlags;

export const serveCommand = Command.make("serve", serveCommandFlags).pipe(
  Command.withDescription(
    "Run the Supaterm server without opening a browser and print headless pairing details.",
  ),
  Command.withHandler((flags) =>
    runServerCommand(
      { ...flags, autoBootstrapProjectFromCwd: Option.none() },
      {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
      },
    ),
  ),
);
