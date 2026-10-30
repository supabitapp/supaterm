import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import {
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
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
    const issue = (media: boolean) =>
      executeAuthenticatedEnvironmentHttpRequest({
        prepared: input.prepared,
        group: "auth",
        url: (urls) =>
          media ? urls.webSocketTicketFor({ params: { use: "media" } }) : urls.webSocketTicket(),
        timeoutMs: TICKET_TIMEOUT_MS,
        request: ({ client, headers }) =>
          media
            ? client.webSocketTicketFor({ headers, params: { use: "media" } })
            : client.webSocketTicket({ headers }),
      });
    const ticket = yield* issue(true).pipe(
      Effect.catchIf(
        (error) =>
          error instanceof RemoteEnvironmentAuthUndeclaredStatusError && error.status === 404,
        () => issue(false),
      ),
    );
    return {
      httpBase,
      wsBase,
      query: { wsTicket: ticket.ticket },
      credentials: false,
    };
  },
);
