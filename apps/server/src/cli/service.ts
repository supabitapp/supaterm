import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../service/bootService.ts";
import { compareExactServiceVersions } from "../service/serviceProtocol.ts";
import type * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export const layer = (config: ServerConfig.ServerConfig["Service"]) =>
  BootService.layer({
    baseDir: config.baseDir,
    logsDir: config.logsDir,
    cliVersion: packageJson.version,
  }).pipe(Layer.provide(ProcessRunner.layer), Layer.provide(FetchHttpClient.layer));

export type ServiceReconcileResult =
  | {
      readonly changed: false;
      readonly status: BootService.BootServiceStatus;
    }
  | {
      readonly changed: true;
      readonly previouslyInstalled: boolean;
      readonly plan: BootService.BootServicePlan;
    };

export const reconcileService = Effect.fn("cli.service.reconcile")(function* (options?: {
  readonly allowDowngrade?: boolean;
  readonly start?: boolean;
}) {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  if (status.installed && status.current) {
    return { changed: false, status } satisfies ServiceReconcileResult;
  }
  if (
    status.installedVersion !== undefined &&
    options?.allowDowngrade !== true &&
    compareExactServiceVersions(packageJson.version, status.installedVersion) < 0
  ) {
    return yield* new BootService.BootServiceDowngradeRefusedError({
      installedVersion: status.installedVersion,
      targetVersion: packageJson.version,
    });
  }
  const plan = yield* service.install(options);
  return {
    changed: true,
    previouslyInstalled: status.installed,
    plan,
  } satisfies ServiceReconcileResult;
});

function formatServiceChange(
  result: Extract<ServiceReconcileResult, { readonly changed: true }>,
): string {
  if (result.plan.handedOff === true) {
    return `Handed the Supaterm service switch to supaterm@${packageJson.version} to a separate systemd unit, since this session runs inside the service and disconnects when it restarts.\nResult: ${result.plan.logPath}`;
  }
  return `${result.previouslyInstalled ? "Updated" : "Installed"} Supaterm service with supaterm@${packageJson.version}.\nLogs: ${result.plan.logPath}`;
}

export function formatServiceStatus(
  status: BootService.BootServiceStatus,
  cliVersion: string,
): string {
  if (!status.supported) {
    return "Supaterm service\n  Status: unavailable on this machine\n  Supported on: Linux with systemd, macOS with launchd";
  }
  if (!status.installed) {
    return "supaterm service\n  Status: not installed\n  Next: Run `supaterm service install`.";
  }
  const installedVersion = status.installedVersion ?? cliVersion;
  const problems = (status.problems ?? []).map(
    (problem) => `  [${problem}] ${BootService.formatBootServiceProblem(problem)}`,
  );
  if (
    !status.current &&
    status.installedVersion !== undefined &&
    compareExactServiceVersions(status.installedVersion, cliVersion) > 0
  ) {
    return [
      "Supaterm service",
      `  Status: installed · supaterm@${installedVersion} (newer than this supaterm@${cliVersion} CLI)`,
      `  Unit: ${status.unitPath}`,
      `  Logs: ${status.logPath}`,
      ...problems,
      `  Next: Run \`supaterm update ${installedVersion}\` to match it, or pass \`--allow-downgrade\` to \`supaterm service install\` explicitly.`,
    ].join("\n");
  }
  return [
    "Supaterm service",
    `  Status: ${status.current ? `installed · supaterm@${installedVersion}` : "needs an update or repair"}`,
    `  Unit: ${status.unitPath}`,
    `  Logs: ${status.logPath}`,
    ...problems,
    ...(status.current ? [] : ["  Next: Run `supaterm service install` to repair it."]),
  ].join("\n");
}

const runServiceCommand = Effect.fn("cli.service.run")(function* <A, E>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: Effect.Effect<A, E, BootService.BootService>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* run.pipe(Effect.provide(layer(config)));
});

const serviceReconcileFlags = {
  ...projectLocationFlags,
  allowDowngrade: Flag.Boolean("allow-downgrade").pipe(
    Flag.withDescription("Allow replacing a newer installed service with this older CLI version."),
    Flag.withDefault(false),
  ),
};

const serviceInstallCommand = Command.make("install", serviceReconcileFlags).pipe(
  Command.withDescription("Install Supaterm as a background service for this user."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService({ allowDowngrade: flags.allowDowngrade });
        if (!result.changed) {
          yield* Console.log(
            `Supaterm service is already installed with supaterm@${packageJson.version}.`,
          );
          return;
        }
        yield* Console.log(formatServiceChange(result));
      }),
    ),
  ),
);

const serviceRestartCommand = Command.make("restart", projectLocationFlags).pipe(
  Command.withDescription(
    "Restart the background service. Picks up a version installed by `supaterm update` that was not restarted at the time.",
  ),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const status = yield* service.status;
        const outcome = yield* service.restart;
        const onVersion =
          status.installedVersion === undefined ? "" : ` on supaterm@${status.installedVersion}`;
        yield* Console.log(
          outcome === "restarted"
            ? `Restarted the Supaterm service${onVersion}.`
            : outcome === "queued"
              ? `Queued a restart of the Supaterm service${onVersion}. This session runs inside the service and disconnects when it goes down.\nLogs: ${status.logPath}`
              : "Supaterm service is not installed.",
        );
      }),
    ),
  ),
);

const serviceUninstallCommand = Command.make("uninstall", projectLocationFlags).pipe(
  Command.withDescription("Stop and remove the Supaterm background service."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const removed = yield* service.uninstall;
        yield* Console.log(
          removed ? "Removed the Supaterm service." : "Supaterm service is not installed.",
        );
      }),
    ),
  ),
);

const serviceStatusCommand = Command.make("status", projectLocationFlags).pipe(
  Command.withDescription("Show whether the Supaterm background service is installed."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        yield* Console.log(formatServiceStatus(yield* service.status, packageJson.version));
      }),
    ),
  ),
);

export const serviceCommand = Command.make("service").pipe(
  Command.withDescription("Manage the Supaterm background service."),
  Command.withSubcommands([
    serviceInstallCommand,
    serviceRestartCommand,
    serviceUninstallCommand,
    serviceStatusCommand,
  ]),
);
