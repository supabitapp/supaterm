import {
  AuthAccessWriteScope,
  AuthSessionId,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
  RelayPreparationError,
} from "@supaterm/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiTest from "effect/http-api/HttpApiTest";
import * as RelayAccess from "./RelayAccess.ts";
import * as RelayHttp from "./RelayHttp.ts";

const relayInfo = { relayEndpoint: "https://relay.invalid/", relayUrl: "wss://relay.invalid" };
const layerAuth = (allowed: boolean) =>
  Layer.succeed(EnvironmentAuthenticatedAuth, (next) =>
    Effect.provideService(next, EnvironmentAuthenticatedPrincipal, {
      sessionId: AuthSessionId.make("relay-test-session"),
      subject: "relay-test",
      method: "bearer-access-token",
      scopes: new Set(allowed ? [AuthAccessWriteScope] : []),
    }),
  );
const makeClient = HttpApiTest.groups(EnvironmentHttpApi, ["relay"]);

it.effect("authorizes preparation before activating and returns the ready relay address", () =>
  Effect.gen(function* () {
    let activations = 0;
    const relay = Layer.mock(RelayAccess.RelayAccess, {
      prepare: Effect.sync(() => {
        activations++;
        return relayInfo;
      }),
    });
    const run = (allowed: boolean) =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        return yield* client.relay.prepare({ headers: {} }).pipe(Effect.result);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RelayHttp.layer.pipe(Layer.provide(relay), Layer.provideMerge(layerAuth(allowed))),
            HttpServer.layerServices,
          ),
        ),
      );
    const denied = yield* run(false);
    expect(denied).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "EnvironmentScopeRequiredError", requiredScope: AuthAccessWriteScope },
    });
    expect(activations).toBe(0);
    const allowed = yield* run(true);
    expect(allowed).toMatchObject({ _tag: "Success", success: relayInfo });
    expect(activations).toBe(1);
  }),
);

it.effect("returns a typed preparation failure for an unavailable relay", () =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const failure = yield* client.relay.prepare({ headers: {} }).pipe(Effect.flip);
    expect(failure).toMatchObject({ _tag: "RelayPreparationError", reason: "timeout" });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        RelayHttp.layer.pipe(
          Layer.provide(
            Layer.mock(RelayAccess.RelayAccess, {
              prepare: Effect.fail(new RelayPreparationError({ reason: "timeout" })),
            }),
          ),
          Layer.provideMerge(layerAuth(true)),
        ),
        HttpServer.layerServices,
      ),
    ),
  ),
);
