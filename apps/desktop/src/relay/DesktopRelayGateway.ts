// @effect-diagnostics nodeBuiltinImport:off - native loopback endpoint for Electron's HTTP loaders.
import * as NodeCrypto from "node:crypto";
import { createLoopbackRelayPool } from "@supaterm/shared/relay/loopbackPool";
import type { TunnelVia } from "@supaterm/shared/relay/tunnel";
import { openLoopbackRelay } from "@supaterm/shared/relay/tunnelNode";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class DesktopRelayError extends Schema.TaggedError<DesktopRelayError>()(
  "DesktopRelayError",
  {
    operation: Schema.Literals(["start", "stop", "via"]),
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
    readonly via: (address: string) => Effect.Effect<TunnelVia | null, DesktopRelayError>;
  }
>()("@supaterm/desktop/relay/DesktopRelayGateway") {}

const OWNER = "desktop";

const make = Effect.gen(function* () {
  const pool = createLoopbackRelayPool({
    limit: 64,
    open: (address, relayUrl, directUrls) =>
      openLoopbackRelay(address, {
        relayUrl,
        directUrls,
        randomBytes: NodeCrypto.randomBytes,
        createSocket: (url) => new WebSocket(url),
      }),
  });
  yield* Effect.addFinalizer(() => Effect.promise(pool.dispose));
  const start = Effect.fn("DesktopRelayGateway.start")(
    (address: string, relayUrl: string, directUrls?: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: () => pool.acquire(address, OWNER, relayUrl, directUrls),
        catch: (cause) => new DesktopRelayError({ operation: "start", cause }),
      }),
  );
  const stop = Effect.fn("DesktopRelayGateway.stop")((address: string) =>
    Effect.tryPromise({
      try: () => pool.release(address, OWNER),
      catch: (cause) => new DesktopRelayError({ operation: "stop", cause }),
    }),
  );
  const via = Effect.fn("DesktopRelayGateway.via")((address: string) =>
    Effect.try({
      try: () => pool.via(address) ?? null,
      catch: (cause) => new DesktopRelayError({ operation: "via", cause }),
    }),
  );
  return DesktopRelayGateway.of({ start, stop, via });
});

export const layer = Layer.effect(DesktopRelayGateway, make);
