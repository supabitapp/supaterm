import { DEFAULT_PUBLIC_RELAY_URL } from "@supaterm/contracts";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ConnectionTransientError } from "../connection/model.ts";

export type RelayTransport = "relay" | "direct";

export interface RelayClientEndpoint {
  readonly prepare: () => Promise<string>;
  readonly close: () => Promise<void>;
}

export interface RelayOriginLease extends RelayClientEndpoint {
  readonly retain: () => void;
}

export class RelayGateway extends Context.Service<
  RelayGateway,
  {
    readonly available: boolean;
    readonly lease: (
      address: string,
      relayUrl?: string,
      directUrls?: ReadonlyArray<string>,
    ) => RelayOriginLease;
    readonly resolve: (
      address: string,
      relayUrl?: string,
      directUrls?: ReadonlyArray<string>,
    ) => Promise<string>;
    readonly release: (address: string) => Promise<void>;
    readonly via: (address: string) => RelayTransport | undefined;
    readonly subscribe: (listener: () => void) => () => void;
    readonly fetch: typeof globalThis.fetch;
  }
>()("@supaterm/client-runtime/relay/gateway/RelayGateway") {}

interface OwnedEndpoint {
  readonly relayUrl: string;
  readonly endpoint: Promise<RelayClientEndpoint>;
  retained: boolean;
  leases: number;
}

export function layer(input: {
  readonly available?: boolean;
  readonly open: (
    address: string,
    relayUrl: string,
    directUrls: () => ReadonlyArray<string>,
    report: (via: RelayTransport | undefined) => void,
  ) => Promise<RelayClientEndpoint>;
  readonly fetch: typeof globalThis.fetch;
}) {
  return Layer.effect(
    RelayGateway,
    Effect.gen(function* () {
      const endpoints = new Map<string, OwnedEndpoint>();
      const relayUrls = new Map<string, string>();
      const directUrls = new Map<string, ReadonlyArray<string>>();
      const remember = (
        identity: string,
        relayUrl: string | undefined,
        direct: ReadonlyArray<string> | undefined,
      ) => {
        if (relayUrl !== undefined) relayUrls.set(identity, relayUrl);
        if (direct !== undefined) directUrls.set(identity, direct);
      };
      const closing = new Map<string, Promise<void>>();
      const transports = new Map<string, RelayTransport>();
      const listeners = new Set<() => void>();
      let disposed = false;
      const key = canonicalRelayAddress;
      const setTransport = (identity: string, via: RelayTransport | undefined) => {
        if (transports.get(identity) === via) return;
        if (via === undefined) transports.delete(identity);
        else transports.set(identity, via);
        for (const listener of listeners) listener();
      };
      const forget = (identity: string, owned: OwnedEndpoint) => {
        if (endpoints.get(identity) !== owned) return;
        endpoints.delete(identity);
        setTransport(identity, undefined);
      };
      const release = async (address: string) => {
        const identity = key(address);
        if (!identity) return;
        const owned = endpoints.get(identity);
        if (!owned) return closing.get(identity);
        forget(identity, owned);
        const stopped = owned.endpoint
          .then(
            (value) => value.close(),
            () => {},
          )
          .catch(() => {})
          .finally(() => {
            if (closing.get(identity) === stopped) closing.delete(identity);
          });
        closing.set(identity, stopped);
        await stopped;
      };
      const endpoint = (identity: string) => {
        const relayUrl = relayUrls.get(identity) ?? DEFAULT_PUBLIC_RELAY_URL;
        const existing = endpoints.get(identity);
        if (existing?.relayUrl === relayUrl) return existing;
        if (existing) void release(identity);
        const created: OwnedEndpoint = {
          relayUrl,
          retained: false,
          leases: 0,
          endpoint: Promise.resolve(closing.get(identity)).then(() => {
            if (disposed || endpoints.get(identity) !== created)
              throw new Error("Relay gateway closed");
            return input.open(
              identity,
              relayUrl,
              () => directUrls.get(identity) ?? [],
              (via) => {
                if (endpoints.get(identity) === created) setTransport(identity, via);
              },
            );
          }),
        };
        endpoints.set(identity, created);
        void created.endpoint.catch(() => forget(identity, created));
        return created;
      };
      const prepare = async (identity: string) => {
        const owned = endpoint(identity);
        owned.retained = true;
        return (await owned.endpoint).prepare();
      };
      const lease = (
        address: string,
        relayUrl = DEFAULT_PUBLIC_RELAY_URL,
        direct?: ReadonlyArray<string>,
      ): RelayOriginLease => {
        const identity = key(address);
        if (!identity)
          return { prepare: async () => address, retain: () => {}, close: async () => {} };
        remember(identity, relayUrl, direct);
        const owned = endpoint(identity);
        owned.leases++;
        let closed = false;
        return {
          prepare: async () => {
            const prepared = await owned.endpoint;
            if (closed) throw new Error("Relay lease closed");
            return prepared.prepare();
          },
          retain: () => {
            if (!closed) owned.retained = true;
          },
          close: async () => {
            if (closed) return;
            closed = true;
            owned.leases--;
            if (!owned.retained && owned.leases === 0 && endpoints.get(identity) === owned)
              await release(identity);
          },
        };
      };
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          disposed = true;
          const owned = [...endpoints.values()];
          endpoints.clear();
          if (transports.size > 0) {
            transports.clear();
            for (const listener of listeners) listener();
          }
          await Promise.allSettled([
            ...closing.values(),
            ...owned.map(async (value) => (await value.endpoint).close()),
          ]);
        }),
      );
      return RelayGateway.of({
        available: input.available ?? true,
        lease,
        resolve: async (address, relayUrl, direct) => {
          const identity = key(address);
          if (!identity) return address;
          remember(identity, relayUrl, direct);
          return prepare(identity);
        },
        release,
        via: (address) => {
          const identity = key(address);
          return identity ? transports.get(identity) : undefined;
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        fetch: async (request, init) => {
          const address = request instanceof Request ? request.url : String(request);
          const identity = key(address);
          if (!identity) return input.fetch(request, init);
          const origin = await prepare(identity);
          const url = new URL(address);
          const target = new URL(origin);
          target.pathname = url.pathname;
          target.search = url.search;
          return input.fetch(
            request instanceof Request ? new Request(target, request) : target,
            init,
          );
        },
      });
    }),
  );
}

const relayConnectionError = (cause: unknown) =>
  new ConnectionTransientError({
    reason: "transport",
    detail: cause instanceof Error ? cause.message : "The relay tunnel could not be opened.",
  });

export const leaseRelayOrigin = Effect.fn("RelayGateway.leaseOrigin")(function* (
  address: string,
  relayUrl = DEFAULT_PUBLIC_RELAY_URL,
  directUrls?: ReadonlyArray<string>,
) {
  const gateway = yield* Effect.serviceOption(RelayGateway);
  if (Option.isNone(gateway)) return { origin: address, retain: () => {} };
  const lease = yield* Effect.acquireRelease(
    Effect.try({
      try: () => gateway.value.lease(address, relayUrl, directUrls),
      catch: relayConnectionError,
    }),
    (lease) =>
      Effect.sync(() => {
        void lease.close().catch(() => {});
      }),
  );
  const origin = yield* Effect.tryPromise({
    try: () => lease.prepare(),
    catch: relayConnectionError,
  });
  return { origin, retain: lease.retain };
});

export const resolveRelayOrigin = Effect.fn("RelayGateway.resolveOrigin")(function* (
  address: string,
  relayUrl = DEFAULT_PUBLIC_RELAY_URL,
  directUrls?: ReadonlyArray<string>,
) {
  const gateway = yield* Effect.serviceOption(RelayGateway);
  if (Option.isNone(gateway)) return address;
  return yield* Effect.tryPromise({
    try: () => gateway.value.resolve(address, relayUrl, directUrls),
    catch: relayConnectionError,
  });
});

export const releaseRelayOrigin = Effect.fn("RelayGateway.releaseOrigin")(function* (
  address: string,
) {
  const gateway = yield* Effect.serviceOption(RelayGateway);
  if (Option.isSome(gateway))
    yield* Effect.sync(() => {
      void gateway.value.release(address).catch(() => {});
    });
});
