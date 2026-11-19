// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - The real loopback servers receive the gateway-rewritten requests.
import { expect, it } from "@effect/vitest";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as Effect from "effect/Effect";
import { relayHttpBaseUrl, relayPublicKey } from "@supaterm/shared/relay/protocol";
import { layer, RelayGateway, type RelayTransport } from "./gateway.ts";

const address = relayHttpBaseUrl(relayPublicKey(new Uint8Array(32).fill(19)));

const localServer = Effect.acquireRelease(
  Effect.promise(async () => {
    const received: string[] = [];
    const server = NodeHttp.createServer((request, response) => {
      received.push(request.url ?? "");
      response.end("okay");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as NodeNet.AddressInfo;
    return { server, received, origin: `http://127.0.0.1:${port}` };
  }),
  ({ server }) =>
    Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
);
it.effect("reuses one endpoint, refreshes preparation and closes on runtime disposal", () =>
  Effect.gen(function* () {
    let opens = 0;
    let closes = 0;
    const first = yield* localServer;
    const second = yield* localServer;
    let origin = first.origin;
    const requests: string[] = [];
    const fetcher: typeof fetch = (input, init) => {
      requests.push(String(input));
      return fetch(input, init);
    };
    yield* Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* RelayGateway;
        const values = yield* Effect.promise(() =>
          Promise.all([gateway.resolve(address), gateway.resolve(address)]),
        );
        expect(values).toEqual([first.origin, first.origin]);
        expect(opens).toBe(1);
        origin = second.origin;
        expect(yield* Effect.promise(() => gateway.resolve(address))).toBe(second.origin);
        const response = yield* Effect.promise(() => gateway.fetch(address + "api/test?range=2"));
        expect(yield* Effect.promise(() => response.text())).toBe("okay");
        expect(requests).toEqual([`${second.origin}/api/test?range=2`]);
        expect(second.received).toEqual(["/api/test?range=2"]);
        expect(first.received).toEqual([]);
      }).pipe(
        Effect.provide(
          layer({
            fetch: fetcher,
            open: async () => {
              opens++;
              return {
                prepare: async () => origin,
                close: async () => {
                  closes++;
                },
              };
            },
          }),
        ),
      ),
    );
    expect(closes).toBe(1);
  }),
);

it.effect("waits for an old endpoint to close before opening its replacement", () =>
  Effect.gen(function* () {
    let closeStarted!: () => void;
    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      closeStarted = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    let opens = 0;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* RelayGateway;
        yield* Effect.promise(() => gateway.resolve(address));
        const released = gateway.release(address);
        yield* Effect.promise(() => closing);
        const prepared = gateway.resolve(address);
        expect(opens).toBe(1);
        finishClose();
        yield* Effect.promise(() => released);
        expect(yield* Effect.promise(() => prepared)).toBe("http://127.0.0.1:1002");
      }).pipe(
        Effect.provide(
          layer({
            fetch,
            open: async () => {
              const generation = ++opens;
              return {
                prepare: async () => `http://127.0.0.1:${1000 + generation}`,
                close: async () => {
                  if (generation === 1) {
                    closeStarted();
                    await closed;
                  }
                },
              };
            },
          }),
        ),
      ),
    );
  }),
);

it.effect("reopens after an endpoint fails to close", () => {
  let opens = 0;
  return Effect.gen(function* () {
    const gateway = yield* RelayGateway;
    yield* Effect.promise(() => gateway.resolve(address));
    yield* Effect.promise(() => gateway.release(address));
    expect(yield* Effect.promise(() => gateway.resolve(address))).toBe("http://127.0.0.1:1002");
  }).pipe(
    Effect.provide(
      layer({
        fetch,
        open: async () => {
          const generation = ++opens;
          return {
            prepare: async () => `http://127.0.0.1:${1000 + generation}`,
            close: async () => {
              throw new Error("Companion offline");
            },
          };
        },
      }),
    ),
  );
});

it.effect("dials each host through its saved relay and moves when the relay changes", () =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const closed: string[] = [];
    yield* Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* RelayGateway;
        yield* Effect.promise(() => gateway.fetch(address + "api/one"));
        yield* Effect.promise(() => gateway.resolve(address, "wss://relay.example"));
        yield* Effect.promise(() => gateway.fetch(address + "api/two"));
        expect(opened).toEqual(["wss://relay.supaterm.com", "wss://relay.example"]);
        expect(closed).toEqual(["wss://relay.supaterm.com"]);
      }).pipe(
        Effect.provide(
          layer({
            fetch: async () => new Response("okay"),
            open: async (_address, relayUrl) => {
              opened.push(relayUrl);
              return {
                prepare: async () => "http://127.0.0.1:3000",
                close: async () => {
                  closed.push(relayUrl);
                },
              };
            },
          }),
        ),
      ),
    );
    expect(closed).toEqual(["wss://relay.supaterm.com", "wss://relay.example"]);
  }),
);

it.effect("closes an abandoned lease even when its endpoint opens late", () =>
  Effect.gen(function* () {
    const opened = Promise.withResolvers<void>();
    const endpoint = Promise.withResolvers<import("./gateway.ts").RelayClientEndpoint>();
    let closes = 0;
    yield* Effect.gen(function* () {
      const gateway = yield* RelayGateway;
      const lease = gateway.lease(address);
      const pending = lease.prepare().catch(() => "abandoned");
      yield* Effect.promise(() => opened.promise);
      const closing = lease.close();
      endpoint.resolve({
        prepare: async () => "http://127.0.0.1:3000",
        close: async () => {
          closes++;
        },
      });
      expect(yield* Effect.promise(() => pending)).toBe("abandoned");
      yield* Effect.promise(() => closing);
      expect(closes).toBe(1);
    }).pipe(
      Effect.provide(
        layer({
          fetch,
          open: () => {
            opened.resolve();
            return endpoint.promise;
          },
        }),
      ),
      Effect.scoped,
    );
    expect(closes).toBe(1);
  }),
);

it.effect("preserves a tunnel shared with another lease or an existing connection", () =>
  Effect.gen(function* () {
    let opens = 0;
    let closes = 0;
    yield* Effect.gen(function* () {
      const gateway = yield* RelayGateway;
      const first = gateway.lease(address);
      const second = gateway.lease(address);
      yield* Effect.promise(() => first.prepare());
      yield* Effect.promise(() => first.close());
      expect(closes).toBe(0);
      expect(yield* Effect.promise(() => second.prepare())).toBe("http://127.0.0.1:3000");
      second.retain();
      yield* Effect.promise(() => second.close());
      const abandoned = gateway.lease(address);
      yield* Effect.promise(() => abandoned.close());
      expect(closes).toBe(0);
      yield* Effect.promise(() => gateway.resolve(address));
      expect(opens).toBe(1);
    }).pipe(
      Effect.provide(
        layer({
          fetch,
          open: async () => {
            opens++;
            return {
              prepare: async () => "http://127.0.0.1:3000",
              close: async () => {
                closes++;
              },
            };
          },
        }),
      ),
      Effect.scoped,
    );
    expect(closes).toBe(1);
  }),
);

it.effect("keeps a leased tunnel that a connection resolved before the lease closed", () =>
  Effect.gen(function* () {
    let opens = 0;
    let closes = 0;
    yield* Effect.gen(function* () {
      const gateway = yield* RelayGateway;
      const check = gateway.lease(address);
      yield* Effect.promise(() => check.prepare());
      yield* Effect.promise(() => gateway.resolve(address));
      yield* Effect.promise(() => check.close());
      expect(closes).toBe(0);
      expect(opens).toBe(1);
    }).pipe(
      Effect.provide(
        layer({
          fetch,
          open: async () => {
            opens++;
            return {
              prepare: async () => "http://127.0.0.1:3000",
              close: async () => {
                closes++;
              },
            };
          },
        }),
      ),
      Effect.scoped,
    );
    expect(closes).toBe(1);
  }),
);

it.effect("does not open an abandoned lease waiting behind an old endpoint closing", () =>
  Effect.gen(function* () {
    const finishClose = Promise.withResolvers<void>();
    const startedClose = Promise.withResolvers<void>();
    let opens = 0;
    yield* Effect.gen(function* () {
      const gateway = yield* RelayGateway;
      yield* Effect.promise(() => gateway.resolve(address));
      const releasing = gateway.release(address);
      yield* Effect.promise(() => startedClose.promise);
      const lease = gateway.lease(address);
      const preparing = lease.prepare().catch(() => "abandoned");
      const closing = lease.close();
      finishClose.resolve();
      yield* Effect.promise(() => Promise.all([releasing, closing]));
      expect(yield* Effect.promise(() => preparing)).toBe("abandoned");
      expect(opens).toBe(1);
      expect(yield* Effect.promise(() => gateway.resolve(address))).toBe("http://127.0.0.1:3000");
      expect(opens).toBe(2);
    }).pipe(
      Effect.provide(
        layer({
          fetch,
          open: async () => {
            opens++;
            return {
              prepare: async () => "http://127.0.0.1:3000",
              close: async () => {
                startedClose.resolve();
                await finishClose.promise;
              },
            };
          },
        }),
      ),
      Effect.scoped,
    );
  }),
);

it.effect("publishes each endpoint's reported transport and clears it on release", () =>
  Effect.gen(function* () {
    const reports: Array<(via: RelayTransport | undefined) => void> = [];
    let notified = 0;
    yield* Effect.gen(function* () {
      const gateway = yield* RelayGateway;
      const unsubscribe = gateway.subscribe(() => {
        notified++;
      });
      yield* Effect.promise(() => gateway.resolve(address));
      expect(gateway.via(address)).toBeUndefined();
      const report = reports[0]!;
      report("direct");
      report("direct");
      expect(gateway.via(address + "/")).toBe("direct");
      expect(notified).toBe(1);
      report("relay");
      expect(gateway.via(address)).toBe("relay");
      expect(notified).toBe(2);

      yield* Effect.promise(() => gateway.release(address));
      expect(gateway.via(address)).toBeUndefined();
      expect(notified).toBe(3);
      report("direct");
      expect(gateway.via(address)).toBeUndefined();

      yield* Effect.promise(() => gateway.resolve(address));
      reports[1]!("direct");
      expect(notified).toBe(4);
      unsubscribe();
      reports[1]!("relay");
      expect(gateway.via(address)).toBe("relay");
      expect(notified).toBe(4);
    }).pipe(
      Effect.provide(
        layer({
          fetch,
          open: async (_address, _relayUrl, _directUrls, report) => {
            reports.push(report);
            return { prepare: async () => "http://127.0.0.1:3000", close: async () => {} };
          },
        }),
      ),
      Effect.scoped,
    );
  }),
);
