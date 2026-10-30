/**
 * `<img>`, `EventSource`, and `WebSocket` cannot set bearer headers, so bearer
 * connections pass a media `wsTicket` to `/api/device-hub/*`. A ticket lasts five
 * minutes and covers everything a panel opens but not the RPC socket; fetch a
 * fresh one on each (re)connect. Cookie sessions send the cookie.
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
