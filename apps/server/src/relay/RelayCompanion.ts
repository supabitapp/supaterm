// @effect-diagnostics nodeBuiltinImport:off - client-side loopback gateway adapts native TCP loaders.
import * as NodeCrypto from "node:crypto";
import { DEFAULT_PUBLIC_RELAY_URL } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { createLoopbackRelayPool } from "@supaterm/shared/relay/loopbackPool";
import { openLoopbackRelay } from "@supaterm/shared/relay/tunnelNode";

export class RelayCompanionError extends Schema.TaggedError<RelayCompanionError>()(
  "RelayCompanionError",
  {
    operation: Schema.Literals(["open", "close"]),
    cause: Schema.Defect(),
  },
) {}

export interface RelayCompanionSession {
  readonly open: (
    address: string,
    relayUrl?: string,
    directUrls?: ReadonlyArray<string>,
  ) => Effect.Effect<string, RelayCompanionError>;
  readonly close: (address: string) => Effect.Effect<void, RelayCompanionError>;
}

export class RelayCompanion extends Context.Service<
  RelayCompanion,
  {
    readonly open: (
      address: string,
      owner: string,
      relayUrl?: string,
      directUrls?: ReadonlyArray<string>,
    ) => Effect.Effect<string, RelayCompanionError>;
    readonly close: (address: string, owner: string) => Effect.Effect<void, RelayCompanionError>;
    readonly session: Effect.Effect<RelayCompanionSession, never, Scope.Scope>;
  }
>()("supaterm/relay/RelayCompanion") {}

export function layer(defaultRelayUrl = DEFAULT_PUBLIC_RELAY_URL) {
  return Layer.effect(
    RelayCompanion,
    Effect.gen(function* () {
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
      const open = Effect.fn("RelayCompanion.open")(
        (address: string, owner: string, relayUrl?: string, directUrls?: ReadonlyArray<string>) =>
          Effect.tryPromise({
            try: (signal) =>
              pool.acquire(address, owner, relayUrl ?? defaultRelayUrl, directUrls, signal),
            catch: (cause) => new RelayCompanionError({ operation: "open", cause }),
          }),
      );
      const close = Effect.fn("RelayCompanion.close")((address: string, owner: string) =>
        Effect.tryPromise({
          try: () => pool.release(address, owner),
          catch: (cause) => new RelayCompanionError({ operation: "close", cause }),
        }),
      );
      const session = Effect.gen(function* () {
        const owner = NodeCrypto.randomUUID();
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => pool.releaseOwner(owner).catch(() => {})),
        );
        return {
          open: (address: string, relayUrl?: string, directUrls?: ReadonlyArray<string>) =>
            open(address, owner, relayUrl, directUrls),
          close: (address: string) => close(address, owner),
        } satisfies RelayCompanionSession;
      });
      return RelayCompanion.of({ open, close, session });
    }),
  );
}
