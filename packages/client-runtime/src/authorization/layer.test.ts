import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerRemoteHttpClient } from "../rpc/http.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "./service.ts";

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

type RecordedResponse = Response | ((init: RequestInit) => Response);

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

function makeHarness(responses: ReadonlyArray<Response>) {
  const fetch = recordedFetch(responses);
  const layer = RemoteEnvironmentAuthorization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerRemoteHttpClient(fetch.fetchFn),
        Layer.succeed(
          ClientCapabilities.ClientPresentation,
          ClientCapabilities.ClientPresentation.of({
            metadata: {
              label: "Supaterm Test",
              deviceType: "mobile",
              os: "test",
            },
          }),
        ),
      ),
    ),
  );
  return { layer, fetch };
}

describe("RemoteEnvironmentAuthorization", () => {
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

  it.effect("reuses a validated bearer descriptor while issuing fresh websocket tickets", () =>
    Effect.gen(function* () {
      const harness = makeHarness([
        Response.json(DESCRIPTOR),
        websocketTicket("first-ticket"),
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
      ).toHaveLength(1);
      expect(
        harness.fetch.calls.filter(([url]) =>
          String(url).endsWith("/api/auth/websocket-ticket/rpc"),
        ),
      ).toHaveLength(2);
    }),
  );
});
