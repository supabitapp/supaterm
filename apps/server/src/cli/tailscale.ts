import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthEnvironmentScope,
  isManagedSettingPath,
  ServerSettingsError,
  TailnetControlUrl,
  TailnetHostname,
  type TailnetSettingsPatch,
  type TailnetStatus,
} from "@supaterm/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { readInstalledPolicy } from "./policy.ts";
import * as RunningServer from "./runningServer.ts";
import { editSettingsObject } from "./settingsFile.ts";

class TailscaleServerNotRunningError extends Schema.TaggedError<TailscaleServerNotRunningError>()(
  "TailscaleServerNotRunningError",
  {},
) {
  override get message(): string {
    return "No Supaterm server is running. Start it, then run this command again.";
  }
}

class TailscaleHostnameError extends Schema.TaggedError<TailscaleHostnameError>()(
  "TailscaleHostnameError",
  { hostname: Schema.String },
) {
  override get message(): string {
    return `Invalid machine name "${this.hostname}". Use lowercase letters, digits and hyphens, at most 63 characters.`;
  }
}

class TailscaleControlUrlError extends Schema.TaggedError<TailscaleControlUrlError>()(
  "TailscaleControlUrlError",
  { controlUrl: Schema.String },
) {
  override get message(): string {
    return `Invalid control server URL "${this.controlUrl}". Use an http(s) URL without a username or password.`;
  }
}

function describeTailnetStatus(status: TailnetStatus): string {
  switch (status.state) {
    case "off":
      return "Built-in Tailscale is off.";
    case "unavailable":
      switch (status.reason) {
        case "binary-missing":
          return "Built-in Tailscale is not included in this build.";
        case "unsupported-platform":
          return "Built-in Tailscale does not support this platform.";
        case "managed-policy":
          return "Your organization's policy does not allow built-in Tailscale on this machine.";
      }
    case "starting":
      return "Built-in Tailscale is starting.";
    case "needs-login":
      return "Built-in Tailscale needs you to sign in. Run `supaterm tailscale login`.";
    case "needs-approval":
      return "Built-in Tailscale is waiting for a tailnet admin to approve this device.";
    case "crashed":
      return `Built-in Tailscale stopped: ${status.message} Retrying.`;
    case "running": {
      const owner =
        status.owner.type === "user"
          ? `Signed in as ${status.owner.login}`
          : `Tagged ${status.owner.tags.join(", ")}`;
      const https =
        status.https === "ready"
          ? `https://${status.dnsName}/`
          : status.https === "unavailable"
            ? `${status.dnsName} (HTTPS certificates are off for this tailnet)`
            : `${status.dnsName} (HTTPS ${status.https})`;
      return [`${owner}.`, https, ...status.health].join("\n");
    }
  }
}

const decodeHostname = Schema.decodeUnknownEffect(TailnetHostname);
const decodeControlUrl = Schema.decodeUnknownEffect(TailnetControlUrl);

const viaServer = Effect.fn("tailscale.viaServer")(function* <A, E>(
  flags: CliAuthLocationFlags,
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  run: (client: RunningServer.ServerClient) => Effect.Effect<A, E>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  return yield* RunningServer.changeState({
    scopes,
    viaServer: run,
    locally: Effect.fail(new TailscaleServerNotRunningError()),
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provideMerge(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});

const patchTailnetSettings = Effect.fn("tailscale.patchTailnetSettings")(function* (
  flags: CliAuthLocationFlags,
  patch: TailnetSettingsPatch,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  const policy = yield* readInstalledPolicy;
  if (patch.enabled === true && !ManagedLimits.allowsRemoteClients(policy)) {
    return yield* ManagedLimits.refuseRemoteClients(
      policy,
      "so built-in Tailscale cannot be turned on",
    );
  }
  // Locks are per field, so a lock on one tailnet field leaves the others writable.
  const current = policy.settings.applyLocks(policy.settings.defaults);
  const vetted = policy.settings.vetWrite(
    current,
    { ...current, tailnet: { ...current.tailnet, ...patch } },
    { tailnet: patch },
  );
  if (vetted._tag === "Locked") {
    return yield* new ServerSettingsError({
      settingsPath: config.settingsPath,
      operation: "write-managed-setting",
      managedSetting: vetted.path,
      managedBy: policy.document?.organization,
    });
  }
  // A locked field the patch already matches is skipped, keeping the user's value for when the policy goes.
  const unlocked = Object.fromEntries(
    Object.entries(patch).filter(
      ([key]) => !isManagedSettingPath(policy.summary, `tailnet.${key}`),
    ),
  );
  yield* editSettingsObject(config.settingsPath, (value) => ({
    ...value,
    tailnet: { ...(Predicate.isObject(value.tailnet) ? value.tailnet : {}), ...unlocked },
  }));
});

const statusCommand = Command.make("status", authLocationFlags).pipe(
  Command.withDescription("Show built-in Tailscale's state on the running server."),
  Command.withHandler((flags) =>
    viaServer(flags, [AuthAccessReadScope], (client) =>
      client.tailnet.status({ headers: {} }),
    ).pipe(Effect.flatMap((status) => Console.log(describeTailnetStatus(status)))),
  ),
);

const loginCommand = Command.make("login", authLocationFlags).pipe(
  Command.withDescription("Print a Tailscale sign-in link for this server's built-in node."),
  Command.withHandler((flags) =>
    viaServer(flags, [AuthAccessWriteScope], (client) =>
      client.tailnet.login({ headers: {} }),
    ).pipe(
      Effect.flatMap(({ loginUrl }) =>
        Console.log(`Open this link to sign in to Tailscale:\n${loginUrl}`),
      ),
    ),
  ),
);

const logoutCommand = Command.make("logout", authLocationFlags).pipe(
  Command.withDescription("Sign this server's built-in node out of Tailscale."),
  Command.withHandler((flags) =>
    viaServer(flags, [AuthAccessWriteScope], (client) =>
      client.tailnet.logout({ headers: {} }),
    ).pipe(Effect.andThen(Console.log("Signed out of Tailscale."))),
  ),
);

const onCommand = Command.make("on", {
  ...authLocationFlags,
  hostname: Flag.String("hostname").pipe(
    Flag.withDescription("Machine name on the tailnet. Defaults to supaterm-<this machine>."),
    Flag.optional,
  ),
  controlUrl: Flag.String("control-url").pipe(
    Flag.withDescription(
      "Control server URL, such as a Headscale server. Empty for Tailscale's own.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Turn on built-in Tailscale. A server that was signed in before reuses that sign-in.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const requested = Option.getOrUndefined(flags.hostname);
      const hostname =
        requested === undefined
          ? undefined
          : yield* decodeHostname(requested).pipe(
              Effect.mapError(() => new TailscaleHostnameError({ hostname: requested })),
            );
      const requestedControlUrl = Option.getOrUndefined(flags.controlUrl);
      const controlUrl =
        requestedControlUrl === undefined
          ? undefined
          : yield* decodeControlUrl(requestedControlUrl).pipe(
              Effect.mapError(
                () => new TailscaleControlUrlError({ controlUrl: requestedControlUrl }),
              ),
            );
      yield* patchTailnetSettings(flags, {
        enabled: true,
        ...(hostname === undefined ? {} : { hostname }),
        ...(controlUrl === undefined ? {} : { controlUrl }),
      });
      yield* Console.log(
        "Built-in Tailscale is on. Run `supaterm tailscale status` to check it, and `supaterm tailscale login` if it needs you to sign in.",
      );
    }),
  ),
);

const offCommand = Command.make("off", authLocationFlags).pipe(
  Command.withDescription("Turn off built-in Tailscale. Its sign-in is kept for next time."),
  Command.withHandler((flags) =>
    patchTailnetSettings(flags, { enabled: false }).pipe(
      Effect.andThen(Console.log("Built-in Tailscale is off.")),
    ),
  ),
);

export const tailscaleCommand = Command.make("tailscale").pipe(
  Command.withDescription("Manage built-in Tailscale, which puts this server on your tailnet."),
  Command.withSubcommands([statusCommand, onCommand, offCommand, loginCommand, logoutCommand]),
);
