import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as DirectTunnel from "./DirectTunnel.ts";

// The tunnel handshake proves the host and every request inside it carries its
// own credentials, so this upgrade has no session or Origin check of its own.
export const layer = HttpRouter.add(
  "GET",
  "/v1/connect",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const tunnel = yield* DirectTunnel.DirectTunnel;
    yield* tunnel.accept({
      endpointId: new URL(request.url, "http://host").searchParams.get("endpointId"),
      request: NodeHttpServerRequest.toIncomingMessage(request),
    });
    return HttpServerResponse.empty();
  }).pipe(
    Effect.catchTags({
      DirectTunnelNotFoundError: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
      DirectTunnelBusyError: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
      DirectTunnelIdentityError: () => Effect.succeed(HttpServerResponse.empty({ status: 500 })),
    }),
  ),
);
