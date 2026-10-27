import { expect, it, vi } from "vite-plus/test";
import { createLoopbackRelayPool, type LoopbackRelay } from "./loopbackPool.ts";

const address = `https://${"a".repeat(32)}.${"b".repeat(32)}.relay.supaterm.alt`;
const otherAddress = `https://${"c".repeat(32)}.${"d".repeat(32)}.relay.supaterm.alt`;
const relayA = "wss://relay-a.example";
const relayB = "wss://relay-b.example";

it("isolates relay servers for one identity while sharing matching routes across tabs", async () => {
  const endpoints: Array<{ relayUrl: string; origin: string; close: ReturnType<typeof vi.fn> }> =
    [];
  const pool = createLoopbackRelayPool({
    limit: 4,
    open: async (_address, relayUrl) => {
      const endpoint = {
        relayUrl,
        origin: `http://127.0.0.1:${40000 + endpoints.length}`,
        close: vi.fn(async () => {}),
      };
      endpoints.push(endpoint);
      return endpoint;
    },
  });
  try {
    const a = await pool.acquire(address, "tab-a", relayA);
    expect(await pool.acquire(address + "/", "tab-b", relayA)).toBe(a);
    const b = await pool.acquire(address, "tab-b", relayB);
    expect(b).not.toBe(a);
    expect(endpoints.map((endpoint) => endpoint.relayUrl)).toEqual([relayA, relayB]);
    await pool.release(address, "tab-b");
    expect(endpoints[0]!.close).not.toHaveBeenCalled();
    expect(endpoints[1]!.close).toHaveBeenCalledOnce();
    expect(await pool.acquire(address, "tab-a", relayA)).toBe(a);
    await pool.releaseOwner("tab-a");
    expect(endpoints[0]!.close).toHaveBeenCalledOnce();
  } finally {
    await pool.dispose();
  }
});

it("releases an owner's relay variants without closing its other environments", async () => {
  const closed: string[] = [];
  const pool = createLoopbackRelayPool({
    limit: 4,
    open: async (identity, relayUrl) => ({
      origin: identity + relayUrl,
      close: async () => {
        closed.push(identity + relayUrl);
      },
    }),
  });
  try {
    await pool.acquire(address, "tab", relayA);
    await pool.acquire(address, "tab", relayB);
    await pool.acquire(otherAddress, "tab", relayA);
    await pool.release(address, "tab");
    expect(closed).toEqual([address + relayA, address + relayB]);
    await pool.releaseOwner("tab");
    expect(closed).toEqual([address + relayA, address + relayB, otherAddress + relayA]);
  } finally {
    await pool.dispose();
  }
});

it("closes a cancelled preparation without releasing another relay's lease", async () => {
  const pending = Promise.withResolvers<LoopbackRelay>();
  const opened = Promise.withResolvers<void>();
  const closeA = vi.fn(async () => {});
  const closeB = vi.fn(async () => {});
  const pool = createLoopbackRelayPool({
    limit: 2,
    open: async (_address, relayUrl) => {
      if (relayUrl === relayA) {
        opened.resolve();
        return pending.promise;
      }
      return { origin: "http://127.0.0.1:40001", close: closeB };
    },
  });
  const abort = new AbortController();
  try {
    const preparing = pool.acquire(address, "tab-a", relayA, undefined, abort.signal);
    const rejected = expect(preparing).rejects.toThrow();
    await opened.promise;
    const originB = await pool.acquire(address, "tab-b", relayB);
    await expect(pool.acquire(otherAddress, "tab-c", relayA)).rejects.toThrow(
      "Too many relay environments",
    );
    abort.abort();
    pending.resolve({ origin: "http://127.0.0.1:40000", close: closeA });
    await rejected;
    expect(await pool.acquire(address, "tab-b", relayB)).toBe(originB);
    expect(closeB).not.toHaveBeenCalled();
  } finally {
    pending.resolve({ origin: "http://127.0.0.1:40000", close: closeA });
    await pool.dispose();
  }
  expect(closeA).toHaveBeenCalledOnce();
  expect(closeB).toHaveBeenCalledOnce();
});

it("updates direct candidates for the next dial without reopening the endpoint", async () => {
  const direct: Array<() => ReadonlyArray<string>> = [];
  const close = vi.fn(async () => {});
  let via: "relay" | "direct" | undefined;
  const pool = createLoopbackRelayPool({
    limit: 2,
    open: async (_address, _relayUrl, directUrls) => {
      direct.push(directUrls);
      return { origin: "http://127.0.0.1:40000", close, via: () => via };
    },
  });
  try {
    expect(await pool.acquire(address, "desktop", relayA, ["ws://10.0.0.2:3773"])).toBe(
      "http://127.0.0.1:40000",
    );
    expect(pool.via(address)).toBeUndefined();
    via = "direct";
    expect(pool.via(address + "/")).toBe("direct");
    expect(await pool.acquire(address, "desktop", relayA, ["ws://192.168.1.20:3773"])).toBe(
      "http://127.0.0.1:40000",
    );
    expect(await pool.acquire(address, "desktop", relayA)).toBe("http://127.0.0.1:40000");
    expect(direct).toHaveLength(1);
    expect(direct[0]!()).toEqual(["ws://192.168.1.20:3773"]);
    expect(close).not.toHaveBeenCalled();
    await pool.release(address, "desktop");
    expect(close).toHaveBeenCalledOnce();
    expect(pool.via(address)).toBeUndefined();
  } finally {
    await pool.dispose();
  }
});
