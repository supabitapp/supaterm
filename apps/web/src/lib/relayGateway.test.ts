import { expect, it } from "@effect/vitest";
import { RelayGateway } from "@supaterm/client-runtime/relay";
import * as Effect from "effect/Effect";
import { afterEach, vi } from "vite-plus/test";
import { layer } from "./relayGateway.ts";

const address = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt`;
const relayUrl = "wss://relay.example";
const LAN = "ws://192.168.1.20:3773";
const TAILNET = "ws://100.64.0.7:3773";

afterEach(() => {
  vi.unstubAllGlobals();
});

it.effect(
  "restarts the desktop relay only when its direct candidates change and reports its transport",
  () => {
    let transport: "relay" | "direct" | null = null;
    const startRelay = vi.fn(
      async (_address: string, _relayUrl: string, _directUrls?: ReadonlyArray<string>) =>
        "http://127.0.0.1:4321",
    );
    const getRelayVia = vi.fn(async (_address: string) => transport);
    const stopRelay = vi.fn(async (_address: string) => {});
    vi.stubGlobal("window", { desktopBridge: { startRelay, stopRelay, getRelayVia } });
    return Effect.gen(function* () {
      const gateway = yield* RelayGateway;
      const resolve = (direct: ReadonlyArray<string>) =>
        Effect.promise(() => gateway.resolve(address, relayUrl, direct));
      const refreshedVia = Effect.promise(async () => {
        gateway.via(address);
        await getRelayVia.mock.results.at(-1)?.value;
        return gateway.via(address);
      });

      expect(yield* resolve([LAN, `${LAN}/`, "http://10.0.0.1:3773", relayUrl])).toBe(
        "http://127.0.0.1:4321",
      );
      expect(yield* resolve([LAN])).toBe("http://127.0.0.1:4321");
      expect(yield* refreshedVia).toBeUndefined();
      transport = "direct";
      expect(yield* refreshedVia).toBe("direct");
      yield* resolve([TAILNET]);
      expect(startRelay.mock.calls).toEqual([
        [address, relayUrl, [LAN]],
        [address, relayUrl, [TAILNET]],
      ]);
      yield* Effect.promise(() => gateway.release(address));
      expect(stopRelay).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(layer), Effect.scoped);
  },
);
