import * as Effect from "effect/Effect";
import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient } from "effect/http";

import type { PreparedConnection, PreparedHttpAuthorization } from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  makeEnvironmentHttpApiUrlBuilder,
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthTimeoutError,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";

export interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
}

export function withOrchestrationProtocolHeader(
  headers: EnvironmentHttpAuthHeaders,
): EnvironmentHttpAuthHeaders & {
  readonly [ORCHESTRATION_PROTOCOL_HEADER]: typeof ORCHESTRATION_PROTOCOL_VERSION_TEXT;
};
export function withOrchestrationProtocolHeader(headers: EnvironmentHttpAuthHeaders) {
  return {
    ...headers,
    [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  } satisfies EnvironmentHttpAuthHeaders & {
    readonly [ORCHESTRATION_PROTOCOL_HEADER]: typeof ORCHESTRATION_PROTOCOL_VERSION_TEXT;
  };
}

const withEnvironmentCredentials = <A, E, R>(
  authorization: PreparedHttpAuthorization | null,
  request: Effect.Effect<A, E, R>,
) =>
  authorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;

const environmentAuthHeaders = (authorization: PreparedHttpAuthorization | null) =>
  authorization === null ? {} : { authorization: `Bearer ${authorization.token}` };

interface EnvironmentHttpRequestInput<
  Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1],
  A,
  E,
  R,
> {
  readonly url: (urls: ReturnType<typeof makeEnvironmentHttpApiUrlBuilder>[Group]) => string;
  readonly timeoutMs: number;
  readonly group: Group;
  readonly request: (input: {
    readonly client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>>;
    readonly headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>;
}

export const executeAuthenticatedEnvironmentHttpRequest: <
  Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1],
  A,
  E,
  R,
>(
  input: EnvironmentHttpRequestInput<Group, A, E, R> & { readonly prepared: PreparedConnection },
) => Effect.Effect<
  A,
  RemoteEnvironmentRequestError,
  Effect.Services<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>> | R
> = Effect.fn("clientRuntime.state.executeAuthenticatedEnvironmentHttpRequest")(function* <
  Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1],
  A,
  E,
  R,
>(input: EnvironmentHttpRequestInput<Group, A, E, R> & { readonly prepared: PreparedConnection }) {
  const { httpBaseUrl, httpAuthorization } = input.prepared;
  const requestUrl = input.url(makeEnvironmentHttpApiUrlBuilder(httpBaseUrl)[input.group]);
  return yield* Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiGroupClient(httpBaseUrl, input.group);
    return yield* executeEnvironmentHttpRequest(
      requestUrl,
      input.timeoutMs,
      withEnvironmentCredentials(
        httpAuthorization,
        input.request({ client, headers: environmentAuthHeaders(httpAuthorization) }),
      ),
    );
  }).pipe(
    Effect.timeoutOrElse({
      duration: input.timeoutMs,
      orElse: () => Effect.fail(new RemoteEnvironmentAuthTimeoutError(requestUrl, input.timeoutMs)),
    }),
  );
});

/** Sends the request with this client's own credentials on the supervised environment. */
export const executeConnectedEnvironmentHttpRequest = Effect.fn(
  "clientRuntime.state.executeConnectedEnvironmentHttpRequest",
)(function* <Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1], A, E, R>(
  input: EnvironmentHttpRequestInput<Group, A, E, R>,
) {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared)) {
    return yield* new RemoteEnvironmentAuthFetchError({
      message: "The environment is not connected.",
      cause: supervisor.target._tag,
    });
  }
  return yield* executeAuthenticatedEnvironmentHttpRequest({ ...input, prepared: prepared.value });
});
