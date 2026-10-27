import type { EnvironmentId } from "@supaterm/contracts";
import { isLocalLoopbackHost } from "@supaterm/shared/hostClassification";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import { leaseRelayOrigin } from "../relay/gateway.ts";
import { ROUTE_CHECK_TIMEOUT_MS } from "./driver.ts";
import { mapRemoteEnvironmentError } from "./errors.ts";
import { ConnectionBlockedError, ConnectionTransientError } from "./model.ts";
import type { PairingFallback } from "./routes.ts";

function differentMachineError(label: string) {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `That address reaches ${label}, a different machine. Add it as its own environment instead.`,
  });
}

const reachDescriptor = Effect.fnUntraced(
  function* (
    httpBaseUrl: string,
    source: "linked" | "saved" | "hint",
    expectedEnvironmentId: EnvironmentId | undefined,
    relayUrl?: string,
  ) {
    const { origin, retain } = yield* leaseRelayOrigin(httpBaseUrl, relayUrl);
    const descriptor = yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl: origin }).pipe(
      Effect.mapError(mapRemoteEnvironmentError),
    );
    if (expectedEnvironmentId !== undefined && descriptor.environmentId !== expectedEnvironmentId) {
      return yield* differentMachineError(descriptor.label);
    }
    return { httpBaseUrl, descriptor, source, retain };
  },
  Effect.timeoutOrElse({
    duration: 10_000,
    orElse: () =>
      Effect.fail(
        new ConnectionTransientError({
          reason: "timeout",
          detail: "That address did not respond during pairing.",
        }),
      ),
  }),
);

export const reachPairingServer = Effect.fn("clientRuntime.connection.pairing.reachPairingServer")(
  function* (input: {
    readonly httpBaseUrl: string;
    readonly relayUrl?: string | undefined;
    readonly expectedEnvironmentId: EnvironmentId | undefined;
    readonly fallback: PairingFallback | null;
    readonly routes: ReadonlyArray<string>;
  }) {
    const candidates = new Map<
      string,
      PairingFallback["routes"][number] & { readonly source: "saved" | "hint" }
    >();
    const link = new URL(input.httpBaseUrl);
    const securePage =
      typeof globalThis.location !== "undefined" && globalThis.location.protocol === "https:";
    // A relay or HTTPS link's credential stays off plain HTTP like the token it
    // mints; relay addresses are always https. Loopback stays open for SSH forwards.
    const plainHttpAllowed = (url: URL) =>
      !securePage && (link.protocol !== "https:" || isLocalLoopbackHost(url.hostname));
    for (const [source, urls] of [
      ["saved", input.fallback?.routes ?? []],
      ["hint", input.routes.map((httpBaseUrl) => ({ httpBaseUrl }))],
    ] as const) {
      for (const route of urls) {
        const url = new URL(route.httpBaseUrl);
        if (url.origin === link.origin || candidates.has(url.origin)) continue;
        if (url.protocol === "http:" && !plainHttpAllowed(url)) continue;
        candidates.set(url.origin, { ...route, source });
      }
    }
    const linkedAddress = reachDescriptor(
      input.httpBaseUrl,
      "linked",
      input.expectedEnvironmentId,
      input.relayUrl,
    );
    if (candidates.size === 0) return yield* linkedAddress;
    const linked = yield* Effect.forkScoped(linkedAddress);
    const answered = yield* Fiber.join(linked).pipe(
      Effect.timeoutOption(ROUTE_CHECK_TIMEOUT_MS),
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isSome(answered)) return answered.value;
    return yield* Effect.raceAll([
      Fiber.join(linked),
      ...[...candidates.values()].map(({ httpBaseUrl, source, relayUrl }) =>
        reachDescriptor(
          httpBaseUrl,
          source,
          input.expectedEnvironmentId ?? input.fallback?.environmentId,
          relayUrl,
        ),
      ),
    ]).pipe(Effect.catch(() => Fiber.join(linked)));
  },
  Effect.tap((reached) => Effect.sync(reached.retain)),
  Effect.map(({ retain: _retain, ...reached }) => reached),
  Effect.scoped,
);
