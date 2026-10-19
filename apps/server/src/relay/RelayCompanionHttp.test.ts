// @effect-diagnostics nodeBuiltinImport:off - verifies real browser control upgrades.
import * as NodeEvents from "node:events";
import * as NodeHttp from "node:http";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { RELAY_COMPANION_REQUEST_LIMIT } from "@supaterm/shared/relay/protocol";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { HttpClient, HttpRouter, HttpServer } from "effect/http";
import WebSocket from "ws";
import { RelayCompanion, RelayCompanionError } from "./RelayCompanion.ts";
import { layer } from "./RelayCompanionHttp.ts";

const platform = NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer));
const identity = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt`;
const address = `${identity}/`;
const foreignHostStatus = (origin: string) =>
  new Promise<number>((resolve, reject) => {
    NodeHttp.get(origin, { headers: { host: "evil.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    }).once("error", reject);
  });

const rejectedUpgrade = (url: string, origin?: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    socket.on("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
      socket.close();
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("An untrusted control upgrade was accepted"));
    });
  });

it.effect("serves the standalone shell while rejecting foreign Hosts and escaping symlinks", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const shell = `${root}/web`;
    yield* fs.makeDirectory(shell);
    yield* fs.writeFileString(
      `${shell}/index.html`,
      "<html><head></head><body>client</body></html>",
    );
    yield* fs.writeFileString(`${shell}/app.js`, "console.log('client')");
    yield* fs.writeFileString(`${root}/secret`, "private");
    yield* fs.symlink(`${root}/secret`, `${shell}/escape`);
    const services = yield* Layer.build(
      HttpRouter.serve(layer(shell), { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provide(platform),
        Layer.provide(Layer.mock(RelayCompanion, {})),
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const client = Context.get(services, HttpClient.HttpClient);
    const response = yield* client.get("/settings/connections");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(yield* response.text).toContain('name="supaterm-relay-companion"');
    expect((yield* client.get("/app.js")).status).toBe(200);
    expect((yield* client.get("/escape")).status).toBe(404);
    const server = Context.get(services, HttpServer.HttpServer);
    expect(
      yield* Effect.promise(() => foreignHostStatus(HttpServer.formatAddress(server.address))),
    ).toBe(421);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const serveCompanion = (root: string, service: Layer.Layer<RelayCompanion>) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(
      HttpRouter.serve(layer(root), { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provide(platform),
        Layer.provide(service),
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    if (!("port" in server.address)) throw new Error("No companion listener");
    const origin = `http://127.0.0.1:${server.address.port}`;
    return { origin, url: origin.replace(/^http/, "ws") + "/__relay/control" };
  });

it.effect.each(["ready", "preparing-close", "preparing-terminate", "preparing-overflow"] as const)(
  "requires the companion origin and ends the tab's session on disconnect while %s",
  (state) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const released = yield* Deferred.make<void>();
      const started = yield* Deferred.make<string>();
      const interrupted = yield* Deferred.make<void>();
      const service = Layer.mock(RelayCompanion, {
        session: Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined));
          return {
            open: (address: string) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, address);
                if (state !== "ready")
                  return yield* Effect.never.pipe(
                    Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                  );
                return "http://127.0.0.1:4321";
              }),
            close: () => Effect.void,
          };
        }),
      });
      const { origin, url } = yield* serveCompanion(root, service);
      expect(yield* Effect.promise(() => rejectedUpgrade(url))).toBe(403);
      expect(yield* Effect.promise(() => rejectedUpgrade(url, "https://evil.example"))).toBe(403);
      const socket = new WebSocket(url, { origin });
      yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));
      yield* Effect.promise(() => NodeEvents.EventEmitter.once(socket, "open"));
      const reply = NodeEvents.EventEmitter.once(socket, "message");
      socket.send(JSON.stringify({ id: "1", action: "open", address }));
      expect(yield* Deferred.await(started)).toBe(address);
      if (state === "ready") {
        expect(JSON.parse(String((yield* Effect.promise(() => reply))[0]))).toEqual({
          id: "1",
          origin: "http://127.0.0.1:4321",
        });
        socket.close();
      } else if (state === "preparing-close") {
        socket.close();
      } else if (state === "preparing-terminate") {
        socket.terminate();
      } else {
        for (let id = 2; id < RELAY_COMPANION_REQUEST_LIMIT * 2 + 3; id++)
          socket.send(JSON.stringify({ id: String(id), action: "open", address }));
      }
      if (state !== "ready") yield* Deferred.await(interrupted);
      yield* Deferred.await(released);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("answers failed opens and drops a tab that sends malformed control messages", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const released = yield* Deferred.make<void>();
    const failedIdentity = `https://${"55".repeat(16)}.${"66".repeat(16)}.relay.supaterm.alt`;
    const service = Layer.mock(RelayCompanion, {
      session: Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined));
        return {
          open: (address: string, relayUrl?: string) =>
            address === failedIdentity
              ? Effect.fail(new RelayCompanionError({ operation: "open", cause: "Bind failed" }))
              : Effect.succeed(`http://127.0.0.1:4321/${relayUrl ?? "default"}`),
          close: () => Effect.void,
        };
      }),
    });
    const { origin, url } = yield* serveCompanion(root, service);
    const socket = new WebSocket(url, { origin });
    yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));
    yield* Effect.promise(() => NodeEvents.EventEmitter.once(socket, "open"));
    const exchange = (request: object) => {
      const reply = NodeEvents.EventEmitter.once(socket, "message");
      socket.send(JSON.stringify(request));
      return Effect.promise(() => reply).pipe(Effect.map(([data]) => JSON.parse(String(data))));
    };
    expect(yield* exchange({ id: "1", action: "open", address: failedIdentity })).toEqual({
      id: "1",
      error: "The relay endpoint could not be prepared.",
    });
    expect(
      yield* exchange({ id: "2", action: "open", address, relayUrl: "wss://relay.example" }),
    ).toEqual({ id: "2", origin: "http://127.0.0.1:4321/wss://relay.example" });
    const closed = NodeEvents.EventEmitter.once(socket, "close");
    socket.send("x".repeat(5000));
    yield* Effect.promise(() => closed);
    yield* Deferred.await(released);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
