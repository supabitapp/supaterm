import { doctorCommand } from "./cli/doctor.ts";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CliError, Command } from "effect/cli";

import * as NetService from "@supaterm/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { acpMcpBridgeCommand, acpMcpCallCommand } from "./cli/acpMcpBridge.ts";
import { authCommand } from "./cli/auth.ts";
import { appCommand } from "./cli/app.ts";
import { browserCommand } from "./cli/browser.ts";
import { pairCommand } from "./cli/pair.ts";
import { extendConnectionAttemptTimeout, keepOutboundFetchOnHttp1 } from "./outboundHttp.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { reportCliFailure } from "./cli/reportFailure.ts";
import { threadCommand } from "./cli/thread.ts";
import { runDefaultServerCommand, serveCommand, startCommand } from "./cli/server.ts";
import { updateCommand } from "./cli/update.ts";
import { uninstallCommand } from "./cli/uninstall.ts";
import { serviceLauncherCommand } from "./cli/serviceLauncher.ts";
import { claudeHistoryCommand } from "./cli/claudeHistory.ts";
import { sshHelperCommand } from "./cli/sshHelper.ts";
import { serviceCommand } from "./cli/service.ts";
import { servicePreflightCommand } from "./cli/servicePreflight.ts";
import { themeCommand } from "./cli/theme.ts";
import { traceCommand } from "./cli/trace.ts";
import { relayClientCommand } from "./cli/relayClient.ts";
import { settingsCommand } from "./cli/settings.ts";
import { triageCommand } from "./cli/triage.ts";

const layerCliRuntime = Layer.mergeAll(NodeServices.layer, NetService.layer);

export const makeCli = () =>
  Command.make("supaterm", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription("Run the Supaterm server."),
    Command.withHandler(runDefaultServerCommand),
    Command.withSubcommands([
      Command.make("help").pipe(
        Command.withDescription("Show command help."),
        Command.withHandler(() =>
          Effect.fail(new CliError.ShowHelp({ commandPath: ["supaterm"], errors: [] })),
        ),
      ),
      acpMcpBridgeCommand,
      acpMcpCallCommand,
      startCommand,
      serveCommand,
      appCommand,
      pairCommand,
      authCommand,
      browserCommand,
      projectCommand,
      threadCommand,
      serviceCommand,
      updateCommand,
      uninstallCommand,
      serviceLauncherCommand,
      claudeHistoryCommand,
      sshHelperCommand,

      servicePreflightCommand,
      themeCommand,
      traceCommand,
      doctorCommand,
      triageCommand,
      relayClientCommand,
      settingsCommand,
    ]),
  );

export const cli = makeCli();

export function runCli() {
  extendConnectionAttemptTimeout();
  keepOutboundFetchOnHttp1();
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(layerCliRuntime),
    Effect.tapCause(reportCliFailure),
    NodeRuntime.runMain({ disableErrorReporting: true }),
  );
}
