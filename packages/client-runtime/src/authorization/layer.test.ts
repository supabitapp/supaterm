import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  type ExecutionEnvironmentDescriptor,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { layerRemoteHttpClient } from "../rpc/http.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "./service.ts";
import { BearerConnectionCredential, BearerConnectionProfile } from "../connection/catalog.ts";
import * as ConnectionCredentialStore from "../connection/credentialStore.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import * as ConnectionProfileStore from "../connection/profileStore.ts";
import * as ConnectionResolver from "../connection/resolver.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
};
const DESCRIPTOR = {
  environmentId: ENVIRONMENT_ID,
  label: "Remote environment",
  platform: {
    os: "linux",
    arch: "x64",
  },
  serverVersion: "0.0.0-test",
  orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
  capabilities: {},
};

type RecordedResponse = Response | ((init: RequestInit) => Response | Promise<Response>);

function recordedFetch(responses: ReadonlyArray<RecordedResponse>) {
  const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    return response === undefined
      ? Promise.reject(new Error(`Unexpected fetch call to ${String(input)}`))
      : Promise.resolve(typeof response === "function" ? response(init ?? {}) : response);
  }) satisfies typeof fetch;
  return { calls, fetchFn };
}

const websocketTicket = (ticket: string) =>
  Response.json({
    ticket,
    expiresAt: "2026-06-06T01:00:00.000Z",
  });

const presentation = Layer.succeed(
  ClientCapabilities.ClientPresentation,
  ClientCapabilities.ClientPresentation.of({
    metadata: {
      label: "Supaterm Test",
      deviceType: "mobile",
      os: "test",
    },
  }),
);

function makeHarness(responses: ReadonlyArray<RecordedResponse>) {
  const fetch = recordedFetch(responses);
  const layer = RemoteEnvironmentAuthorization.layer.pipe(
    Layer.provide(Layer.mergeAll(layerRemoteHttpClient(fetch.fetchFn), presentation)),
  );
  return { layer, fetch };
}

const prepareDirectBearer = Effect.fn("TestRemoteAuthorization.prepareDirectBearer")(function* (
  harness: ReturnType<typeof makeHarness>,
) {
  const target = new BearerConnectionTarget({
    environmentId: ENVIRONMENT_ID,
    label: DESCRIPTOR.label,
    connectionId: "direct-1",
  });
  const entry = {
    target,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: target.connectionId,
        environmentId: ENVIRONMENT_ID,
        label: target.label,
        httpBaseUrl: ENDPOINT.httpBaseUrl,
        wsBaseUrl: ENDPOINT.wsBaseUrl,
      }),
    ),
    enabled: true,
  };
  const unused = () => Effect.die("unused");
  const layer = ConnectionResolver.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        harness.layer,
        presentation,
        layerRemoteHttpClient(harness.fetch.fetchFn),
        Layer.succeed(ConnectionProfileStore.ConnectionProfileStore, {
          get: unused,
          put: unused,
          remove: unused,
        }),
        Layer.succeed(ConnectionCredentialStore.ConnectionCredentialStore, {
          get: () => Effect.succeedSome(new BearerConnectionCredential({ token: "bearer-token" })),
          put: unused,
          remove: unused,
        }),
        Layer.succeed(ClientCapabilities.PrimaryEnvironmentAuth, {
          bearerToken: Effect.succeedNone,
        }),
        Layer.succeed(ClientCapabilities.SshEnvironmentGateway, {
          provision: unused,
          prepare: unused,
          disconnect: unused,
        }),
      ),
    ),
  );
  const resolver = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(layer));
  return yield* resolver.prepare(entry);
});

describe("RemoteEnvironmentAuthorization", () => {
  it.effect("prepares a cold direct bearer connection with one descriptor request", () =>
    Effect.gen(function* () {
      const harness = makeHarness([Response.json(DESCRIPTOR), websocketTicket("cold-ticket")]);

      const prepared = yield* prepareDirectBearer(harness);

      expect(prepared.socketUrl).toContain("wsTicket=cold-ticket");
      expect(harness.fetch.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        "/.well-known/supaterm/environment",
        "/api/auth/websocket-ticket/rpc",
      ]);
    }),
  );

  it.effect("reuses a matching descriptor a check just read, once, while fresh", () =>
    Effect.gen(function* () {
      const descriptor = DESCRIPTOR as ExecutionEnvironmentDescriptor;
      const harness = makeHarness([
        websocketTicket("reused"),
        ...Array.from({ length: 4 }, () => [
          Response.json(descriptor),
          websocketTicket("fresh"),
        ]).flat(),
        websocketTicket("reused over plain HTTP"),
        Response.json(descriptor),
        websocketTicket("fresh"),
      ]);

      yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorizeAt = (httpBaseUrl: string) =>
          remote.authorizeBearer({
            expectedEnvironmentId: ENVIRONMENT_ID,
            httpBaseUrl,
            wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
            bearerToken: "bearer-token",
            connectionMethod: "direct",
          });
        const authorize = authorizeAt(ENDPOINT.httpBaseUrl);
        const remember = (value: Option.Option<ExecutionEnvironmentDescriptor>) =>
          remote.rememberCheckedDescriptor(ENDPOINT.httpBaseUrl, value, true);

        yield* remember(Option.some(descriptor));
        yield* authorize;
        yield* authorize;
        yield* remember(Option.some(descriptor));
        yield* TestClock.adjust("6 seconds");
        yield* authorize;
        yield* remember(Option.some({ ...descriptor, environmentId: "other" as never }));
        yield* authorize;
        yield* remember(Option.some(descriptor));
        yield* remember(Option.none());
        yield* authorize;
        yield* remote.rememberCheckedDescriptor(
          "http://127.0.0.1:3773",
          Option.some(descriptor),
          true,
        );
        yield* authorizeAt("http://127.0.0.1:3773");
        yield* remote.rememberCheckedDescriptor(
          "http://192.168.1.2:3773",
          Option.some(descriptor),
          false,
        );
        yield* authorizeAt("http://192.168.1.2:3773");
      }).pipe(Effect.provide(harness.layer));

      expect(harness.fetch.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        "/api/auth/websocket-ticket/rpc",
        ...Array.from({ length: 4 }, () => [
          "/.well-known/supaterm/environment",
          "/api/auth/websocket-ticket/rpc",
        ]).flat(),
        "/api/auth/websocket-ticket/rpc",
        "/.well-known/supaterm/environment",
        "/api/auth/websocket-ticket/rpc",
      ]);
    }),
  );

  it.effect("gives up on a silent loopback or LAN address sooner than on a remote one", () =>
    Effect.gen(function* () {
      const silent = () => new Promise<Response>(() => {});
      const harness = makeHarness([silent, silent, silent]);

      yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorizeAt = (httpBaseUrl: string, connectionMethod: "direct" | "ssh" = "direct") =>
          remote
            .authorizeBearer({
              expectedEnvironmentId: ENVIRONMENT_ID,
              httpBaseUrl,
              wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
              bearerToken: "bearer-token",
              connectionMethod,
            })
            .pipe(Effect.flip, Effect.forkChild);
        const lan = yield* authorizeAt("http://192.168.1.2:3773");
        const tailnet = yield* authorizeAt("http://100.101.102.103:3773");
        const forwarded = yield* authorizeAt("http://127.0.0.1:4010", "ssh");

        yield* TestClock.adjust("3 seconds");
        expect(lan.pollUnsafe()).toBeDefined();
        expect(tailnet.pollUnsafe()).toBeUndefined();
        expect(forwarded.pollUnsafe()).toBeUndefined();
        expect(yield* Fiber.join(lan)).toMatchObject({
          _tag: "ConnectionTransientError",
          reason: "timeout",
        });

        yield* TestClock.adjust("7 seconds");
        expect(tailnet.pollUnsafe()).toBeDefined();
        expect(forwarded.pollUnsafe()).toBeDefined();
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("checks a changed route before sending the paired credential", () =>
    Effect.gen(function* () {
      const lanUrl = "http://192.168.1.20:4389";
      const harness = makeHarness([
        Response.json(DESCRIPTOR),
        websocketTicket("paired-ticket"),
        Response.json({ ...DESCRIPTOR, environmentId: "another-environment" }),
      ]);
      const failure = yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const input = {
          expectedEnvironmentId: ENVIRONMENT_ID,
          ...ENDPOINT,
          bearerToken: "paired-token",
          connectionMethod: "direct" as const,
        };
        yield* remote.authorizeBearer(input);
        return yield* remote
          .authorizeBearer({
            ...input,
            httpBaseUrl: lanUrl,
            wsBaseUrl: lanUrl.replace(/^http/, "ws"),
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(harness.layer));
      expect(failure).toMatchObject({ _tag: "ConnectionBlockedError", reason: "configuration" });
      expect(harness.fetch.calls).toHaveLength(3);
      const [url, init] = harness.fetch.calls[2]!;
      expect(String(url)).toBe(`${lanUrl}/.well-known/supaterm/environment`);
      expect(new Headers(init.headers).has("authorization")).toBe(false);
    }),
  );

  it.effect("validates a fresh bearer descriptor while issuing fresh websocket tickets", () =>
    Effect.gen(function* () {
      const harness = makeHarness([
        Response.json(DESCRIPTOR),
        websocketTicket("first-ticket"),
        Response.json(DESCRIPTOR),
        websocketTicket("second-ticket"),
      ]);

      const [first, second] = yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorize = () =>
          remote.authorizeBearer({
            expectedEnvironmentId: ENVIRONMENT_ID,
            httpBaseUrl: ENDPOINT.httpBaseUrl,
            wsBaseUrl: ENDPOINT.wsBaseUrl,
            bearerToken: "bearer-token",
            connectionMethod: "direct",
          });
        return [yield* authorize(), yield* authorize()] as const;
      }).pipe(Effect.provide(harness.layer));

      expect(first.socketUrl).toContain("wsTicket=first-ticket");
      expect(second.socketUrl).toContain("wsTicket=second-ticket");
      expect(
        harness.fetch.calls.filter(([url]) =>
          String(url).endsWith("/.well-known/supaterm/environment"),
        ),
      ).toHaveLength(2);
      expect(
        harness.fetch.calls.filter(([url]) =>
          String(url).endsWith("/api/auth/websocket-ticket/rpc"),
        ),
      ).toHaveLength(2);
    }),
  );
});
