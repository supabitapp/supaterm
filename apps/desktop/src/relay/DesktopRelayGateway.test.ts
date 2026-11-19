import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { DesktopRelayViaChange } from "@supaterm/contracts";
import type { openLoopbackRelay } from "@supaterm/shared/relay/tunnelNode";
import { vi } from "vite-plus/test";
import * as DesktopRelayGateway from "./DesktopRelayGateway.ts";

type OpenLoopbackRelay = typeof openLoopbackRelay;
type OpenedRelay = Awaited<ReturnType<OpenLoopbackRelay>>;

function makeOpener() {
  const calls: Array<Parameters<OpenLoopbackRelay>> = [];
  const replies: Array<() => Promise<OpenedRelay>> = [];
  const open: OpenLoopbackRelay = (...args) => {
    calls.push(args);
    const next = replies.shift();
    return next ? next() : Promise.reject(new Error("unexpected relay open"));
  };
  const reply = (opened: OpenedRelay) => replies.push(async () => opened);
  return { calls, replies, reply, layer: DesktopRelayGateway.layerWith(open) };
}

const address = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
const RELAY_URL = "wss://relay.example";

it.effect("rejects a pending start revoked by stop and closes its listener once", () => {
  const opener = makeOpener();
  return Effect.gen(function* () {
    const entered = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<OpenedRelay>();
    const close = vi.fn(async () => {});
    opener.replies.push(() => {
      entered.resolve();
      return prepared.promise;
    });
    const gateway = yield* DesktopRelayGateway.DesktopRelayGateway;
    const opening = yield* gateway
      .start(address, RELAY_URL)
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => entered.promise);
    const stopping = yield* gateway
      .stop(address)
      .pipe(Effect.forkChild({ startImmediately: true }));
    prepared.resolve({ origin: "http://127.0.0.1:4321", close });
    expect((yield* Fiber.join(opening))._tag).toBe("Failure");
    yield* Fiber.join(stopping);
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(opener.layer));
});

it.effect("revokes a start waiting behind a close while allowing a later fresh start", () => {
  const opener = makeOpener();
  return Effect.gen(function* () {
    const closing = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const oldClose = vi.fn(async () => {
      closing.resolve();
      await closed.promise;
    });
    opener.reply({ origin: "http://127.0.0.1:4321", close: oldClose });
    const gateway = yield* DesktopRelayGateway.DesktopRelayGateway;
    yield* gateway.start(address, RELAY_URL);
    const firstStop = yield* gateway
      .stop(address)
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => closing.promise);
    const opening = yield* gateway
      .start(address, RELAY_URL)
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    const secondStop = yield* gateway
      .stop(address)
      .pipe(Effect.forkChild({ startImmediately: true }));
    const newClose = vi.fn(async () => {});
    opener.reply({ origin: "http://127.0.0.1:4322", close: newClose });
    closed.resolve();
    yield* Fiber.join(firstStop);
    yield* Fiber.join(secondStop);
    expect((yield* Fiber.join(opening))._tag).toBe("Failure");
    expect(opener.calls).toHaveLength(1);
    expect(yield* gateway.start(address, RELAY_URL)).toBe("http://127.0.0.1:4322");
    yield* gateway.stop(address);
    expect(oldClose).toHaveBeenCalledTimes(1);
    expect(newClose).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(opener.layer));
});

it.effect.each(["binding", "closing"] as const)(
  "disposal revokes a start during %s and drains all closing listeners",
  (state) =>
    Effect.gen(function* () {
      const opener = makeOpener();
      const scope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
      const services = yield* Layer.buildWithScope(opener.layer, scope);
      const gateway = Context.get(services, DesktopRelayGateway.DesktopRelayGateway);
      const entered = Promise.withResolvers<void>();
      const prepared = Promise.withResolvers<OpenedRelay>();
      const closing = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      const close = vi.fn(async () => {
        closing.resolve();
        if (state === "closing") await closed.promise;
      });
      opener.replies.push(() => {
        entered.resolve();
        return prepared.promise;
      });
      const first = yield* gateway
        .start(address, RELAY_URL)
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      yield* Effect.promise(() => entered.promise);
      let pending = first;
      if (state === "closing") {
        prepared.resolve({ origin: "http://127.0.0.1:4321", close });
        expect((yield* Fiber.join(first))._tag).toBe("Success");
        yield* gateway.stop(address).pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => closing.promise);
        pending = yield* gateway
          .start(address, RELAY_URL)
          .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      }
      const disposed = yield* Scope.close(scope, Exit.void).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      expect((yield* gateway.start(address, RELAY_URL).pipe(Effect.result))._tag).toBe("Failure");
      prepared.resolve({ origin: "http://127.0.0.1:4321", close });
      closed.resolve();
      expect((yield* Fiber.join(pending))._tag).toBe("Failure");
      yield* Fiber.join(disposed);
      expect(opener.calls).toHaveLength(1);
      expect(close).toHaveBeenCalledTimes(1);
    }),
);

it.effect("a failed close does not prevent reopening or disposal of other environments", () => {
  const opener = makeOpener();
  return Effect.gen(function* () {
    const close = vi.fn(async () => {});
    const failedClose = vi.fn(async () => {
      throw new Error("Listener close failed");
    });
    opener.reply({ origin: "http://127.0.0.1:4321", close: failedClose });
    opener.reply({ origin: "http://127.0.0.1:4322", close: failedClose });
    opener.reply({ origin: "http://127.0.0.1:4323", close });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* DesktopRelayGateway.DesktopRelayGateway;
        yield* gateway.start(address, RELAY_URL);
        expect((yield* gateway.stop(address).pipe(Effect.result))._tag).toBe("Failure");
        expect(yield* gateway.start(address, RELAY_URL)).toBe("http://127.0.0.1:4322");
        const other = `https://${"33".repeat(16)}.${"44".repeat(16)}.relay.supaterm.alt/`;
        yield* gateway.start(other, RELAY_URL);
      }).pipe(Effect.provide(opener.layer)),
    );
    expect(failedClose).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

it.effect("a repeated start updates direct candidates without reopening the tunnel", () => {
  const opener = makeOpener();
  return Effect.gen(function* () {
    const LAN = "ws://192.168.1.20:3773";
    const TAILNET = "ws://100.64.0.7:3773";
    const close = vi.fn(async () => {});
    opener.reply({ origin: "http://127.0.0.1:4321", close });
    const gateway = yield* DesktopRelayGateway.DesktopRelayGateway;
    expect(yield* gateway.start(address, RELAY_URL, [LAN])).toBe("http://127.0.0.1:4321");
    expect(yield* gateway.start(address, RELAY_URL, [TAILNET])).toBe("http://127.0.0.1:4321");
    expect(opener.calls).toHaveLength(1);
    expect(opener.calls[0]![1].directUrls?.()).toEqual([TAILNET]);
    expect(close).not.toHaveBeenCalled();
    yield* gateway.stop(address);
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(opener.layer));
});

it.effect("pushes the tunnel's transport as it changes and on each start, until it stops", () => {
  const opener = makeOpener();
  return Effect.gen(function* () {
    const identity = address.slice(0, -1);
    opener.reply({
      origin: "http://127.0.0.1:4321",
      close: async () => {},
    });
    const gateway = yield* DesktopRelayGateway.DesktopRelayGateway;
    const changes: Array<DesktopRelayViaChange> = [];
    yield* gateway.subscribe((change) => Effect.sync(() => changes.push(change)));
    yield* gateway.start(address, RELAY_URL);
    const report = opener.calls[0]![1].onVia!;
    report("direct");
    report("direct");
    report("relay");
    yield* gateway.start(address, RELAY_URL);
    yield* gateway.stop(address);
    report("direct");
    expect(changes).toEqual([
      { address: identity, via: null },
      { address: identity, via: "direct" },
      { address: identity, via: "relay" },
      { address: identity, via: "relay" },
      { address: identity, via: null },
    ]);
  }).pipe(Effect.provide(opener.layer));
});
