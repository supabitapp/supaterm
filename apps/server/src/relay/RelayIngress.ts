// @effect-diagnostics nodeBuiltinImport:off - identifies the synthetic Node HTTP socket.
import type * as NodeHttp from "node:http";
import type { TunnelStream } from "@supaterm/shared/relay/tunnel";
import { type TunnelPeer, TunnelSocket } from "@supaterm/shared/relay/tunnelNode";
import * as Context from "effect/Context";
import * as Cookies from "effect/http/Cookies";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

export class RelayIngress extends Context.Service<
  RelayIngress,
  {
    readonly accept: (stream: TunnelStream, peer: TunnelPeer) => void;
  }
>()("supaterm/relay/RelayIngress") {}

export const layerFromServer = (server: NodeHttp.Server) =>
  Layer.succeed(
    RelayIngress,
    RelayIngress.of({
      accept: (stream, peer) => {
        server.emit("connection", new TunnelSocket(stream, peer));
      },
    }),
  );

const tunnelTransport = (request: HttpServerRequest.HttpServerRequest) =>
  request.source instanceof Object &&
  "socket" in request.source &&
  request.source.socket instanceof TunnelSocket
    ? request.source.socket.transport
    : undefined;

export const tunnelConnectionMethod = (request: HttpServerRequest.HttpServerRequest) => {
  switch (tunnelTransport(request)) {
    case "relay":
      return "relay" as const;
    case "direct":
      return "direct-tunnel" as const;
    case undefined:
      return undefined;
  }
};

export const isRelayPath = (pathname: string) =>
  pathname === "/ws" ||
  pathname === "/mcp" ||
  pathname === "/oauth/mcp/register" ||
  pathname === "/oauth/mcp/decision" ||
  pathname === "/oauth/mcp/token" ||
  pathname.startsWith("/api/") ||
  pathname === "/oauth/token" ||
  pathname === "/.well-known/supaterm/environment";

// Browsers attach cookies by host, not port, so a cookie inside a tunnel can
// belong to any other local server. Tunneled requests carry their own Bearer
// credentials, and cookies neither authenticate them nor come back.
export const layerPathGuard = HttpRouter.middleware(
  (app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (tunnelTransport(request) === undefined) return yield* app;
      if (!isRelayPath(new URL(request.url, "http://relay").pathname))
        return HttpServerResponse.empty({ status: 404 });
      return (yield* app.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          request.modify({ headers: Headers.remove(request.headers, "cookie") }),
        ),
      )).pipe(
        HttpServerResponse.removeHeader("set-cookie"),
        HttpServerResponse.updateCookies(() => Cookies.empty),
      );
    }),
  { global: true },
);
