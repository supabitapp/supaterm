import { createRelayCompanionControl, isRelayCompanion } from "./relayCompanion";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RelayGateway from "@supaterm/client-runtime/relay";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";
import { directTunnelUrls } from "@supaterm/shared/relay/tunnel";

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const companion = createRelayCompanionControl();
    yield* Effect.addFinalizer(() => Effect.sync(() => companion.close()));
    const desktop = typeof window === "undefined" ? undefined : window.desktopBridge;
    return RelayGateway.layer({
      available: Boolean(desktop?.startRelay && desktop.stopRelay) || isRelayCompanion(),
      fetch: (input, init) => globalThis.fetch(input, init),
      open: async (address, relayUrl, directUrls, report) => {
        if (desktop?.startRelay && desktop.stopRelay) {
          const { startRelay, stopRelay } = desktop;
          const identity = canonicalRelayAddress(address);
          const unsubscribe = desktop.onRelayViaChanged?.((change) => {
            if (canonicalRelayAddress(change.address) === identity) report(change.via ?? undefined);
          });
          let closed = false;
          let started:
            | { readonly candidates: string; readonly origin: Promise<string> }
            | undefined;
          return {
            // Every remote HTTP request prepares its origin, so the desktop
            // tunnel is only restarted when its direct candidates change.
            prepare: () => {
              if (closed) return Promise.reject(new Error("Relay endpoint closed"));
              const urls = directTunnelUrls(directUrls(), relayUrl);
              const candidates = urls.join(" ");
              if (started === undefined || started.candidates !== candidates) {
                const current = { candidates, origin: startRelay(address, relayUrl, urls) };
                started = current;
                current.origin.catch(() => {
                  if (started === current) started = undefined;
                });
              }
              return started.origin;
            },
            close: () => {
              closed = true;
              started = undefined;
              unsubscribe?.();
              return stopRelay(address);
            },
          };
        }
        if (!isRelayCompanion())
          throw new Error(
            "Run supaterm relay-client locally to connect this browser through the relay.",
          );
        const prepare = async () => {
          const resolved = await companion.request(
            "open",
            address,
            relayUrl,
            directTunnelUrls(directUrls(), relayUrl),
          );
          if (!resolved) throw new Error("The companion did not return a relay origin.");
          const origin = new URL(resolved);
          if (
            origin.protocol !== "http:" ||
            origin.hostname !== "127.0.0.1" ||
            !origin.port ||
            origin.username ||
            origin.password
          )
            throw new Error("Invalid relay companion origin");
          return origin.origin;
        };
        return {
          prepare,
          close: async () => {
            await companion.request("close", address);
          },
        };
      },
    });
  }),
);
