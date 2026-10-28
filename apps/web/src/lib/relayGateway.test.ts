import { expect, it } from "@effect/vitest";
import { RelayGateway } from "@supaterm/client-runtime/relay";
import type { DesktopRelayViaChange } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { afterEach, vi } from "vite-plus/test";
import { layer } from "./relayGateway.ts";

const address = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt`;
const otherAddress = `https://${"33".repeat(16)}.${"44".repeat(16)}.relay.supaterm.alt`;
const relayUrl = "wss://relay.example";
const LAN = "ws://192.168.1.20:3773";
const TAILNET = "ws://100.64.0.7:3773";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDesktopBridge() {
  const listeners = new Set<(change: DesktopRelayViaChange) => void>();
  const bridge = {
    startRelay: vi.fn(
      async (_address: string, _relayUrl: string, _directUrls?: ReadonlyArray<string>) =>
        "http://127.0.0.1:4321",
    ),
    stopRelay: vi.fn(async (_address: string) => {}),
    onRelayViaChanged: vi.fn((listener: (change: DesktopRelayViaChange) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  vi.stubGlobal("window", { desktopBridge: bridge });
  return {
    bridge,
    listeners,
    push: (change: DesktopRelayViaChange) => {
      for (const listener of listeners) listener(change);
    },
  };
}

it.effect("restarts the desktop relay only when its direct candidates change", () => {
  const { bridge } = stubDesktopBridge();
  return Effect.gen(function* () {
    const gateway = yield* RelayGateway;
    const resolve = (direct: ReadonlyArray<string>) =>
      Effect.promise(() => gateway.resolve(address, relayUrl, direct));

    expect(yield* resolve([LAN, `${LAN}/`, "http://10.0.0.1:3773", relayUrl])).toBe(
      "http://127.0.0.1:4321",
    );
    expect(yield* resolve([LAN])).toBe("http://127.0.0.1:4321");
    yield* resolve([TAILNET]);
    expect(bridge.startRelay.mock.calls).toEqual([
      [address, relayUrl, [LAN]],
      [address, relayUrl, [TAILNET]],
    ]);
    yield* Effect.promise(() => gateway.release(address));
    expect(bridge.stopRelay).toHaveBeenCalledOnce();
  }).pipe(Effect.provide(layer), Effect.scoped);
});

it.effect("reports the desktop tunnel's pushed transport for its own address until closed", () => {
  const { bridge, listeners, push } = stubDesktopBridge();
  return Effect.gen(function* () {
    const gateway = yield* RelayGateway;
    let notified = 0;
    const unsubscribe = gateway.subscribe(() => {
      notified++;
    });
    yield* Effect.promise(() => gateway.resolve(address, relayUrl, [LAN]));
    expect(gateway.via(address)).toBeUndefined();

    push({ address: `${address}/`, via: "direct" });
    expect(gateway.via(address)).toBe("direct");
    push({ address: otherAddress, via: "relay" });
    expect(gateway.via(address)).toBe("direct");
    expect(gateway.via(otherAddress)).toBeUndefined();
    push({ address, via: "relay" });
    expect(gateway.via(address)).toBe("relay");
    push({ address, via: null });
    expect(gateway.via(address)).toBeUndefined();
    push({ address, via: "direct" });
    expect(notified).toBe(4);
    expect(bridge.onRelayViaChanged).toHaveBeenCalledOnce();
    expect(bridge.startRelay).toHaveBeenCalledOnce();

    yield* Effect.promise(() => gateway.release(address));
    expect(listeners.size).toBe(0);
    expect(gateway.via(address)).toBeUndefined();
    expect(notified).toBe(5);
    unsubscribe();
  }).pipe(Effect.provide(layer), Effect.scoped);
});
