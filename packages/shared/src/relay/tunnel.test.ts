// @effect-diagnostics nodeBuiltinImport:off - real endpoint crypto verifies interoperable encrypted records.
import * as NodeCrypto from "node:crypto";
import type { WebSocketEvent, WebSocketLike } from "effect/socket/Socket";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  acceptClientHandshake,
  createClientHandshake,
  relayEndpointId,
  relayPublicKey,
  relayHttpBaseUrl,
} from "./protocol.ts";
import {
  createTunnelSession,
  createTunnelConnector,
  TUNNEL_KEEPALIVE_MS,
  TUNNEL_MAX_PLAIN_BYTES,
  TUNNEL_STREAM_WINDOW,
  type TunnelStream,
  type TunnelVia,
} from "./tunnel.ts";

function pair(onStream: (stream: TunnelStream) => void = () => {}, failSend = false) {
  const identity = NodeCrypto.randomBytes(32);
  const handshake = createClientHandshake(relayPublicKey(identity), NodeCrypto.randomBytes);
  const accepted = acceptClientHandshake(handshake.hello, identity, NodeCrypto.randomBytes);
  const clientCipher = handshake.finish(accepted.welcome);
  const toHost: Uint8Array[] = [];
  const toClient: Uint8Array[] = [];
  const client = createTunnelSession({
    cipher: clientCipher,
    initiator: true,
    send: (data) => {
      if (failSend) throw new Error("Socket send failed");
      toHost.push(data);
    },
  });
  const host = createTunnelSession({
    cipher: accepted.cipher,
    initiator: false,
    send: (data) => toClient.push(data),
    onStream,
  });
  // Pumps frames between the two in-memory sessions until neither has output left.
  async function drain() {
    // oxlint-disable-next-line supaterm/no-polling-loop-in-tests -- each round delivers the queued frames; it is the transport, not a wait.
    for (let round = 0; round < 1000; round++) {
      await Promise.resolve();
      if (toHost.length === 0 && toClient.length === 0) return;
      for (const data of toHost.splice(0)) host.receive(data);
      for (const data of toClient.splice(0)) client.receive(data);
    }
    throw new Error("Tunnel did not quiesce");
  }
  return { client, host, clientCipher, toHost, toClient, drain };
}

describe("encrypted relay multiplexing", () => {
  it("stops opening streams when a callback closes the session", async () => {
    let opened = 0;
    const p = pair(() => {
      opened++;
      p.host.close();
    });
    p.client.open();
    p.client.open();
    await p.drain();
    expect(opened).toBe(1);
    expect(p.host.closed).toBe(true);
    p.client.close();
  });

  it("fails a writer whose bytes were removed from the queue before send throws", async () => {
    const p = pair(undefined, true);
    let failure: Error | undefined;
    p.client.open().write(Uint8Array.of(1), (error) => {
      failure = error;
    });
    await p.drain();
    expect(failure?.message).toBe("Socket send failed");
    expect(p.client.closed).toBe(true);
    p.host.close();
  });

  it("cancels every pending candidate when its connector is disposed", async () => {
    const host = tunnelHost(() => [LAN]);
    const connecting = host.connector.session();
    host.connector.close();
    expect(host.sockets.map((socket) => socket.closed)).toEqual([true, true]);
    await expect(connecting).rejects.toThrow("canceled");
    await expect(host.connector.session()).rejects.toThrow("closed");
  });
  it("ends a full record without exceeding the wire limit", async () => {
    const received: Uint8Array[] = [];
    let ended = false;
    const p = pair((stream) => {
      stream.onData = (data) => {
        received.push(data);
        stream.consumed(data.length);
      };
      stream.onEnd = () => {
        ended = true;
        stream.end();
      };
    });
    const stream = p.client.open();
    const payload = NodeCrypto.randomBytes(TUNNEL_MAX_PLAIN_BYTES - 18);
    stream.write(payload);
    stream.end();
    await Promise.resolve();
    expect(p.toHost.every((record) => record.length <= TUNNEL_MAX_PLAIN_BYTES + 24)).toBe(true);
    await p.drain();
    expect(Buffer.concat(received)).toEqual(payload);
    expect(ended).toBe(true);
    expect(p.host.closed).toBe(false);
    expect(p.client.streamCount).toBe(0);
    p.client.close();
    p.host.close();
  });

  it("streams a large upload with bounded writes and independent streams", async () => {
    const hashes = new Map<number, ReturnType<typeof NodeCrypto.createHash>>();
    const p = pair((stream) => {
      const hash = NodeCrypto.createHash("sha256");
      hashes.set(stream.id, hash);
      stream.onData = (data) => {
        hash.update(data);
        stream.consumed(data.length);
      };
      stream.onEnd = () => stream.end();
    });
    const a = p.client.open();
    const b = p.client.open();
    const expected = NodeCrypto.createHash("sha256");
    for (let i = 0; i < 320; i++) {
      const chunk = NodeCrypto.randomBytes(64 * 1024);
      expected.update(chunk);
      a.write(chunk);
      b.write(Uint8Array.of(i % 256));
      await p.drain();
    }
    a.end();
    b.end();
    await p.drain();
    expect(hashes.get(a.id)?.digest("hex")).toBe(expected.digest("hex"));
    expect(p.client.streamCount).toBe(0);
    expect(p.host.closed).toBe(false);
    p.client.close();
    p.host.close();
  });

  it("stalls at a slow reader's window and resumes after consumption", async () => {
    let received = 0;
    let hostStream: TunnelStream | undefined;
    const p = pair((stream) => {
      hostStream = stream;
      stream.onData = (data) => {
        received += data.length;
      };
    });
    const stream = p.client.open();
    stream.write(new Uint8Array(TUNNEL_STREAM_WINDOW + 1024));
    await p.drain();
    expect(received).toBe(TUNNEL_STREAM_WINDOW);
    hostStream?.consumed(TUNNEL_STREAM_WINDOW);
    await p.drain();
    expect(received).toBe(TUNNEL_STREAM_WINDOW + 1024);
    p.client.close();
    p.host.close();
  });

  it("bounds a session when many readers stall", async () => {
    let received = 0;
    const p = pair((stream) => {
      stream.onData = (data) => {
        received += data.length;
      };
    });
    for (let i = 0; i < 8; i++) p.client.open().write(new Uint8Array(TUNNEL_STREAM_WINDOW));
    await p.drain();
    expect(received).toBeGreaterThan(TUNNEL_STREAM_WINDOW);
    expect(received).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(p.host.closed).toBe(false);
    p.client.close();
    p.host.close();
  });

  it("keeps a consuming stream moving while stalled readers hold most of the session", async () => {
    let delivered = 0;
    const p = pair((stream) => {
      stream.onData = (data) => {
        if (stream.id !== 7) return;
        delivered += data.length;
        stream.consumed(data.length);
      };
    });
    for (let i = 0; i < 3; i++) p.client.open().write(new Uint8Array(TUNNEL_STREAM_WINDOW));
    await p.drain();
    const active = p.client.open();
    expect(active.id).toBe(7);
    for (let i = 0; i < 16; i++) {
      active.write(new Uint8Array(1024 * 1024));
      await p.drain();
    }
    expect(delivered).toBe(16 * 1024 * 1024);
    expect(p.host.closed).toBe(false);
    p.client.close();
    p.host.close();
  });

  it("flushes a pending grant once stalled streams leave the sender short", async () => {
    let delivered = 0;
    const p = pair((stream) => {
      stream.onData = (data) => {
        if (stream.id !== 1) return;
        delivered += data.length;
        stream.consumed(data.length);
      };
    });
    const active = p.client.open();
    active.write(new Uint8Array(2_060_000));
    await p.drain();
    for (let i = 0; i < 3; i++) p.client.open().write(new Uint8Array(TUNNEL_STREAM_WINDOW));
    await p.drain();
    active.write(new Uint8Array(1024 * 1024));
    await p.drain();
    expect(delivered).toBe(2_060_000 + 1024 * 1024);
    p.client.close();
    p.host.close();
  });

  it("returns a consumed stream's credit when it shares records with a stalled stream", async () => {
    let delivered = 0;
    const p = pair((stream) => {
      stream.onData = (data) => {
        if (stream.id !== 3) return;
        delivered += data.length;
        stream.consumed(data.length);
      };
    });
    const stalled = p.client.open();
    const active = p.client.open();
    for (let i = 0; i < 256; i++) {
      if (i < 160) stalled.write(new Uint8Array(256));
      active.write(new Uint8Array(256));
      await p.drain();
    }
    expect(delivered).toBe(256 * 256);
    p.client.close();
    p.host.close();
  });

  it("coalesces queued writes into one record", async () => {
    const received: number[] = [];
    const p = pair((stream) => {
      stream.onData = (data) => {
        received.push(...data);
        stream.consumed(data.length);
      };
    });
    const stream = p.client.open();
    for (let i = 0; i < 10; i++) stream.write(Uint8Array.of(i));
    await Promise.resolve();
    expect(p.toHost).toHaveLength(1);
    await p.drain();
    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    p.client.close();
    p.host.close();
  });

  it("answers keepalive pings and closes a session whose peer goes silent", async () => {
    vi.useFakeTimers();
    try {
      const p = pair();
      await vi.advanceTimersByTimeAsync(TUNNEL_KEEPALIVE_MS);
      expect(p.toHost.length).toBeGreaterThan(0);
      for (let i = 0; i < 5; i++) {
        await p.drain();
        await vi.advanceTimersByTimeAsync(TUNNEL_KEEPALIVE_MS);
      }
      expect(p.client.closed).toBe(false);
      expect(p.host.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(TUNNEL_KEEPALIVE_MS * 3);
      expect(p.client.closed).toBe(true);
      expect(p.host.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a peer that bypasses cumulative stream credit", async () => {
    const p = pair();
    p.client.open();
    await p.drain();
    const frame = new Uint8Array(TUNNEL_MAX_PLAIN_BYTES);
    const view = new DataView(frame.buffer);
    view.setUint8(0, 2);
    view.setUint32(1, 1);
    view.setUint32(5, frame.length - 9);
    for (let i = 0; i < 66 && !p.host.closed; i++) p.host.receive(p.clientCipher.seal(frame));
    expect(p.host.closed).toBe(true);
    p.client.close();
  });

  it("rejects stream reuse and malformed control frames", async () => {
    for (const [type, id, length] of [
      [1, 1, 0],
      [4, 1, 1],
      [5, 1, 1],
      [3, 0, 4],
      [6, 1, 0],
      [7, 0, 1],
    ]) {
      const p = pair();
      p.client.open();
      await p.drain();
      const frame = new Uint8Array(9 + length!);
      const view = new DataView(frame.buffer);
      view.setUint8(0, type!);
      view.setUint32(1, id!);
      view.setUint32(5, length!);
      p.host.receive(p.clientCipher.seal(frame));
      expect(p.host.closed).toBe(true);
      p.client.close();
    }
  });

  it("fails pending writers and all streams when the session closes", () => {
    const p = pair();
    const stream = p.client.open();
    let error: Error | undefined;
    let closed = false;
    stream.write(Uint8Array.of(1), (failure) => {
      error = failure;
    });
    stream.onClose = () => {
      closed = true;
    };
    p.client.close(new Error("Disconnected"));
    expect(error?.message).toBe("Disconnected");
    expect(closed).toBe(true);
    expect(() => p.client.open()).toThrow("closed");
    p.host.close();
  });
});

const RELAY = "wss://relay.example";
const LAN = "ws://192.168.1.20:3773";
const TAILNET = "ws://100.64.0.7:3773";

type SocketEventType = "open" | "message" | "error" | "close";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType = "blob";
  closed = false;
  readonly sent: Array<string | Uint8Array> = [];
  private readonly listeners = new Map<SocketEventType, Set<(event: WebSocketEvent) => void>>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: SocketEventType, listener: (event: WebSocketEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: SocketEventType, listener: (event: WebSocketEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: SocketEventType, event: WebSocketEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "" });
  }
  get records() {
    return this.sent.filter((data) => typeof data !== "string");
  }
}

// Plays the host behind every dialed URL, so each candidate verifies against the same identity.
function tunnelHost(directUrls?: () => ReadonlyArray<string>, handshakeTimeoutMs?: number) {
  const secret = NodeCrypto.randomBytes(32);
  const sockets: FakeSocket[] = [];
  const reports: Array<TunnelVia | undefined> = [];
  const connector = createTunnelConnector(relayHttpBaseUrl(relayPublicKey(secret)), {
    relayUrl: RELAY,
    onVia: (via) => reports.push(via),
    randomBytes: NodeCrypto.randomBytes,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    ...(directUrls ? { directUrls } : {}),
    ...(handshakeTimeoutMs ? { handshakeTimeoutMs } : {}),
  });
  return {
    connector,
    sockets,
    reports,
    endpointId: relayEndpointId(relayPublicKey(secret)),
    dialed: (base: string) =>
      sockets.findLast((socket) => socket.url.startsWith(`${base}/v1/connect?`))!,
    hello: (socket: FakeSocket) => socket.emit("open"),
    welcome: (socket: FakeSocket) => {
      const accepted = acceptClientHandshake(
        String(socket.sent[0]),
        secret,
        NodeCrypto.randomBytes,
      );
      socket.emit("message", { data: accepted.welcome });
      return accepted.cipher;
    },
    notFound: (socket: FakeSocket) => {
      socket.emit("error");
      socket.emit("close", { code: 1006, reason: "" });
    },
  };
}

describe("relay and direct candidate race", () => {
  it("keeps the first verified candidate while others fail or stall", async () => {
    const host = tunnelHost(() => [TAILNET, LAN]);
    const connecting = host.connector.session();
    expect(host.sockets.map((socket) => socket.url)).toEqual(
      [RELAY, TAILNET, LAN].map((base) => `${base}/v1/connect?endpointId=${host.endpointId}`),
    );
    const [relay, tailnet, lan] = [host.dialed(RELAY), host.dialed(TAILNET), host.dialed(LAN)];
    host.hello(relay);
    host.notFound(tailnet);
    host.hello(lan);
    const cipher = host.welcome(lan);
    const session = await connecting;
    expect(host.reports).toEqual(["direct"]);
    expect(relay.closed).toBe(true);
    expect(tailnet.closed).toBe(true);
    expect(lan.closed).toBe(false);
    session.open();
    await Promise.resolve();
    expect(relay.records).toHaveLength(0);
    expect(lan.records).toHaveLength(1);
    expect(cipher.open(lan.records[0]!, TUNNEL_MAX_PLAIN_BYTES)[0]).toBe(1);
    host.connector.close();
    expect(host.reports).toEqual(["direct", undefined]);
  });

  it("keeps the relay when it verifies before a direct candidate", async () => {
    const host = tunnelHost(() => [LAN]);
    const connecting = host.connector.session();
    const [relay, lan] = [host.dialed(RELAY), host.dialed(LAN)];
    host.hello(relay);
    host.hello(lan);
    host.welcome(relay);
    await connecting;
    expect(host.reports).toEqual(["relay"]);
    expect(lan.closed).toBe(true);
    host.connector.close();
  });

  it("drops a verified welcome that arrives after another candidate won", async () => {
    const host = tunnelHost(() => [LAN]);
    const connecting = host.connector.session();
    const [relay, lan] = [host.dialed(RELAY), host.dialed(LAN)];
    host.hello(relay);
    host.hello(lan);
    host.welcome(lan);
    host.welcome(relay);
    const session = await connecting;
    session.open();
    await Promise.resolve();
    expect(relay.closed).toBe(true);
    expect(relay.records).toHaveLength(0);
    expect(lan.records).toHaveLength(1);
    expect(host.reports).toEqual(["direct"]);
    host.connector.close();
  });

  it("waits for a direct candidate after the relay fails and reports the relay's error last", async () => {
    const host = tunnelHost(() => [LAN, TAILNET]);
    const connecting = host.connector.session();
    host.dialed(RELAY).emit("close", { code: 4404, reason: "host-offline" });
    host.notFound(host.dialed(TAILNET));
    host.hello(host.dialed(LAN));
    host.welcome(host.dialed(LAN));
    await connecting;
    expect(host.reports).toEqual(["direct"]);
    host.dialed(LAN).emit("close", { code: 1006, reason: "" });
    expect(host.reports).toEqual(["direct", undefined]);

    const failing = host.connector.session();
    host.notFound(host.dialed(LAN));
    host.dialed(RELAY).emit("close", { code: 4404, reason: "host-offline" });
    host.notFound(host.dialed(TAILNET));
    await expect(failing).rejects.toThrow("host-offline");
    host.connector.close();
    expect(host.reports).toEqual(["direct", undefined]);
  });

  it("gives up on a silent direct candidate before the relay's handshake deadline", async () => {
    vi.useFakeTimers();
    try {
      const host = tunnelHost(() => [LAN]);
      let settled = false;
      const connecting = host.connector.session().finally(() => {
        settled = true;
      });
      const rejected = expect(connecting).rejects.toThrow("host-offline");
      host.dialed(RELAY).emit("close", { code: 4404, reason: "host-offline" });
      host.dialed(LAN);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      host.connector.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not open a session from a welcome that arrives after the race failed", async () => {
    vi.useFakeTimers();
    try {
      const host = tunnelHost(() => [LAN], 1_000);
      const connecting = expect(host.connector.session()).rejects.toThrow("timed out");
      const relay = host.dialed(RELAY);
      host.hello(relay);
      host.notFound(host.dialed(LAN));
      await vi.advanceTimersByTimeAsync(1_000);
      await connecting;
      host.welcome(relay);
      await vi.advanceTimersByTimeAsync(TUNNEL_KEEPALIVE_MS);
      expect(relay.closed).toBe(true);
      expect(relay.records).toHaveLength(0);
      host.connector.close();
      expect(host.reports).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads direct candidates per dial and keeps a live session on its transport", async () => {
    let direct: ReadonlyArray<string> = [
      RELAY,
      "http://10.0.0.1:3773",
      "not a url",
      ...Array.from({ length: 10 }, (_, index) => `ws://10.0.0.${index + 1}:3773/`),
      "ws://10.0.0.1:3773",
    ];
    const host = tunnelHost(() => direct);
    const connecting = host.connector.session();
    expect(host.sockets.map((socket) => socket.url.split("/v1/")[0])).toEqual([
      RELAY,
      ...Array.from({ length: 8 }, (_, index) => `ws://10.0.0.${index + 1}:3773`),
    ]);
    host.hello(host.dialed(RELAY));
    host.welcome(host.dialed(RELAY));
    await connecting;
    direct = [LAN];
    await host.connector.open();
    expect(host.sockets).toHaveLength(9);
    expect(host.reports).toEqual(["relay"]);

    host.dialed(RELAY).emit("close", { code: 1001, reason: "" });
    const reconnecting = host.connector.session();
    expect(host.sockets.slice(9).map((socket) => socket.url.split("/v1/")[0])).toEqual([
      RELAY,
      LAN,
    ]);
    host.hello(host.dialed(LAN));
    host.welcome(host.dialed(LAN));
    await reconnecting;
    expect(host.reports).toEqual(["relay", undefined, "direct"]);
    host.connector.close();
    expect(host.reports).toEqual(["relay", undefined, "direct", undefined]);
  });
});
