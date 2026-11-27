// @effect-diagnostics nodeBuiltinImport:off - exercises the ingress over real loopback sockets.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";

import { openIngress } from "./TailnetIngress.ts";
import { tailnetPeerOfSocket } from "./tailnetPeer.ts";

const exchange = (address: string, chunks: ReadonlyArray<string>) =>
  Effect.callback<string>((resume) => {
    const [host, port] = address.split(":");
    let received = "";
    const socket = NodeNet.connect(Number(port), host!, () => {
      for (const chunk of chunks) socket.write(chunk);
    });
    socket.on("data", (data) => {
      received += data.toString("utf8");
    });
    socket.on("close", () => resume(Effect.succeed(received)));
    socket.on("error", () => undefined);
  });

const preamble = (secret: string, overrides: Record<string, unknown> = {}) =>
  `${JSON.stringify({
    version: 1,
    secret,
    tls: true,
    remoteAddress: "100.64.0.7",
    remotePort: 41641,
    identity: { login: "alice@example.com" },
    ...overrides,
  })}\n`;

const request =
  "GET /probe HTTP/1.1\r\nHost: supaterm-mbp.tail1234.ts.net\r\nConnection: close\r\n\r\n";

const withIngress = Effect.gen(function* () {
  const server = NodeHttp.createServer((incoming, response) => {
    response.end(
      JSON.stringify({
        url: incoming.url,
        remoteAddress: incoming.socket.remoteAddress,
        peer: tailnetPeerOfSocket(incoming.socket) ?? null,
      }),
    );
  });
  return yield* openIngress(server);
});

const body = (response: string) => JSON.parse(response.slice(response.indexOf("\r\n\r\n") + 4));

it.live("hands an authenticated connection to the HTTP server as the tailnet caller", () =>
  Effect.gen(function* () {
    const { address, secret } = yield* withIngress;
    const line = preamble(secret);
    const response = yield* exchange(address, [line.slice(0, 20), line.slice(20) + request]);
    expect(response.startsWith("HTTP/1.1 200")).toBe(true);
    expect(body(response)).toEqual({
      url: "/probe",
      remoteAddress: "100.64.0.7",
      peer: {
        tls: true,
        remoteAddress: "100.64.0.7",
        identity: { login: "alice@example.com" },
      },
    });
  }).pipe(Effect.scoped),
);

it.live("closes a connection whose preamble is wrong or oversized", () =>
  Effect.gen(function* () {
    const { address, secret } = yield* withIngress;
    expect(yield* exchange(address, [preamble(`${secret}x`) + request])).toBe("");
    expect(yield* exchange(address, ["not json\n" + request])).toBe("");
    expect(yield* exchange(address, ["x".repeat(5000)])).toBe("");
  }).pipe(Effect.scoped),
);

const openConnection = (address: string, login: string, secret: string) =>
  Effect.gen(function* () {
    const responded = yield* Deferred.make<void>();
    const closed = yield* Deferred.make<void>();
    const [host, port] = address.split(":");
    const socket = NodeNet.connect(Number(port), host!, () => {
      socket.write(
        preamble(secret, { identity: { login } }) +
          "GET /probe HTTP/1.1\r\nHost: supaterm-mbp.tail1234.ts.net\r\n\r\n",
      );
    });
    socket.on("data", () => Deferred.doneUnsafe(responded, Effect.void));
    socket.on("close", () => Deferred.doneUnsafe(closed, Effect.void));
    socket.on("error", () => undefined);
    yield* Effect.addFinalizer(() => Effect.sync(() => socket.destroy()));
    yield* Deferred.await(responded);
    return closed;
  });

it.live("drops open connections from callers the admission now refuses", () =>
  Effect.gen(function* () {
    const { address, secret, disconnect } = yield* withIngress;
    const bob = yield* openConnection(address, "bob@example.com", secret);
    const alice = yield* openConnection(address, "alice@example.com", secret);
    disconnect((peer) => peer.identity?.login === "bob@example.com");
    yield* Deferred.await(bob);
    expect(yield* Deferred.isDone(alice)).toBe(false);
  }).pipe(Effect.scoped),
);
