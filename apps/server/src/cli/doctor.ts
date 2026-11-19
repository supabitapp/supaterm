import { DATABASE_COMPACTION_RECOMMENDED_BYTES } from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command, Flag, GlobalFlag, Prompt } from "effect/cli";

import * as BootService from "../service/bootService.ts";
import * as DatabaseMaintenance from "../persistence/DatabaseMaintenance.ts";
import * as ServerOwnership from "../serverOwnership.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import * as CliService from "./service.ts";

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${Math.ceil(bytes / 1024)} KiB`;

const formatElapsed = (nanos: bigint) => {
  const seconds = Number(nanos / 1_000_000_000n);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const COMPACT_STEP_LABELS: Record<DatabaseMaintenance.DatabaseCompactStep, string> = {
  "compact-events": "Removing superseded events",
  vacuum: "Rewriting the database file",
  "rebuild-search": "Rebuilding the search index",
  checkpoint: "Flushing the write-ahead log",
};

const lockServerHome = Effect.fn("runDoctor.lockServerHome")(function* (paths: {
  readonly dbPath: string;
  readonly serverRuntimeStatePath: string;
}) {
  yield* ServerOwnership.holdServerOwnershipLock(paths.serverRuntimeStatePath).pipe(
    Effect.catchTags({
      ServerAlreadyRunningError: Effect.fn("runDoctor.nameServerHolder")(function* (cause) {
        const owner = yield* readPersistedServerRuntimeState(paths.serverRuntimeStatePath).pipe(
          Effect.map(Option.filter((state) => isProcessAlive(state.pid))),
          Effect.orElseSucceed(() => Option.none()),
        );
        return yield* new DatabaseMaintenance.DatabaseInUseError({
          path: paths.dbPath,
          cause,
          ...(Option.isSome(owner) && {
            pid: owner.value.pid,
            serviceManaged: owner.value.serviceManaged === true,
          }),
        });
      }),
    }),
  );
});

export const runDoctor = Effect.fn("runDoctor")(function* (
  paths: { readonly dbPath: string; readonly serverRuntimeStatePath: string },
  options: { readonly fix: boolean; readonly dryRun: boolean; readonly interactive?: boolean },
) {
  const databasePath = paths.dbPath;
  const maintenance = yield* DatabaseMaintenance.DatabaseMaintenance;
  const status = yield* maintenance.inspect(databasePath);
  yield* Console.log(
    `Database: ${formatBytes(status.databaseBytes)}, ${formatBytes(status.reclaimableBytes)} reclaimable.`,
  );
  if (status.incrementalVacuumEnabled && status.reclaimableBytes === 0) {
    yield* Console.log("Nothing to repair.");
    return;
  }
  const recommended =
    !status.incrementalVacuumEnabled ||
    status.reclaimableBytes >= DATABASE_COMPACTION_RECOMMENDED_BYTES;
  const repairs = [
    {
      id: "database" as const,
      title: "Reclaim database space",
      description: `${
        status.incrementalVacuumEnabled
          ? "Returns unused space to disk."
          : "Returns unused space to disk and turns on automatic shrinking."
      }\n  Rewrites the whole ${formatBytes(status.databaseBytes)} database, which can take more than an hour on a large database or slow disk.`,
      recommended,
    },
  ];
  for (const repair of repairs) {
    yield* Console.log(
      `\n${repair.title}${repair.recommended ? " (recommended)" : ""}\n  ${repair.description}\n  Pauses the background service, if installed, while it runs and may need temporary disk space.`,
    );
  }
  if (options.dryRun) {
    yield* Console.log("\nDry run: nothing changed.");
    return;
  }
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!options.fix && !interactive) {
    yield* Console.log(
      "\nRun in a terminal to choose repairs, or pass --fix for the recommended ones.",
    );
    return;
  }
  const selected = options.fix
    ? repairs.flatMap((repair) => (repair.recommended ? [repair.id] : []))
    : yield* Prompt.run(
        Prompt.MultiSelect({
          message: "Choose repairs to run",
          choices: repairs.map((repair) => ({
            title: repair.title + (repair.recommended ? " (recommended)" : ""),
            value: repair.id,
            selected: repair.recommended,
          })),
        }),
      ).pipe(Effect.catchTags({ QuitError: () => Effect.succeed([]) }));
  if (selected.length === 0) {
    yield* Console.log(
      options.fix
        ? "No recommended repairs; nothing changed."
        : "No repairs selected; nothing changed.",
    );
    return;
  }
  const service = yield* BootService.BootService;
  yield* Console.log("\nReclaiming database space. Each step is shown as it starts.");
  const startedAt = yield* Clock.monotonicTimeNanos;
  const reportStep = (step: DatabaseMaintenance.DatabaseCompactStep) =>
    Clock.monotonicTimeNanos.pipe(
      Effect.flatMap((now) =>
        Console.log(`  [${formatElapsed(now - startedAt)}] ${COMPACT_STEP_LABELS[step]}`),
      ),
    );
  yield* service.withStopped(
    lockServerHome(paths).pipe(
      Effect.andThen(maintenance.compact(databasePath, reportStep)),
      Effect.tap((result) =>
        Clock.monotonicTimeNanos.pipe(
          Effect.flatMap((now) =>
            Console.log(
              `Done in ${formatElapsed(now - startedAt)}: ${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)}, ${result.deletedEventCount} superseded events removed.`,
            ),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );
});

export const doctorCommand = Command.make("doctor", {
  ...projectLocationFlags,
  fix: Flag.Boolean("fix").pipe(
    Flag.withDescription("Apply the recommended repairs without prompting."),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Show the repairs without changing anything, even with --fix."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Inspect this Supaterm data directory and repair it. Pauses and restarts the background service as needed.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      yield* runDoctor(config, { fix: flags.fix, dryRun: flags.dryRun }).pipe(
        Effect.provide(Layer.merge(DatabaseMaintenance.layer, CliService.layer(config))),
      );
    }),
  ),
);
