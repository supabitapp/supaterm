import { type RemoteOpenTarget } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NetService from "@supaterm/shared/Net";
import { readTailscaleSshEnabled, readTailscaleStatus } from "@supaterm/tailscale";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeStaleWhileRevalidate } from "./staleWhileRevalidate.ts";

const SSH_PORT = 22;
const TARGETS_CACHE_TTL = "60 seconds";

export class RemoteOpenTargets extends Context.Service<
  RemoteOpenTargets,
  {
    readonly resolveTargets: () => Effect.Effect<ReadonlyArray<RemoteOpenTarget>>;
  }
>()("supaterm/environment/RemoteOpenTargets") {}

/** @public */
export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const net = yield* NetService.NetService;

  const discoverTargets = Effect.gen(function* () {
    const sshdListening = yield* Effect.zipWith(
      net.hasListenerOnHost(SSH_PORT, "127.0.0.1"),
      net.hasListenerOnHost(SSH_PORT, "::1"),
      (ipv4, ipv6) => ipv4 || ipv6,
    );
    const username = yield* HostProcess.Username;

    const tailscaleStatus = yield* readTailscaleStatus.pipe(
      Effect.orElseSucceed(() => null),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    const magicDnsName =
      tailscaleStatus?.running === false ? null : (tailscaleStatus?.magicDnsName ?? null);

    const targets: Array<RemoteOpenTarget> = [];

    if (!sshdListening) {
      if (magicDnsName === null) return targets;
      const tailnetSshdListening = yield* Effect.forEach(
        tailscaleStatus?.tailnetIpv4Addresses ?? [],
        (address) => net.hasListenerOnHost(SSH_PORT, address),
      ).pipe(Effect.map((listening) => listening.includes(true)));
      const sshRoute =
        tailnetSshdListening ||
        (yield* readTailscaleSshEnabled.pipe(
          Effect.orElseSucceed(() => false),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ));
      if (sshRoute) {
        targets.push({
          kind: "tailscale",
          host: magicDnsName,
          ...(username === null ? {} : { username }),
        });
      }
      return targets;
    }

    if (magicDnsName !== null) {
      targets.push({
        kind: "tailscale",
        host: magicDnsName,
        ...(username === null ? {} : { username }),
      });
    }

    const hostname = yield* HostProcess.Hostname;
    const shortHostname = hostname.split(".")[0]?.trim();
    if (shortHostname !== undefined && shortHostname.length > 0) {
      targets.push({
        kind: "mdns",
        host: `${shortHostname}.local`,
        ...(username === null ? {} : { username }),
      });
    }

    return targets;
  });

  const resolveTargets = yield* makeStaleWhileRevalidate(discoverTargets, TARGETS_CACHE_TTL);

  return RemoteOpenTargets.of({
    resolveTargets: Effect.fn("RemoteOpenTargets.resolveTargets")(function () {
      return resolveTargets;
    }),
  });
});

export const layer = Layer.effect(RemoteOpenTargets, make);
