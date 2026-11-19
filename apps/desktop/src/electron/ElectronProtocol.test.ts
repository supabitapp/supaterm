import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ElectronProtocol from "./ElectronProtocol.ts";

type Handler = (request: Request) => Promise<Response>;

function makeNative() {
  const state: { handler: Handler | undefined } = { handler: undefined };
  const handled: Array<string> = [];
  const unhandled: Array<string> = [];
  const fetches: Array<[string, RequestInit]> = [];
  const native: ElectronProtocol.ElectronProtocolNative = {
    handle: (scheme, handler) => {
      handled.push(scheme);
      state.handler = handler;
    },
    unhandle: (scheme) => {
      unhandled.push(scheme);
    },
    fetch: async (url, init) => {
      fetches.push([url, init]);
      return new Response("ok");
    },
  };
  const layer = Layer.effect(
    ElectronProtocol.ElectronProtocol,
    ElectronProtocol.makeWith(native),
  ).pipe(Layer.provide(NodeServices.layer));
  const handler: Handler = (request) => {
    if (!state.handler) throw new Error("protocol handler was not registered");
    return state.handler(request);
  };
  return { layer, handler, handled, unhandled, fetches };
}

describe("ElectronProtocol", () => {
  it.effect("serves the bundled client from disk without a backend", () => {
    const fake = makeNative();
    const handler = fake.handler;
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(`${directory}/index.html`, "<html>app</html>");
      yield* fileSystem.writeFileString(`${directory}/app.js`, "export default 1;");
      const protocol = yield* ElectronProtocol.ElectronProtocol;
      yield* protocol.registerDesktopProtocol({
        scheme: "supaterm",
        assetDirectory: directory,
      });
      const request = (pathname: string, init?: RequestInit) =>
        Effect.promise(() => handler(new Request(`supaterm://app${pathname}`, init)));

      const page = yield* request("/settings/connections");
      assert.equal(yield* Effect.promise(() => page.text()), "<html>app</html>");
      assert.include(page.headers.get("content-security-policy") ?? "", "default-src 'self'");
      const dottedRoute = yield* request("/environment/thread.with.dots", {
        headers: { accept: "text/html" },
      });
      assert.equal(yield* Effect.promise(() => dottedRoute.text()), "<html>app</html>");

      const script = yield* request("/app.js?v=1");
      assert.equal(yield* Effect.promise(() => script.text()), "export default 1;");
      assert.include(script.headers.get("content-type") ?? "", "javascript");

      assert.equal((yield* request("/missing.js")).status, 404);
      assert.equal((yield* request("/%2e%2e%2fsecret.txt")).status, 404);
      assert.equal((yield* request("/%invalid")).status, 400);
      assert.equal((yield* request("/", { method: "POST" })).status, 405);
      assert.equal(fake.fetches.length, 0);
    }).pipe(Effect.provide(Layer.merge(fake.layer, NodeServices.layer)));
  });

  it.effect("proxies the stable renderer origin to the current app server", () => {
    const fake = makeNative();
    const handler = fake.handler;
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "supaterm-dev",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
          });

          const response = yield* Effect.promise(() =>
            handler(
              new Request("supaterm-dev://app/api/health?verbose=1", {
                headers: {
                  accept: "application/json",
                  origin: "supaterm-dev://app",
                  referer: "supaterm-dev://app/",
                  "sec-fetch-site": "same-origin",
                },
              }),
            ),
          );
          assert.equal(yield* Effect.promise(() => response.text()), "ok");
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "connect-src 'self' blob: http: https: ws: wss:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "img-src 'self' supaterm-dev: blob: data: http: https:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "font-src 'self' supaterm-dev: data:",
          );
        }),
      );

      assert.deepEqual(fake.handled, ["supaterm-dev"]);
      assert.equal(fake.fetches[0]?.[0], "http://127.0.0.1:3773/api/health?verbose=1");
      const forwardedHeaders = new Headers(fake.fetches[0]?.[1].headers);
      assert.equal(forwardedHeaders.get("accept"), "application/json");
      assert.isNull(forwardedHeaders.get("origin"));
      assert.isNull(forwardedHeaders.get("referer"));
      assert.isNull(forwardedHeaders.get("sec-fetch-site"));
      assert.deepEqual(fake.unhandled, ["supaterm-dev"]);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("keeps proxied paths on the configured server", () => {
    const fake = makeNative();
    const handler = fake.handler;
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "supaterm-dev",
            targetOrigin: new URL("http://127.0.0.1:5733/"),
          });
          yield* Effect.promise(() =>
            handler(new Request("supaterm-dev://app//example.com/src/main.tsx?t=1")),
          );
          yield* Effect.promise(() => handler(new Request("supaterm-dev://app/\\example.com/")));
        }),
      );

      assert.deepEqual(
        fake.fetches.map((call) => call[0]),
        [
          "http://127.0.0.1:5733//example.com/src/main.tsx?t=1",
          "http://127.0.0.1:5733//example.com/",
        ],
      );
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("rejects custom protocol requests for another host", () => {
    const fake = makeNative();
    const handler = fake.handler;
    return Effect.gen(function* () {
      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "supaterm",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
          });
          return yield* Effect.promise(() => handler(new Request("supaterm://other/")));
        }),
      );

      assert.equal(response.status, 404);
      assert.equal(fake.fetches.length, 0);
    }).pipe(Effect.provide(fake.layer));
  });
});
