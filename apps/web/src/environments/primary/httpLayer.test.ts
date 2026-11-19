import type { DesktopBridge } from "@supaterm/contracts";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { HttpClient } from "effect/http";

import { __resetDesktopPrimaryAuthForTests } from "./desktopAuth";
import * as PrimaryEnvironmentHttpLayer from "./httpLayer";

function recordingFetch() {
  const requests: Array<Request> = [];
  const send = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(null, { status: 200 });
  };
  return { requests, send };
}

function createSignal<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("primary environment HTTP layer", { concurrent: false }, () => {
  afterEach(() => {
    __resetDesktopPrimaryAuthForTests();
    Reflect.deleteProperty(globalThis, "window");
  });

  it.effect("uses cookie credentials for browser primary environments", () => {
    const transport = recordingFetch();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "http://127.0.0.1:3773/settings",
          origin: "http://127.0.0.1:3773",
        },
      },
    });

    return Effect.gen(function* () {
      yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session");

      const request = transport.requests[0]!;
      expect(request.credentials).toBe("include");
      expect(request.headers.get("authorization")).toBeNull();
    }).pipe(Effect.provide(PrimaryEnvironmentHttpLayer.layerForCurrentOrigin(transport.send)));
  });

  it.effect("uses bearer auth without cookies for desktop-managed primaries", () => {
    const requested = createSignal<void>();
    const bearerToken = createSignal<string>();
    const transport = recordingFetch();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "supaterm://app" },
        desktopBridge: {
          getLocalEnvironmentBootstrap: () => ({
            label: "Local environment",
            httpBaseUrl: "http://127.0.0.1:3773",
            wsBaseUrl: "ws://127.0.0.1:3773",
            bootstrapToken: "desktop-bootstrap-token",
          }),
          getLocalEnvironmentBearerToken: () => {
            requested.resolve(undefined);
            return bearerToken.promise;
          },
        } as unknown as DesktopBridge,
      },
    });

    return Effect.gen(function* () {
      const requestFiber = yield* HttpClient.get(
        "http://127.0.0.1:3773/api/connect/link-state",
      ).pipe(Effect.forkChild);
      yield* Effect.promise(() => requested.promise);
      expect(transport.requests).toHaveLength(0);
      bearerToken.resolve("desktop-bearer-token");
      yield* Fiber.join(requestFiber);

      const request = transport.requests[0]!;
      expect(request.credentials).not.toBe("include");
      expect(request.headers.get("authorization")).toBe("Bearer desktop-bearer-token");
    }).pipe(Effect.provide(PrimaryEnvironmentHttpLayer.layerForCurrentOrigin(transport.send)));
  });
});
