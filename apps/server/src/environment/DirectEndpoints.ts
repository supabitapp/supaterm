import type { ServerDirectEndpoint } from "@supaterm/contracts";
import {
  buildTailscaleHttpsBaseUrl,
  probeTailscaleHttpsEndpoint,
  readTailscaleStatus,
} from "@supaterm/tailscale";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { HttpClient } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import * as HostProcess from "@supaterm/shared/HostProcess";
import {
  formatHostForUrl,
  isPrivateNetworkHost,
  isTailnetHost,
  isWildcardHost,
} from "@supaterm/shared/hostClassification";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";
import { isLoopbackHost } from "../startupAccess.ts";

type NetworkInterfacesMap = ReturnType<typeof NodeOS.networkInterfaces>;

const TAILSCALE_ENDPOINT_TIMEOUT = Duration.seconds(3);

export class DirectEndpoints extends Context.Service<
  DirectEndpoints,
  {
    readonly resolveAvailable: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
    readonly resolve: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
  }
>()("supaterm/environment/DirectEndpoints") {}

const isAdvertisableAddress = (address: string): boolean =>
  NodeNet.isIPv4(address) &&
  !address.startsWith("127.") &&
  !address.startsWith("169.254.") &&
  isPrivateNetworkHost(address);

const VIRTUAL_INTERFACE =
  /^(docker|br-|veth|virbr|vmnet|vboxnet|vEthernet|podman|cni|flannel|cali|lxcbr|lxdbr|bridge1\d\d)/;

const LINUX_CONTAINER_INTERFACE = /^(ve-|vb-|vz-)/;

const isVirtualInterface = (name: string, platform: NodeJS.Platform): boolean =>
  VIRTUAL_INTERFACE.test(name) || (platform === "linux" && LINUX_CONTAINER_INTERFACE.test(name));

const isTailscaleInterface = (
  name: string,
  entries: ReadonlyArray<NodeOS.NetworkInterfaceInfo>,
): boolean =>
  /^tailscale/i.test(name) ||
  entries.some((entry) => entry.family === "IPv6" && isTailnetHost(entry.address));

const WINDOWS_HOST_ADAPTER_MAC = /^(0a:00:27|00:50:56:c0:00):/i;

export function resolveBoundEndpoints(input: {
  readonly platform: NodeJS.Platform;
  readonly host: string | undefined;
  readonly port: number;
  readonly interfaces: NetworkInterfacesMap;
}): ReadonlyArray<ServerDirectEndpoint> {
  if (isLoopbackHost(input.host)) return [];
  const tailscaleAddresses = new Set(
    Object.entries(input.interfaces).flatMap(([name, entries = []]) =>
      isTailscaleInterface(name, entries) ? entries.map((entry) => entry.address) : [],
    ),
  );
  const addresses = isWildcardHost(input.host)
    ? Object.entries(input.interfaces)
        .flatMap(([name, entries]) =>
          isVirtualInterface(name, input.platform) ? [] : (entries ?? []),
        )
        .filter(
          (entry) =>
            !entry.internal &&
            entry.family === "IPv4" &&
            isAdvertisableAddress(entry.address) &&
            !(input.platform === "win32" && WINDOWS_HOST_ADAPTER_MAC.test(entry.mac)),
        )
        .map((entry) => entry.address)
    : [input.host!].filter(
        (address) =>
          isAdvertisableAddress(address) || (NodeNet.isIPv6(address) && isTailnetHost(address)),
      );
  return [...new Set(addresses)].map((address) => ({
    kind: tailscaleAddresses.has(address) ? "tailnet" : "lan",
    httpBaseUrl: `http://${formatHostForUrl(address)}:${input.port}/`,
  }));
}

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const httpClient = yield* HttpClient.HttpClient;
  const platform = yield* HostProcess.Platform;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;

  const servedEndpoint = yield* Ref.make<Option.Option<string>>(Option.none());
  const resolveAvailable = Effect.fn("DirectEndpoints.resolveAvailable")(function* () {
    const endpoints = [
      ...resolveBoundEndpoints({
        platform,
        host: config.host,
        port: config.port,
        interfaces: NodeOS.networkInterfaces(),
      }),
    ];
    const servedUrl = yield* Ref.get(servedEndpoint);
    if (Option.isSome(servedUrl)) endpoints.push({ kind: "tailnet", httpBaseUrl: servedUrl.value });
    return endpoints;
  });

  const resolve = Effect.gen(function* () {
    if (config.tailscaleServeEnabled) {
      const servedUrl = yield* readTailscaleStatus.pipe(
        Effect.map((status) => status.magicDnsName),
        Effect.flatMap((magicDnsName) => {
          if (magicDnsName === null) return Effect.succeed(null);
          const httpBaseUrl = buildTailscaleHttpsBaseUrl({
            magicDnsName,
            servePort: config.tailscaleServePort,
          });
          return probeTailscaleHttpsEndpoint({ baseUrl: httpBaseUrl, environmentId }).pipe(
            Effect.map((reachable) => (reachable ? httpBaseUrl : null)),
          );
        }),
        Effect.timeoutOption(TAILSCALE_ENDPOINT_TIMEOUT),
        Effect.map(Option.flatMap(Option.fromNullishOr)),
        Effect.orElseSucceed(() => Option.none<string>()),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      yield* Ref.set(servedEndpoint, servedUrl);
    }
    return yield* resolveAvailable();
  });

  return DirectEndpoints.of({
    resolveAvailable,
    resolve: Effect.fn("DirectEndpoints.resolve")(function () {
      return resolve;
    }),
  });
});

export const layer = Layer.effect(DirectEndpoints, make);
