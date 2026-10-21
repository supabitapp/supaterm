import {
  type ClientConnectionMethod,
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
} from "@supaterm/contracts";
import { resolveRemoteWebSocketConnectionUrl } from "./remote.ts";
import { environmentMismatchError, mapRemoteEnvironmentError } from "../connection/errors.ts";
import type { ConnectionAttemptError, PreparedHttpAuthorization } from "../connection/model.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/http/HttpClient";

export interface AuthorizedRemoteEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly socketUrl: string;
  readonly httpAuthorization: PreparedHttpAuthorization;
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
  }
>()("@supaterm/client-runtime/authorization/service/RemoteEnvironmentAuthorization") {}

const BEARER_DESCRIPTOR_CACHE_TTL_MS = 10_000;

const fetchDescriptor = Effect.fn("clientRuntime.connection.remote.fetchDescriptor")(function* (
  httpBaseUrl: string,
  connectionMethod: ClientConnectionMethod,
) {
  return yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
    Effect.mapError((error) => mapRemoteEnvironmentError(error, connectionMethod)),
  );
});

const make = Effect.gen(function* () {
  const presentation = yield* ClientCapabilities.ClientPresentation;
  const httpClient = yield* HttpClient.HttpClient;
  const bearerDescriptors = yield* Ref.make<
    ReadonlyMap<
      EnvironmentId,
      {
        readonly httpBaseUrl: string;
        readonly descriptor: ExecutionEnvironmentDescriptor;
        readonly validatedAtEpochMs: number;
      }
    >
  >(new Map());

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
      const now = yield* Clock.currentTimeMillis;
      const cachedDescriptor = (yield* Ref.get(bearerDescriptors)).get(input.expectedEnvironmentId);
      const canReuseDescriptor =
        cachedDescriptor?.httpBaseUrl === input.httpBaseUrl &&
        cachedDescriptor.validatedAtEpochMs + BEARER_DESCRIPTOR_CACHE_TTL_MS > now;
      const descriptor = canReuseDescriptor
        ? cachedDescriptor.descriptor
        : yield* fetchDescriptor(input.httpBaseUrl, input.connectionMethod).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
          );
      if (descriptor.environmentId !== input.expectedEnvironmentId) {
        return yield* environmentMismatchError({
          expected: input.expectedEnvironmentId,
          actual: descriptor.environmentId,
        });
      }
      if (!canReuseDescriptor) {
        yield* Ref.update(bearerDescriptors, (current) => {
          const next = new Map(current);
          next.set(input.expectedEnvironmentId, {
            httpBaseUrl: input.httpBaseUrl,
            descriptor,
            validatedAtEpochMs: now,
          });
          return next;
        });
      }
      const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: input.wsBaseUrl,
        httpBaseUrl: input.httpBaseUrl,
        bearerToken: input.bearerToken,
        clientMetadata: presentation.metadata,
        connectionMethod: input.connectionMethod,
      }).pipe(
        Effect.mapError((error) => mapRemoteEnvironmentError(error, input.connectionMethod)),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      return {
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        httpBaseUrl: input.httpBaseUrl,
        socketUrl,
        httpAuthorization: {
          _tag: "Bearer" as const,
          token: input.bearerToken,
        },
      };
    },
  );

  return RemoteEnvironmentAuthorization.of({ authorizeBearer });
});

export const layer = Layer.effect(RemoteEnvironmentAuthorization, make);
