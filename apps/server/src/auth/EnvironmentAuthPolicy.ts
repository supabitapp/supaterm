import type { ServerAuthDescriptor, ServerAuthPolicy } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { isRemoteReachableHost, resolveSessionCookieName } from "./utils.ts";

export class EnvironmentAuthPolicy extends Context.Service<
  EnvironmentAuthPolicy,
  {
    readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
  }
>()("supaterm/auth/EnvironmentAuthPolicy") {}

/** The auth policy a server started with `config` runs under; Tailscale Serve counts as remote. */
export function resolveServerAuthPolicy(
  config: Pick<ServerConfig.ServerConfig["Service"], "mode" | "host" | "tailscaleServeEnabled">,
): ServerAuthPolicy {
  if (config.tailscaleServeEnabled || isRemoteReachableHost(config.host)) return "remote-reachable";
  return config.mode === "desktop" ? "desktop-managed-local" : "loopback-browser";
}

/** Built-in Tailscale makes any server reachable, and only pairing links reach it there. */
export function tailnetAuthDescriptor(descriptor: ServerAuthDescriptor): ServerAuthDescriptor {
  return { ...descriptor, policy: "remote-reachable", bootstrapMethods: ["one-time-token"] };
}

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const policy = resolveServerAuthPolicy(config);

  const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] =
    policy === "desktop-managed-local"
      ? ["desktop-bootstrap"]
      : config.mode === "desktop" && policy === "remote-reachable"
        ? ["desktop-bootstrap", "one-time-token"]
        : ["one-time-token"];

  const descriptor: ServerAuthDescriptor = {
    policy,
    bootstrapMethods,
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: resolveSessionCookieName({
      mode: config.mode,
      port: config.port,
      host: config.host,
      instanceKey: config.stateDir,
      environmentId: yield* serverEnvironment.getEnvironmentId,
      development: config.devUrl !== undefined,
    }),
  };

  return EnvironmentAuthPolicy.of({
    getDescriptor: Effect.fn("EnvironmentAuthPolicy.getDescriptor")(function () {
      return Effect.succeed(descriptor);
    }),
  });
});

export const layer = Layer.effect(EnvironmentAuthPolicy, make);
