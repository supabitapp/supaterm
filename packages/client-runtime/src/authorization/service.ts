import {
  type ClientConnectionMethod,
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
} from "@supaterm/contracts";
import { resolveRemoteWebSocketConnectionUrl } from "./remote.ts";
import { environmentMismatchError, mapRemoteEnvironmentError } from "../connection/errors.ts";
import type { ConnectionAttemptError, PreparedHttpAuthorization } from "../connection/model.ts";
import { isNearbyAddress } from "../connection/routes.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";

export interface AuthorizedRemoteEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly socketUrl: string;
  readonly httpAuthorization: PreparedHttpAuthorization;
  /** The descriptor this authorization validated, so the resolver need not fetch it again. */
  readonly descriptor?: ExecutionEnvironmentDescriptor;
}

export class RemoteEnvironmentAuthorization extends Context.Service<
  RemoteEnvironmentAuthorization,
  {
    readonly authorizeBearer: (input: {
      readonly expectedEnvironmentId: EnvironmentId;
      readonly httpBaseUrl: string;
      readonly wsBaseUrl: string;
      readonly bearerToken: string;
      readonly connectionMethod: ClientConnectionMethod;
    }) => Effect.Effect<AuthorizedRemoteEnvironment, ConnectionAttemptError>;
    /**
     * Lets the next direct authorization of this address skip its own descriptor
     * read. Kept only where the address reaches the same machine on every network.
     */
    readonly rememberCheckedDescriptor: (
      httpBaseUrl: string,
      descriptor: Option.Option<ExecutionEnvironmentDescriptor>,
      keepsItsHost: boolean,
    ) => Effect.Effect<void>;
  }
>()("@supaterm/client-runtime/authorization/service/RemoteEnvironmentAuthorization") {}

const CHECKED_DESCRIPTOR_TTL_NANOS = 5_000_000_000n;
// A loopback or LAN host answers well inside this, so a dead one frees its attempt sooner.
const NEARBY_DESCRIPTOR_TIMEOUT_MS = 3_000;

const fetchDescriptor = Effect.fn("clientRuntime.connection.remote.fetchDescriptor")(function* (
  httpBaseUrl: string,
  connectionMethod: ClientConnectionMethod,
  timeoutMs?: number,
) {
  return yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }).pipe(Effect.mapError((error) => mapRemoteEnvironmentError(error, connectionMethod)));
});

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  // A route or host check hands its descriptor to the connect it leads to, once,
  // so the connect skips a round trip. Only over HTTPS or loopback: any other
  // plain http address can belong to another machine after a network change.
  const checkedDescriptors = new Map<
    string,
    { readonly descriptor: ExecutionEnvironmentDescriptor; readonly at: bigint }
  >();

  const authorizeBearer = Effect.fn("clientRuntime.connection.remote.authorizeBearer")(
    function* (input: {
      readonly expectedEnvironmentId: Parameters<
        RemoteEnvironmentAuthorization["Service"]["authorizeBearer"]
      >[0]["expectedEnvironmentId"];
      readonly httpBaseUrl: string;
      readonly wsBaseUrl: string;
      readonly bearerToken: string;
      readonly connectionMethod: ClientConnectionMethod;
    }) {
      // Read on every prepare unless a check just read it: a saved address can belong to
      // another machine by now. A remembered mismatch still reads again, so a host that
      // answers for the right environment a moment later is not blocked.
      const checked = checkedDescriptors.get(input.httpBaseUrl);
      checkedDescriptors.delete(input.httpBaseUrl);
      const descriptor =
        checked !== undefined &&
        checked.descriptor.environmentId === input.expectedEnvironmentId &&
        (yield* Clock.monotonicTimeNanos) - checked.at <= CHECKED_DESCRIPTOR_TTL_NANOS
          ? checked.descriptor
          : yield* fetchDescriptor(
              input.httpBaseUrl,
              input.connectionMethod,
              // An SSH forward listens on loopback but reaches a remote host.
              input.connectionMethod === "direct" && isNearbyAddress(input.httpBaseUrl)
                ? NEARBY_DESCRIPTOR_TIMEOUT_MS
                : undefined,
            ).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
      if (descriptor.environmentId !== input.expectedEnvironmentId) {
        return yield* environmentMismatchError({
          expected: input.expectedEnvironmentId,
          actual: descriptor.environmentId,
        });
      }
      const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: input.wsBaseUrl,
        httpBaseUrl: input.httpBaseUrl,
        bearerToken: input.bearerToken,
      }).pipe(
        Effect.mapError((error) => mapRemoteEnvironmentError(error, input.connectionMethod)),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      return {
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        httpBaseUrl: input.httpBaseUrl,
        socketUrl,
        descriptor,
        httpAuthorization: {
          _tag: "Bearer" as const,
          token: input.bearerToken,
        },
      };
    },
  );

  return RemoteEnvironmentAuthorization.of({
    authorizeBearer,
    // Untraced: it runs on every route and host check.
    rememberCheckedDescriptor: Effect.fnUntraced(function* (httpBaseUrl, descriptor, keepsItsHost) {
      if (Option.isNone(descriptor) || !keepsItsHost) {
        checkedDescriptors.delete(httpBaseUrl);
        return;
      }
      checkedDescriptors.set(httpBaseUrl, {
        descriptor: descriptor.value,
        at: yield* Clock.monotonicTimeNanos,
      });
    }),
  });
});

export const layer = Layer.effect(RemoteEnvironmentAuthorization, make);
