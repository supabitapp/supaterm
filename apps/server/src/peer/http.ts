import { EnvironmentHttpApi } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentOperationForbidden,
} from "../auth/http.ts";
import * as PeerClientPairing from "./PeerClientPairing.ts";

// The response is a credential.
const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeaders(response, { "cache-control": "no-store", pragma: "no-cache" }),
  ),
);

/**
 * A link session is accepted on `/mcp` and here, nowhere else. This is a route and not an MCP
 * tool so that no agent's tool list can hold it: thread credentials never authenticate here.
 */
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "peerLink",
  Effect.fnUntraced(function* (handlers) {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const issuer = yield* PeerClientPairing.PeerClientPairingIssuer;
    return handlers.handle(
      "clientPairing",
      Effect.fn("environment.peerLink.clientPairing")(function* (args) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        yield* noStore;
        // A browser never holds a link's token; refuse one before reading credentials, as `/mcp` does.
        if (request.headers.origin !== undefined) {
          return yield* failEnvironmentOperationForbidden("browser_request_not_allowed");
        }
        const caller = yield* auth.authenticateMcpClient(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, () =>
            failEnvironmentInternal("internal_error"),
          ),
        );
        return yield* issuer.issue(caller, args.payload).pipe(
          Effect.catchTags({
            PeerClientPairingRefused: () =>
              failEnvironmentOperationForbidden("link_client_pairing_refused"),
          }),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (cause) =>
            failEnvironmentInternal("pairing_credential_issuance_failed", cause),
          ),
        );
      }),
    );
  }),
);
