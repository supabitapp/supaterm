import {
  AuthAccessTokenType,
  type AuthClientPresentationMetadata,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  type ClientConnectionMethod,
  type AuthEnvironmentScope,
} from "@supaterm/contracts";
import { encodeOAuthScope } from "@supaterm/shared/oauthScope";
import { hashTelemetryId } from "@supaterm/shared/telemetryId";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";

export {
  RemoteEnvironmentAuthInvalidJsonError,
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
} from "../rpc/http.ts";
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

export const readClientDeviceHash = Effect.gen(function* () {
  const device = yield* (yield* ClientCapabilities.AnalyticsDevice).id;
  return Option.isSome(device) ? hashTelemetryId(device.value) : undefined;
});

export const appendClientConnectionParams = (
  url: URL,
  clientMetadata: AuthClientPresentationMetadata | undefined,
  connectionMethod?: ClientConnectionMethod,
  clientDeviceHash?: string,
): void => {
  if (clientMetadata?.surface) {
    url.searchParams.set("clientSurface", clientMetadata.surface);
  }
  if (clientMetadata?.appVersion) {
    url.searchParams.set("clientAppVersion", clientMetadata.appVersion);
  }
  if (clientMetadata?.deviceType) {
    const deviceType =
      clientMetadata.deviceType === "mobile"
        ? "phone"
        : clientMetadata.deviceType === "desktop" || clientMetadata.deviceType === "tablet"
          ? clientMetadata.deviceType
          : "unknown";
    url.searchParams.set("clientDeviceType", deviceType);
  }
  if (clientMetadata?.os) {
    url.searchParams.set("clientOs", clientMetadata.os);
  }
  if (clientMetadata?.surface === "web") {
    if (clientMetadata.webDeployment) {
      url.searchParams.set("clientWebDeployment", clientMetadata.webDeployment);
    }
    if (clientMetadata.browser) {
      url.searchParams.set("clientBrowser", clientMetadata.browser);
    }
  }
  if (clientMetadata?.surface === "mobile") {
    if (clientMetadata.osMajorVersion !== undefined) {
      url.searchParams.set("clientOsMajorVersion", String(clientMetadata.osMajorVersion));
    }
    if (clientMetadata.deviceModel) {
      url.searchParams.set("clientDeviceModel", clientMetadata.deviceModel);
    }
  }
  if (connectionMethod) {
    url.searchParams.set("connectionMethod", connectionMethod);
  }
  if (clientDeviceHash) {
    url.searchParams.set("clientDevice", clientDeviceHash);
  }
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

export const issueRemoteWebSocketTicket = Effect.fn(
  "clientRuntime.authorization.issueRemoteWebSocketTicket",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly timeoutMs?: number;
}) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/websocket-ticket"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.webSocketTicket({
      headers: {
        authorization: `Bearer ${input.bearerToken}`,
      },
    }),
  );
});

export const resolveRemoteWebSocketConnectionUrl = Effect.fn(
  "clientRuntime.authorization.resolveRemoteWebSocketConnectionUrl",
)(function* (input: {
  readonly wsBaseUrl: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly clientMetadata?: AuthClientPresentationMetadata;
  readonly connectionMethod?: ClientConnectionMethod;
  readonly timeoutMs?: number;
}) {
  const issued = yield* issueRemoteWebSocketTicket({
    httpBaseUrl: input.httpBaseUrl,
    bearerToken: input.bearerToken,
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });

  const url = new URL(input.wsBaseUrl);
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/ws";
  }
  url.searchParams.set("wsTicket", issued.ticket);
  appendClientConnectionParams(
    url,
    input.clientMetadata,
    input.connectionMethod,
    yield* readClientDeviceHash,
  );
  return url.toString();
});
