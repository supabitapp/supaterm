import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { beforeEach, vi } from "vite-plus/test";
import * as RelayCompanion from "./RelayCompanion.ts";

const { openLoopbackRelay } = vi.hoisted(() => ({
  openLoopbackRelay: vi.fn<typeof import("@supaterm/shared/relay/tunnelNode").openLoopbackRelay>(),
}));
vi.mock("@supaterm/shared/relay/tunnelNode", () => ({ openLoopbackRelay }));

const address = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
beforeEach(() => openLoopbackRelay.mockReset());

it.effect("rejects preparation revoked by its owner and closes the late listener once", () =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<Awaited<ReturnType<typeof openLoopbackRelay>>>();
    const close = vi.fn(async () => {});
    openLoopbackRelay.mockImplementationOnce(() => {
      entered.resolve();
      return prepared.promise;
    });
    const companion = yield* RelayCompanion.RelayCompanion;
    const opening = yield* companion
      .open(address, "tab-a")
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => entered.promise);
    const closing = yield* companion
      .close(address, "tab-a")
      .pipe(Effect.forkChild({ startImmediately: true }));
    prepared.resolve({ origin: "http://127.0.0.1:4321", close });
    expect((yield* Fiber.join(opening))._tag).toBe("Failure");
    yield* Fiber.join(closing);
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);

it.effect("interrupting one pending tab preserves another tab's lease", () =>
  Effect.gen(function* () {
    const prepared = Promise.withResolvers<Awaited<ReturnType<typeof openLoopbackRelay>>>();
    const close = vi.fn(async () => {});
    openLoopbackRelay.mockReturnValueOnce(prepared.promise);
    const companion = yield* RelayCompanion.RelayCompanion;
    const first = yield* companion
      .open(address, "tab-a")
      .pipe(Effect.forkChild({ startImmediately: true }));
    const second = yield* companion
      .open(address, "tab-b")
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Fiber.interrupt(first);
    prepared.resolve({ origin: "http://127.0.0.1:4321", close });
    expect(yield* Fiber.join(second)).toBe("http://127.0.0.1:4321");
    expect(close).not.toHaveBeenCalled();
    yield* companion.close(address, "tab-b");
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);

it.effect("revokes an owner waiting behind a close without reopening its listener", () =>
  Effect.gen(function* () {
    const closing = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    openLoopbackRelay.mockResolvedValueOnce({
      origin: "http://127.0.0.1:4321",
      close: async () => {
        closing.resolve();
        await closed.promise;
      },
    });
    const companion = yield* RelayCompanion.RelayCompanion;
    yield* companion.open(address, "tab-a");
    const firstClose = yield* companion
      .close(address, "tab-a")
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => closing.promise);
    const opening = yield* companion
      .open(address, "tab-b")
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    const secondClose = yield* companion
      .close(address, "tab-b")
      .pipe(Effect.forkChild({ startImmediately: true }));
    openLoopbackRelay.mockResolvedValueOnce({
      origin: "http://127.0.0.1:4322",
      close: async () => {},
    });
    closed.resolve();
    yield* Fiber.join(firstClose);
    yield* Fiber.join(secondClose);
    expect((yield* Fiber.join(opening))._tag).toBe("Failure");
    expect(openLoopbackRelay).toHaveBeenCalledTimes(1);
    expect(yield* companion.open(address, "tab-c")).toBe("http://127.0.0.1:4322");
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);

it.effect("interrupting an owner waiting behind a close never binds its replacement", () =>
  Effect.gen(function* () {
    const closing = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    openLoopbackRelay.mockResolvedValueOnce({
      origin: "http://127.0.0.1:4321",
      close: async () => {
        closing.resolve();
        await closed.promise;
      },
    });
    const companion = yield* RelayCompanion.RelayCompanion;
    yield* companion.open(address, "tab-a");
    const firstClose = yield* companion
      .close(address, "tab-a")
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => closing.promise);
    const pending = yield* companion
      .open(address, "tab-b")
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Fiber.interrupt(pending);
    yield* companion.close(address, "tab-b");
    openLoopbackRelay.mockResolvedValueOnce({
      origin: "http://127.0.0.1:4322",
      close: async () => {},
    });
    closed.resolve();
    yield* Fiber.join(firstClose);
    expect(yield* companion.open(address, "tab-c")).toBe("http://127.0.0.1:4322");
    expect(openLoopbackRelay).toHaveBeenCalledTimes(2);
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);

it.effect("a released pending owner cannot borrow its later lease from the same endpoint", () =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<Awaited<ReturnType<typeof openLoopbackRelay>>>();
    const close = vi.fn(async () => {});
    openLoopbackRelay.mockImplementationOnce(() => {
      entered.resolve();
      return prepared.promise;
    });
    const companion = yield* RelayCompanion.RelayCompanion;
    const old = yield* companion
      .open(address, "tab-a")
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => entered.promise);
    const other = yield* companion
      .open(address, "tab-b")
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* companion.close(address, "tab-a");
    const fresh = yield* companion
      .open(address, "tab-a")
      .pipe(Effect.forkChild({ startImmediately: true }));
    prepared.resolve({ origin: "http://127.0.0.1:4321", close });
    expect((yield* Fiber.join(old))._tag).toBe("Failure");
    expect(yield* Fiber.join(other)).toBe("http://127.0.0.1:4321");
    expect(yield* Fiber.join(fresh)).toBe("http://127.0.0.1:4321");
    yield* companion.close(address, "tab-a");
    expect(close).not.toHaveBeenCalled();
    yield* companion.close(address, "tab-b");
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);

it.effect("disposal closes a pending listener and prevents later opens", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const services = yield* Layer.buildWithScope(RelayCompanion.layer(), scope);
    const companion = Context.get(services, RelayCompanion.RelayCompanion);
    const entered = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<Awaited<ReturnType<typeof openLoopbackRelay>>>();
    const close = vi.fn(async () => {});
    openLoopbackRelay.mockImplementationOnce(() => {
      entered.resolve();
      return prepared.promise;
    });
    const opening = yield* companion
      .open(address, "tab-a")
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => entered.promise);
    const disposed = yield* Scope.close(scope, Exit.void).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    expect((yield* companion.open(address, "tab-b").pipe(Effect.result))._tag).toBe("Failure");
    prepared.resolve({ origin: "http://127.0.0.1:4321", close });
    expect((yield* Fiber.join(opening))._tag).toBe("Failure");
    yield* Fiber.join(disposed);
    expect(openLoopbackRelay).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.scoped),
);

it.effect("a closed session releases every lease even when one listener fails to close", () =>
  Effect.gen(function* () {
    const other = `https://${"33".repeat(16)}.${"44".repeat(16)}.relay.supaterm.alt/`;
    const close = vi.fn(async () => {});
    const failedClose = vi.fn(async () => {
      throw new Error("Listener close failed");
    });
    openLoopbackRelay
      .mockResolvedValueOnce({ origin: "http://127.0.0.1:4321", close: failedClose })
      .mockResolvedValueOnce({ origin: "http://127.0.0.1:4322", close });
    const companion = yield* RelayCompanion.RelayCompanion;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const session = yield* companion.session;
        yield* session.open(address, "wss://relay.example");
        yield* session.open(other);
      }),
    );
    expect(failedClose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(openLoopbackRelay.mock.calls.map(([, options]) => options.relayUrl)).toEqual([
      "wss://relay.example",
      "wss://relay.supaterm.com",
    ]);
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);

it.effect("a later open refreshes direct candidates without reopening the shared tunnel", () =>
  Effect.gen(function* () {
    const close = vi.fn(async () => {});
    openLoopbackRelay.mockResolvedValueOnce({ origin: "http://127.0.0.1:4321", close });
    const companion = yield* RelayCompanion.RelayCompanion;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const session = yield* companion.session;
        yield* session.open(address, "wss://relay.example", ["ws://192.168.1.20:3773"]);
        yield* session.open(address, "wss://relay.example", ["ws://100.64.0.7:3773"]);
        expect(openLoopbackRelay).toHaveBeenCalledTimes(1);
        expect(openLoopbackRelay.mock.calls[0]![1].directUrls?.()).toEqual([
          "ws://100.64.0.7:3773",
        ]);
        expect(close).not.toHaveBeenCalled();
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(RelayCompanion.layer()), Effect.scoped),
);
