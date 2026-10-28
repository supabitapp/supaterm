// @effect-diagnostics nodeBuiltinImport:off - native loopback endpoint for Electron's HTTP loaders.
import * as NodeCrypto from "node:crypto";
import type { DesktopRelayViaChange } from "@supaterm/contracts";
import { createLoopbackRelayPool } from "@supaterm/shared/relay/loopbackPool";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";
import type { TunnelVia } from "@supaterm/shared/relay/tunnel";
import { openLoopbackRelay } from "@supaterm/shared/relay/tunnelNode";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

export class DesktopRelayError extends Schema.TaggedError<DesktopRelayError>()(
  "DesktopRelayError",
  {
    operation: Schema.Literals(["start", "stop"]),
    cause: Schema.Defect(),
  },
) {}

export class DesktopRelayGateway extends Context.Service<
  DesktopRelayGateway,
  {
    readonly start: (
      address: string,
      relayUrl: string,
      directUrls?: ReadonlyArray<string>,
    ) => Effect.Effect<string, DesktopRelayError>;
    readonly stop: (address: string) => Effect.Effect<void, DesktopRelayError>;
    readonly subscribe: (
      listener: (change: DesktopRelayViaChange) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@supaterm/desktop/relay/DesktopRelayGateway") {}

const OWNER = "desktop";

const make = Effect.gen(function* () {
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const listeners = new Set<(change: DesktopRelayViaChange) => Effect.Effect<void>>();
  const publish = (address: string, via: TunnelVia | undefined) => {
    for (const listener of listeners) runFork(listener({ address, via: via ?? null }));
  };
  const pool = createLoopbackRelayPool({
    limit: 64,
    open: (address, relayUrl, directUrls, report) =>
      openLoopbackRelay(address, {
        relayUrl,
        directUrls,
        onVia: report,
        randomBytes: NodeCrypto.randomBytes,
        createSocket: (url) => new WebSocket(url),
      }),
    onVia: publish,
  });
  yield* Effect.addFinalizer(() => Effect.promise(pool.dispose));
  const start = Effect.fn("DesktopRelayGateway.start")(
    (address: string, relayUrl: string, directUrls?: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: () => pool.acquire(address, OWNER, relayUrl, directUrls),
        catch: (cause) => new DesktopRelayError({ operation: "start", cause }),
      }).pipe(
        // Every window shares one tunnel, so a window that starts one already up
        // (another window's, or its own before a reload) would otherwise never learn its transport.
        Effect.tap(() =>
          Effect.sync(() => publish(canonicalRelayAddress(address) ?? address, pool.via(address))),
        ),
      ),
  );
  const stop = Effect.fn("DesktopRelayGateway.stop")((address: string) =>
    Effect.tryPromise({
      try: () => pool.release(address, OWNER),
      catch: (cause) => new DesktopRelayError({ operation: "stop", cause }),
    }),
  );
  const subscribe = (listener: (change: DesktopRelayViaChange) => Effect.Effect<void>) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        listeners.add(listener);
      }),
      () =>
        Effect.sync(() => {
          listeners.delete(listener);
        }),
    );
  return DesktopRelayGateway.of({ start, stop, subscribe });
});

export const layer = Layer.effect(DesktopRelayGateway, make);
