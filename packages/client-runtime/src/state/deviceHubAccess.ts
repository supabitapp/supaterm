/**
 * Credentials for the Device panel's media requests.
 *
 * The panel reaches simulator streams through `/api/device-hub/*` on the
 * environment origin. `<img>`, `EventSource`, and `WebSocket` cannot set
 * bearer headers, so bearer connections mint a short-lived WebSocket ticket
 * and pass it as `wsTicket`, the same way the app's own `/ws` upgrade
 * authenticates. Cookie sessions send the cookie.
 *
 * A ticket lives five minutes server-side and is bound to the session and the
 * media routes, not to one request, so one ticket covers everything a panel
 * opens at once but cannot open the RPC socket.
 * Callers fetch a fresh one each time they (re)connect a stream.
 */
import type { AuthWebSocketTicketUse } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";

import { issueWebSocketTicketWithFallback } from "../authorization/remote.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import type { DeviceHubAccess } from "../device/hubAccess.ts";

export { type DeviceHubAccess, withDeviceHubQuery } from "../device/hubAccess.ts";

const TICKET_TIMEOUT_MS = 8_000;

export const resolveDeviceHubAccess = Effect.fn("clientRuntime.state.resolveDeviceHubAccess")(
  function* (input: {
    readonly prepared: PreparedConnection;
    readonly hubBasePath: string;
  }): Effect.fn.Return<DeviceHubAccess, RemoteEnvironmentRequestError, HttpClient.HttpClient> {
    const httpBase = environmentEndpointUrl(input.prepared.httpBaseUrl, input.hubBasePath);
    const wsBase = httpBase.replace(/^http/, "ws");
    if (input.prepared.httpAuthorization === null) {
      return { httpBase, wsBase, query: {}, credentials: true };
    }
    const mintTicket = (use: AuthWebSocketTicketUse | undefined) =>
      executeAuthenticatedEnvironmentHttpRequest({
        prepared: input.prepared,
        group: "auth",
        url: (urls) =>
          use === undefined ? urls.webSocketTicket() : urls.webSocketTicketFor({ params: { use } }),
        timeoutMs: TICKET_TIMEOUT_MS,
        request: ({ client, headers }) =>
          use === undefined
            ? client.webSocketTicket({ headers })
            : client.webSocketTicketFor({ headers, params: { use } }),
      });
    const ticket = yield* issueWebSocketTicketWithFallback("media", mintTicket);
    return {
      httpBase,
      wsBase,
      query: { wsTicket: ticket.ticket },
      credentials: false,
    };
  },
);
