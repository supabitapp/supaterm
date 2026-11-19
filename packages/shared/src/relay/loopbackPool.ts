import { canonicalRelayAddress } from "./protocol.ts";
import type { TunnelVia } from "./tunnel.ts";

export interface LoopbackRelay {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

interface Lease {
  pending: number;
  retained: boolean;
}

interface Endpoint {
  readonly address: string;
  readonly resource: Promise<LoopbackRelay>;
  readonly owners: Map<string, Lease>;
  directUrls: ReadonlyArray<string>;
  via: TunnelVia | undefined;
  closing?: Promise<void>;
}

export function createLoopbackRelayPool(input: {
  readonly open: (
    address: string,
    relayUrl: string,
    directUrls: () => ReadonlyArray<string>,
    report: (via: TunnelVia | undefined) => void,
  ) => Promise<LoopbackRelay>;
  readonly limit: number;
  readonly onVia?: (address: string, via: TunnelVia | undefined) => void;
}) {
  const endpoints = new Map<string, Endpoint>();
  const closing = new Set<Promise<void>>();
  const published = new Map<string, TunnelVia>();
  let disposed = false;
  const canonical = (address: string) => {
    const identity = canonicalRelayAddress(address);
    if (!identity) throw new Error("Not a relay address");
    return identity;
  };
  const via = (identity: string) => {
    for (const endpoint of endpoints.values()) {
      if (endpoint.address === identity && !endpoint.closing && endpoint.via) return endpoint.via;
    }
    return undefined;
  };
  const publish = (identity: string) => {
    const current = via(identity);
    if (published.get(identity) === current) return;
    if (current === undefined) published.delete(identity);
    else published.set(identity, current);
    input.onVia?.(identity, current);
  };
  const closeResource = (key: string, endpoint: Endpoint) => {
    if (!endpoint.closing) {
      const closed = endpoint.resource
        .then(
          (value) => value.close(),
          () => {},
        )
        .finally(() => {
          if (endpoints.get(key) === endpoint) endpoints.delete(key);
          closing.delete(closed);
        });
      endpoint.closing = closed;
      closing.add(closed);
      publish(endpoint.address);
    }
    return endpoint.closing;
  };
  const releaseOwned = async (owner: string, address?: string) => {
    await Promise.all(
      [...endpoints].map(async ([key, endpoint]) => {
        if (address !== undefined && endpoint.address !== address) return;
        if (!endpoint.owners.delete(owner)) return;
        if (endpoint.owners.size === 0) await closeResource(key, endpoint);
      }),
    );
  };
  const acquire = async (
    address: string,
    owner: string,
    relayUrl: string,
    directUrls?: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): Promise<string> => {
    const identity = canonical(address);
    signal?.throwIfAborted();
    if (disposed) throw new Error("Relay gateway is closed");
    const key = JSON.stringify([identity, relayUrl]);
    const saved = endpoints.get(key);
    let endpoint = saved;
    if (!endpoint || endpoint.closing) {
      if (!saved && endpoints.size >= input.limit) throw new Error("Too many relay environments");
      const created: Endpoint = {
        address: identity,
        resource: (saved?.closing ?? Promise.resolve())
          .catch(() => {})
          .then(() => {
            if (disposed || created.closing || endpoints.get(key) !== created)
              throw new Error("Relay endpoint was closed before preparation");
            return input.open(
              identity,
              relayUrl,
              () => created.directUrls,
              (next) => {
                if (created.closing || endpoints.get(key) !== created) return;
                created.via = next;
                publish(identity);
              },
            );
          })
          .catch((error) => {
            if (endpoints.get(key) === created) {
              endpoints.delete(key);
              publish(identity);
            }
            throw error;
          }),
        owners: new Map(),
        directUrls: [],
        via: undefined,
      };
      endpoints.set(key, created);
      endpoint = created;
    }
    const selected = endpoint;
    if (directUrls) selected.directUrls = directUrls;
    const lease = selected.owners.get(owner) ?? { pending: 0, retained: false };
    selected.owners.set(owner, lease);
    lease.pending++;
    let pending = true;
    const finish = (retained = false) => {
      if (!pending) return;
      pending = false;
      lease.pending--;
      if (retained) lease.retained = true;
      if (!lease.retained && lease.pending === 0 && selected.owners.get(owner) === lease) {
        selected.owners.delete(owner);
        if (selected.owners.size === 0) void closeResource(key, selected).catch(() => {});
      }
    };
    const cancel = () => finish();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const resource = await selected.resource;
      signal?.throwIfAborted();
      if (
        disposed ||
        selected.closing ||
        endpoints.get(key) !== selected ||
        selected.owners.get(owner) !== lease
      )
        throw new Error("Relay endpoint was closed during preparation");
      finish(true);
      return resource.origin;
    } finally {
      signal?.removeEventListener("abort", cancel);
      finish();
    }
  };
  return {
    acquire,
    via: (address: string) => via(canonical(address)),
    release: (address: string, owner: string) => releaseOwned(owner, canonical(address)),
    releaseOwner: (owner: string) => releaseOwned(owner),
    dispose: async () => {
      disposed = true;
      await Promise.allSettled([
        ...[...endpoints].map(([address, endpoint]) => closeResource(address, endpoint)),
        ...closing,
      ]);
    },
  };
}
