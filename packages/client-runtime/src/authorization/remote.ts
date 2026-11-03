import {
  AuthAccessTokenType,
  type AuthClientPresentationMetadata,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  type AuthEnvironmentScope,
  type AuthWebSocketTicketResult,
  type AuthWebSocketTicketUse,
} from "@supaterm/contracts";
import { encodeOAuthScope } from "@supaterm/shared/oauthScope";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";

export { RemoteEnvironmentAuthUndeclaredStatusError } from "../rpc/http.ts";
export type RemoteEnvironmentAuthError = RemoteEnvironmentRequestError;

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

const clientMetadataTokenExchangeFields = (
  clientMetadata: AuthClientPresentationMetadata | undefined,
) => {
  const displayOs = clientMetadata?.os;
  return {
    ...(clientMetadata?.label ? { client_label: clientMetadata.label } : {}),
    ...(clientMetadata?.deviceType ? { client_device_type: clientMetadata.deviceType } : {}),
    ...(displayOs && displayOs !== "unknown" && displayOs !== "other"
      ? { client_os: displayOs }
      : {}),
  };
};

export const bootstrapRemoteBearerSession = Effect.fn(
  "clientRuntime.authorization.bootstrapRemoteBearerSession",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly credential: string;
  readonly scopes?: ReadonlyArray<AuthEnvironmentScope>;
  readonly clientMetadata?: AuthClientPresentationMetadata;
  readonly timeoutMs?: number;
}) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/oauth/token"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.token({
      payload: {
        grant_type: AuthTokenExchangeGrantType,
        subject_token: input.credential,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
        ...(input.scopes ? { scope: encodeOAuthScope(input.scopes) } : {}),
        ...clientMetadataTokenExchangeFields(input.clientMetadata),
      },
    }),
  );
});

export const fetchRemoteSessionState = Effect.fn(
  "clientRuntime.authorization.fetchRemoteSessionState",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly timeoutMs?: number;
}) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/session"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.session({
      headers: {
        authorization: `Bearer ${input.bearerToken}`,
      },
    }),
  );
});

const webSocketTicketPath = (use: AuthWebSocketTicketUse | undefined) =>
  use === undefined ? "/api/auth/websocket-ticket" : `/api/auth/websocket-ticket/${use}`;

/**
 * A server that predates ticket audiences has no `/:use` route and answers 404.
 * Its tickets are the unbound kind it always issued, so the bare path is the
 * right request there, not an error.
 */
export const issueWebSocketTicketWithFallback = <E, R>(
  use: AuthWebSocketTicketUse | undefined,
  issue: (
    use: AuthWebSocketTicketUse | undefined,
  ) => Effect.Effect<AuthWebSocketTicketResult, E, R>,
) =>
  use === undefined
    ? issue(use)
    : issue(use).pipe(
        Effect.catchIf(
          (error) =>
            error instanceof RemoteEnvironmentAuthUndeclaredStatusError && error.status === 404,
          () => issue(undefined),
        ),
      );

export const issueRemoteWebSocketTicket = Effect.fn(
  "clientRuntime.authorization.issueRemoteWebSocketTicket",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly use?: AuthWebSocketTicketUse;
  readonly timeoutMs?: number;
}) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  const headers = { authorization: `Bearer ${input.bearerToken}` };
  return yield* issueWebSocketTicketWithFallback(input.use, (use) =>
    executeEnvironmentHttpRequest(
      environmentEndpointUrl(input.httpBaseUrl, webSocketTicketPath(use)),
      input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
      use === undefined
        ? client.webSocketTicket({ headers })
        : client.webSocketTicketFor({ headers, params: { use } }),
    ),
  );
});

function rpcSocketUrl(wsBaseUrl: string): URL {
  const url = new URL(wsBaseUrl);
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/ws";
  }
  return url;
}

export const resolveRemoteWebSocketConnectionUrl = Effect.fn(
  "clientRuntime.authorization.resolveRemoteWebSocketConnectionUrl",
)(function* (input: {
  readonly wsBaseUrl: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly timeoutMs?: number;
}) {
  const issued = yield* issueRemoteWebSocketTicket({
    httpBaseUrl: input.httpBaseUrl,
    bearerToken: input.bearerToken,
    use: "rpc",
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });

  const url = rpcSocketUrl(input.wsBaseUrl);
  url.searchParams.set("wsTicket", Redacted.value(issued.ticket));
  return url.toString();
});
